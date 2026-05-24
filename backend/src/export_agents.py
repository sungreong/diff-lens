"""
EXPORT 추가 분석 에이전트 모듈

기존 agents.py 패턴을 따르며, 증적 분석 결과를 다양하게 활용할 수 있는 에이전트들을 제공합니다.
"""
import asyncio
import json
import logging
import time
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Optional, Dict, Any, Generator
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from .agents import BaseAgent, get_llm, create_tracing_context
from .custom_group_export_agent import CustomGroupExportAgent
from .export_templates import FLAT_SUMMARY_TEMPLATES
from .export_summary_catalog import PREDEFINED_SUMMARY_TYPES, _flat_templates_from_prompt_config, _normalize_flat_template
from .langfuse_utils import LangfuseTracingContext
from .prompt_registry import DEFAULT_PROMPTS

logger = logging.getLogger("diff-lens.export_agents")


# ============================================================================
# Pydantic 모델 정의 (JSON 출력 파싱용)
# ============================================================================

class ExtractedField(BaseModel):
    """추출된 필드 하나"""
    key: str = Field(description="필드 키")
    value: str = Field(description="추출된 값")


class FileFieldsResult(BaseModel):
    """파일 하나의 필드 추출 결과"""
    file_path: str = Field(description="파일 경로")
    fields: Dict[str, str] = Field(description="추출된 필드들 (key: value)")


class BatchSummaryResult(BaseModel):
    """배치 요약 결과"""
    summary_type: str = Field(description="요약 타입")
    batch_index: int = Field(description="배치 인덱스")
    summary: str = Field(description="이 배치의 요약")


# ============================================================================
# 사전 정의 요약 타입
class FileFieldExtractorAgent(BaseAgent):
    """파일별 분석 결과에서 사용자 정의 KEY/VALUE 형태로 정보 추출
    
    사용자가 정의한 스키마(KEY, 설명)에 따라 각 파일의 AI 분석 결과에서
    해당 정보를 추출하여 구조화된 형태로 반환합니다.
    """
    
    def __init__(
        self, 
        llm: ChatOpenAI, 
        prompts: Optional[Dict] = None, 
        tracing_context: Optional[LangfuseTracingContext] = None
    ):
        super().__init__(llm, prompts, tracing_context)
        self.system_prompt, self.user_prompt = self._prompt_pair(
            "field_extractor",
            system_default="""당신은 코드 분석 결과에서 정보를 추출하는 전문가입니다.
주어진 파일 분석 결과에서 요청된 필드 정보를 정확하게 추출합니다.

규칙:
1. 각 필드에 대해 분석 결과에서 관련 정보를 찾아 추출합니다.
2. 정보가 없으면 "N/A"로 표시합니다.
3. 추출된 정보는 간결하게 정리합니다.
4. 반드시 유효한 JSON 형식으로 응답합니다.""",
            user_default="""## 파일 정보
- 경로: {file_path}
- 상태: {status}
- 변경량: +{additions} / -{deletions}

## AI 분석 결과
{ai_summary}

## Diff (참고용)
```
{diff_preview}
```

## 추출할 필드
{schema_description}

위 분석 결과에서 각 필드의 값을 추출하여 JSON 형식으로 응답해주세요.
응답 형식:
{{"필드명1": "추출값1", "필드명2": "추출값2", ...}}""",
        )

    def _format_schema(self, schema: List[Dict[str, str]]) -> str:
        """스키마를 문자열로 포맷팅"""
        lines = []
        for item in schema:
            lines.append(f"- **{item['key']}**: {item['description']}")
        return "\n".join(lines)

    def run(
        self, 
        file_info: Dict[str, Any], 
        schema: List[Dict[str, str]]
    ) -> Dict[str, Any]:
        """단일 파일에서 필드 추출
        
        Args:
            file_info: 파일 정보 {path, status, additions, deletions, ai_summary, diff}
            schema: 추출할 필드 스키마 [{key, description}, ...]
            
        Returns:
            추출 결과 {file_path, fields: {key: value, ...}}
        """
        chain = self._build_string_chain(
            "field_extractor",
            system_prompt=self.system_prompt,
            user_prompt=self.user_prompt,
        )
        
        # Diff 미리보기 (너무 길면 축약)
        diff = file_info.get("diff", "")
        diff_preview = diff[:1500] + "..." if len(diff) > 1500 else diff
        
        trace_config = self._get_config(
            trace_name=f"field_extraction:{file_info.get('path', 'unknown')}",
            metadata={"file": file_info.get('path'), "schema_keys": [s['key'] for s in schema]}
        )
        
        try:
            result = chain.invoke({
                "file_path": file_info.get("path", ""),
                "status": file_info.get("status", "modified"),
                "additions": file_info.get("additions", 0),
                "deletions": file_info.get("deletions", 0),
                "ai_summary": file_info.get("ai_summary", "(분석 결과 없음)"),
                "diff_preview": diff_preview,
                "schema_description": self._format_schema(schema)
            }, config=trace_config)
            
            # JSON 파싱 시도
            try:
                # 마크다운 코드블록 제거
                clean_result = result.strip()
                if clean_result.startswith("```"):
                    clean_result = clean_result.split("```")[1]
                    if clean_result.startswith("json"):
                        clean_result = clean_result[4:]
                clean_result = clean_result.strip()
                
                fields = json.loads(clean_result)
            except json.JSONDecodeError:
                # 파싱 실패 시 기본값
                fields = {s['key']: "파싱 실패" for s in schema}
            
            return {
                "file_path": file_info.get("path", ""),
                "fields": fields
            }
            
        except Exception as e:
            logger.error(f"Field extraction failed for {file_info.get('path')}: {e}")
            return {
                "file_path": file_info.get("path", ""),
                "fields": {s['key']: f"오류: {str(e)}" for s in schema}
            }

    async def arun(
        self, 
        file_info: Dict[str, Any], 
        schema: List[Dict[str, str]]
    ) -> Dict[str, Any]:
        """비동기 필드 추출"""
        chain = self._build_string_chain(
            "field_extractor",
            system_prompt=self.system_prompt,
            user_prompt=self.user_prompt,
        )
        
        diff = file_info.get("diff", "")
        diff_preview = diff[:1500] + "..." if len(diff) > 1500 else diff
        
        trace_config = self._get_config(
            trace_name=f"field_extraction_async:{file_info.get('path', 'unknown')}",
            metadata={"file": file_info.get('path'), "schema_keys": [s['key'] for s in schema]}
        )
        
        try:
            result = await chain.ainvoke({
                "file_path": file_info.get("path", ""),
                "status": file_info.get("status", "modified"),
                "additions": file_info.get("additions", 0),
                "deletions": file_info.get("deletions", 0),
                "ai_summary": file_info.get("ai_summary", "(분석 결과 없음)"),
                "diff_preview": diff_preview,
                "schema_description": self._format_schema(schema)
            }, config=trace_config)
            
            try:
                clean_result = result.strip()
                if clean_result.startswith("```"):
                    clean_result = clean_result.split("```")[1]
                    if clean_result.startswith("json"):
                        clean_result = clean_result[4:]
                clean_result = clean_result.strip()
                fields = json.loads(clean_result)
            except json.JSONDecodeError:
                fields = {s['key']: "파싱 실패" for s in schema}
            
            return {
                "file_path": file_info.get("path", ""),
                "fields": fields
            }
            
        except Exception as e:
            logger.error(f"Async field extraction failed for {file_info.get('path')}: {e}")
            return {
                "file_path": file_info.get("path", ""),
                "fields": {s['key']: f"오류: {str(e)}" for s in schema}
            }

    async def extract_batch(
        self,
        files: List[Dict[str, Any]],
        schema: List[Dict[str, str]],
        concurrency: int = 3
    ) -> List[Dict[str, Any]]:
        """여러 파일에서 배치로 필드 추출
        
        Args:
            files: 파일 정보 리스트
            schema: 추출할 필드 스키마
            concurrency: 동시 처리 수
            
        Returns:
            추출 결과 리스트
        """
        semaphore = asyncio.Semaphore(concurrency)
        
        async def extract_with_semaphore(file_info):
            async with semaphore:
                return await self.arun(file_info, schema)
        
        results = await asyncio.gather(*[
            extract_with_semaphore(f) for f in files
        ])
        
        return list(results)


# ============================================================================
# BatchSummaryAgent - 배치 점진적 요약 (Append-Extract 패턴)
# ============================================================================

class BatchSummaryAgent(BaseAgent):
    """배치 단위 점진적 요약 에이전트 (Append-Extract 패턴)
    
    1. 파일들을 배치 단위로 순회하며 각 배치의 분석 결과를 로그(Log) 형태로 누적(Append)
    2. 최종 로그가 완성되면 사용자 정의 스키마에 맞춰 구조화된 데이터 추출(Extract)
    """
    
    def __init__(
        self, 
        llm: ChatOpenAI, 
        prompts: Optional[Dict] = None, 
        tracing_context: Optional[LangfuseTracingContext] = None
    ):
        super().__init__(llm, prompts, tracing_context)
        
        # Step 1: Refine 단계 (누적 업데이트 - 선택된 유형에 집중)
        self.log_system_prompt, self.log_user_prompt = self._prompt_pair(
            "batch_summary_refiner",
            system_default="""당신은 코드 변경 분석의 마스터입니다.
현재까지 작성된 '변경 사항 요약본'을 바탕으로, 새로 입력된 파일들의 내용을 반영하여 요약본을 **주제(Topic) 중심으로 재구성(Refine)**합니다.

⚠️ 핵심 원칙: **선택된 요약 유형에 집중하세요!**
- 아래에 주어지는 "요약 목표"가 이 문서의 유일한 관점입니다.
- 해당 관점과 **직접 관련 없는 변경 사항은 언급하지 마세요.**
- 예: "시스템 위험성 분석"이 목표라면, 단순 코드 정리/리팩토링/기능 추가는 제외하고 **리스크, 장애 가능성, 보안 취약점**만 다루세요.

절대 규칙:
1. **파일 경로를 헤더로 사용하지 마세요.** (예: `### backend/main.py` -> 🚫 금지)
2. 대신 **요약 목표에 맞는 이슈**를 헤더로 사용하세요.
3. 요약 목표와 관련 없는 내용은 **과감히 생략**하세요.
4. 파일명은 각 주제의 설명 끝에 `(관련: main.py)` 형태로 작게 덧붙이세요.""",
            user_default="""## 요약 목표: {summary_type}
📌 **이 관점에서만 분석하세요**: {summary_description}

## 현재 요약본 (Ver.{prev_version})
{current_context}

## 새로 반영할 파일들 ({batch_index}/{total_batches})
{files_content}

## 요청사항
1. 위 파일들 중 **"{summary_type}"과 직접 관련된 내용만** 요약본에 추가하세요.
2. 기존 주제와 연관되면 해당 항목을 보강하고, 새로운 리스크/이슈라면 새 섹션을 만드세요.
3. 단순 코드 정리, 리팩토링, 일반 기능 추가 등 **요약 목표와 무관한 내용은 생략**하세요.
4. 절대로 파일 단위로 목차를 나누지 마세요.""",
        )

        # Step 2: Extract 단계 (최종 구조화)
        self.extract_system_prompt, self.extract_user_prompt = self._prompt_pair(
            "batch_summary_extractor",
            system_default="""당신은 수석 분석가입니다.
여러 배치에 걸쳐 기록된 코드 변경 로그들을 종합하여, 최종적인 구조화된 리포트를 생성합니다.

핵심 규칙:
1. **파일 단위로 정보를 나열하지 마세요.** 의미가 유사하거나 연관된 변경 사항들은 하나의 항목으로 통합해야 합니다.
2. 각 항목의 Key는 파일 경로가 아니라, **"핵심 내용을 요약한 제목"**이어야 합니다.""",
            user_default="""## 전체 변경 로그
{final_context}

## 추출 지침
로그를 분석하여 아래 그룹 정의에 따라 정보를 추출하고 JSON으로 변환하세요.
{groups_description}

## 출력 형식 (JSON)
- 각 그룹의 하위 항목(Item)은 **파일 경로가 아닌, 이슈/기능 단위의 제목**을 Key로 사용하세요.
- 여러 파일이 관련된 경우, 하나의 항목으로 합치고 내용에 포함하세요.
- 리스트([]) 대신 딕셔너리({{}})를 사용하세요.

```json
{{
  "그룹명": {{
    "핵심 이슈 제목(예: 인증 로직 개편)": {{ 
        "속성1": "값1", 
        "속성2": "값2",
        "관련파일": "auth.py, user.py..." 
    }}
  }}
}}
```""",
        )

    def _format_files_content(self, files: List[Dict[str, Any]]) -> str:
        """파일 정보를 문자열로 포맷팅"""
        lines = []
        for f in files:
            lines.append(f"### {f.get('path', 'unknown')}")
            lines.append(f"- 상태: {f.get('status', 'modified')}, +{f.get('additions', 0)}/-{f.get('deletions', 0)}")
            ai_summary = f.get('ai_summary', '')
            if ai_summary:
                # 요약이 너무 길면 축약
                if len(ai_summary) > 500:
                    ai_summary = ai_summary[:500] + "..."
                lines.append(f"- 분석: {ai_summary}")
            lines.append("")
        return "\n".join(lines)

    def _format_groups(self, groups: List[Dict[str, Any]]) -> str:
        """그룹 정의를 문자열로 포맷팅 (키 설명 포함)"""
        lines = []
        for g in groups:
            group_name = g['name']
            group_desc = g.get('description', '')
            lines.append(f"### 그룹: {group_name}")
            if group_desc:
                lines.append(f"컨텍스트: {group_desc}")
            lines.append("추출할 키:")
            
            keys = g.get('keys', [])
            for key_item in keys:
                if isinstance(key_item, str):
                    lines.append(f"  - **{key_item}**: (설명 없음)")
                elif isinstance(key_item, dict):
                    key_name = key_item.get('name', key_item.get('key', ''))
                    key_desc = key_item.get('description', '')
                    if key_desc:
                        lines.append(f"  - **{key_name}**: {key_desc}")
                    else:
                        lines.append(f"  - **{key_name}**")
            lines.append("")
        return "\n".join(lines)

    def _get_summary_config(self, summary_type: str) -> Dict[str, Any]:
        """요약 타입에 따른 설정 반환"""
        if summary_type in PREDEFINED_SUMMARY_TYPES:
            return PREDEFINED_SUMMARY_TYPES[summary_type]
        return {
            "name": "커스텀 요약",
            "icon": "🔧",
            "description": "사용자 정의 요약",
            "groups": []
        }

    def run_generator(
        self,
        files: List[Dict[str, Any]],
        summary_type: str = "risk_analysis",
        batch_size: int = 4,
        custom_groups: Optional[List[Dict[str, Any]]] = None
    ) -> Generator[Dict[str, Any], None, None]:
        """배치 점진적 요약 실행 (Refine -> Extract)"""
        # 설정 가져오기
        config = self._get_summary_config(summary_type)
        groups = custom_groups if summary_type == "custom" and custom_groups else config.get("groups", [])
        
        if not groups:
            msg = "그룹 정의가 없습니다."
            yield {"type": "error", "message": msg}
            return
        
        # 배치 분할
        batches = [files[i:i + batch_size] for i in range(0, len(files), batch_size)]
        total_batches = len(batches)
        
        logger.info(f"[BatchSummary] {summary_type} 요약 시작: {len(files)}개 파일, {total_batches}개 배치")
        yield {
            "type": "progress",
            "stage": "start", 
            "message": f"{summary_type} 분석 시작 ({len(files)}개 파일)", 
            "total_files": len(files),
            "total_batches": total_batches
        }
        
        # Log 단계 체인 초기화
        log_chain = self._build_string_chain(
            "batch_summary_refiner",
            system_prompt=self.log_system_prompt,
            user_prompt=self.log_user_prompt,
        )
        
        log_entries = [] # 리스트 형태의 누적 로그 (Refine History)
        current_context = "아직 분석된 내용이 없습니다."

        # 순차 처리 (Refine Loop)
        for batch_idx, batch_files in enumerate(batches):
            msg = f"배치 {batch_idx + 1}/{total_batches} 반영 중 (Refining)..."
            logger.info(f"[BatchSummary] {msg}")
            
            trace_config = self._get_config(
                trace_name=f"batch_summary_refine:{summary_type}:batch{batch_idx}",
                metadata={"summary_type": summary_type, "batch": batch_idx + 1, "total": total_batches}
            )
            
            try:
                # Thinking Event
                yield {
                    "type": "thinking",
                    "batch": batch_idx + 1,
                    "message": f"기존 요약본에 배치 {batch_idx + 1} 내용 반영 중..."
                }

                # LLM 호출 (Refine)
                new_context = log_chain.invoke({
                    "summary_type": config.get("name", summary_type),
                    "summary_description": config.get("description", ""),
                    "files_content": self._format_files_content(batch_files),
                    "current_context": current_context,
                    "prev_version": batch_idx,
                    "batch_index": batch_idx + 1,
                    "total_batches": total_batches
                }, config=trace_config)
                
                # Context 업데이트
                current_context = new_context.strip()
                
                # ====== 길이 체크 & 자동 압축 ======
                MAX_CONTEXT_LENGTH = 1000  # 임계값 (글자 수)
                if len(current_context) > MAX_CONTEXT_LENGTH:
                    logger.info(f"[BatchSummary] 요약본 길이 초과({len(current_context)}자), 압축 시작...")
                    yield {
                        "type": "thinking",
                        "message": f"요약본이 너무 길어졌습니다({len(current_context)}자). 핵심만 남기고 압축 중..."
                    }
                    
                    compress_chain = self._build_string_chain("batch_summary_compressor")
                    
                    compress_config = self._get_config(
                        trace_name=f"batch_summary_compress:{summary_type}:batch{batch_idx}",
                        metadata={"original_length": len(current_context)}
                    )
                    
                    try:
                        compressed = compress_chain.invoke({
                            "context": current_context,
                            "summary_type": config.get("name", summary_type),
                            "summary_description": config.get("description", "핵심 정보만 유지"),
                        }, config=compress_config)
                        
                        old_len = len(current_context)
                        current_context = compressed.strip()
                        new_len = len(current_context)
                        logger.info(f"[BatchSummary] 압축 완료: {old_len}자 -> {new_len}자 ({round(new_len/old_len*100)}%)")
                    except Exception as ce:
                        logger.warning(f"[BatchSummary] 압축 실패, 원본 유지: {ce}")
                # ====== 압축 끝 ======
                
                # 히스토리에 스냅샷 저장
                log_entries.append({
                    "batch_index": batch_idx + 1,
                    "total_batches": total_batches,
                    "content": current_context, # 현재 시점의 전체 요약
                    "files_count": len(batch_files),
                    "char_count": len(current_context)  # 길이 정보 추가
                })
                
                # 진행 상황 Yield
                current_data_structure = {
                    "summary_type": summary_type + " (진행 중)",
                    "final_summary": log_entries, # 리스트 (히스토리)
                    "is_list_format": True,
                    "stats": {
                        "total_files": len(files),
                        "total_batches": total_batches,
                        "completed_batches": batch_idx + 1,
                        "current_summary_length": len(current_context)
                    }
                }

                yield {
                    "type": "progress",
                    "stage": "processing",
                    "message": msg,
                    "completed_batches": batch_idx + 1,
                    "total_batches": total_batches,
                    "data": current_data_structure 
                }
                    
            except Exception as e:
                logger.error(f"Batch {batch_idx} refine failed: {e}")
                
                # 에러도 히스토리에 남김
                log_entries.append({
                     "batch_index": batch_idx + 1,
                     "total_batches": total_batches,
                     "content": f"작성 실패: {str(e)}\n\n(이전 내용은 유지됩니다)",
                     "is_error": True
                })
                
                yield {
                    "type": "error", 
                    "message": f"배치 {batch_idx + 1} 처리 실패: {str(e)}",
                    "warning": True
                }
        
        # Final Extract 단계: 최종 구조화
        logger.info(f"[BatchSummary] 최종 구조화 시작")
        yield {
            "type": "thinking",
            "message": "완성된 요약본을 바탕으로 최종 결과를 구조화(Extract) 하는 중..."
        }
        
        try:
            # 최종 완성된 텍스트(Last Refined Context) 사용
            full_log_text = current_context

            extract_chain = self._build_string_chain(
                "batch_summary_extractor",
                system_prompt=self.extract_system_prompt,
                user_prompt=self.extract_user_prompt,
            )
            
            trace_config = self._get_config(
                trace_name=f"batch_summary_extract:{summary_type}",
                metadata={"summary_type": summary_type}
            )
            
            json_result_str = extract_chain.invoke({
                "final_context": full_log_text,
                "groups_description": self._format_groups(groups)
            }, config=trace_config)
            
            # JSON 파싱
            final_json = {}
            try:
                clean_result = json_result_str.strip()
                if clean_result.startswith("```"):
                    clean_result = clean_result.split("```")[1]
                    if clean_result.startswith("json"):
                        clean_result = clean_result[4:]
                clean_result = clean_result.strip()
                final_json = json.loads(clean_result)
            except json.JSONDecodeError:
                logger.error(f"Final JSON Parse Error. Raw: {json_result_str}")
                final_json = {
                    "error": "JSON 파싱 실패", 
                    "raw_text": full_log_text,
                    "parse_error_content": json_result_str
                }
            
            # 최종 결과 Yield
            final_result = {
                "summary_type": summary_type,
                "description": config.get("description", ""),
                "final_summary": final_json,
                "log_entries": log_entries, # 히스토리 전달
                "stats": {
                    "total_files": len(files),
                    "total_batches": total_batches,
                    "processed_at": datetime.now().isoformat()
                }
            }
            
            yield {"type": "result", "data": final_result}
            
        except Exception as e:
            logger.error(f"Final extraction failed: {e}")
            yield {"type": "error", "message": f"최종 구조화 실패: {str(e)}"}

    def run(
        self,
        files: List[Dict[str, Any]],
        summary_type: str = "risk_analysis",
        batch_size: int = 4,
        custom_groups: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """배치 점진적 요약 실행 (동기 래퍼 for Backward Compatibility)"""
        last_result = None
        for event in self.run_generator(files, summary_type, batch_size, custom_groups):
            if event["type"] == "result":
                last_result = event["data"]
            elif event["type"] == "error":
                pass
                
        if not last_result:
            return {
                "summary_type": summary_type,
                "final_summary": {},
                "intermediate_summaries": [],
                "stats": {"error": "결과 생성 실패"}
            }
        return last_result

    @staticmethod
    def get_available_types() -> Dict[str, Dict[str, Any]]:
        """사용 가능한 요약 타입 목록 반환"""
        return {
            key: {
                "name": val["name"],
                "icon": val["icon"],
                "description": val["description"]
            }
            for key, val in PREDEFINED_SUMMARY_TYPES.items()
        }

    @staticmethod
    def get_flat_templates() -> Dict[str, Dict[str, Any]]:
        """사용 가능한 FLAT 템플릿 목록 반환"""
        prompt_templates = _flat_templates_from_prompt_config(DEFAULT_PROMPTS)
        source = prompt_templates or FLAT_SUMMARY_TEMPLATES
        return {
            key: {
                "name": val["name"],
                "icon": val["icon"],
                "description": val["description"],
                "category": val["category"],
                "columns": val["columns"]
            }
            for key, val in source.items()
        }

    def run_flat(self, files: list, template_type: str, batch_size: int = 5, custom_config: dict = None) -> dict:
        """FLAT 요약 실행 (동기 래퍼)"""
        last_result = None
        for event in self.run_flat_generator(files, template_type, batch_size, custom_config):
            if event["type"] == "result":
                last_result = event["data"]
        return last_result if last_result else {"error": "No result generated"}

    def run_flat_generator(self, files: list, template_type: str, batch_size: int = 5, custom_config: dict = None):
        """FLAT 요약 실행 (제너레이터 - 진행상황 보고)"""
        # 템플릿 설정 가져오기
        prompt_templates = _flat_templates_from_prompt_config(self.prompts)
        template_catalog = prompt_templates or FLAT_SUMMARY_TEMPLATES

        if template_type == "custom" and custom_config:
            config = {
                "name": "커스텀",
                "icon": "🔧",
                "description": "사용자 정의 FLAT 템플릿",
                **custom_config
            }
            config = _normalize_flat_template(template_type, config)
        elif template_type in template_catalog:
            config = _normalize_flat_template(template_type, template_catalog[template_type])
        else:
            yield {
                "type": "error", 
                "message": f"Unknown template type: {template_type}"
            }
            return
        
        category = config.get("category", {})
        columns = config.get("columns", [])
        map_prompt = config.get("map_prompt", "각 파일의 변경 내용을 분석하세요.")
        
        # 배치 분할
        batches = [files[i:i + batch_size] for i in range(0, len(files), batch_size)]
        total_batches = len(batches)
        
        import time
        from concurrent.futures import ThreadPoolExecutor, as_completed
        
        start_time = time.time()
        
        logger.info(f"[BatchSummary FLAT] {config.get('name')} 시작: {len(files)}개 파일, {total_batches}개 배치")
        yield {
            "type": "progress",
            "stage": "start",
            "message": f"분석 시작: {len(files)}개 파일, {total_batches}개 배치",
            "total_batches": total_batches,
            "completed_batches": 0
        }
        
        # =====================================================
        # MAP 단계: 배치별 분석 (병렬 처리 - 최대 5개 동시)
        # =====================================================
        map_system_default = """당신은 코드 변경 분석 전문가입니다.
주어진 파일들의 변경 내용을 분석하여 요청된 카테고리로 분류하세요.

카테고리: {category_name}
가능한 값: {category_values}

{custom_map_instruction}

각 파일을 분석하고, 해당 카테고리 값과 함께 정보를 추출하세요.
JSON 형식으로 응답하세요."""

        map_user_default = """## 분석할 파일들 (배치 {batch_index}/{total_batches})
{files_content}

## 추출할 정보
카테고리: {category_name}
컬럼: {columns_desc}

응답 형식:
{{
  "분석결과": [
    {{"파일": "파일경로", "카테고리": "값", "컬럼1": "내용", ...}},
    ...
  ]
}}"""

        map_chain = self._build_string_chain(
            "export_flat_summary",
            system_key="map_system_prompt",
            user_key="map_user_prompt",
            system_default=map_system_default,
            user_default=map_user_default,
        )
        
        columns_desc = ", ".join([f"{c['name']}: {c.get('description', '')}" for c in columns])
        all_file_analyses = []
        
        # 병렬 처리를 위한 함수
        def process_batch(batch_idx: int, batch_files: list) -> list:
            trace_config = self._get_config(
                trace_name=f"flat_summary_map:{template_type}:batch{batch_idx}",
                metadata={"template": template_type, "batch": batch_idx + 1}
            )
            
            try:
                result = map_chain.invoke({
                    "batch_index": batch_idx + 1,
                    "total_batches": total_batches,
                    "files_content": self._format_files_content(batch_files),
                    "category_name": category.get('name', '분류'),
                    "category_values": ", ".join(category.get('values', [])),
                    "columns_desc": columns_desc,
                    "custom_map_instruction": map_prompt,
                }, config=trace_config)
                
                parsed = self._parse_json_response(result)
                if "분석결과" in parsed:
                    return parsed["분석결과"]
                return []
            except Exception as e:
                logger.error(f"MAP batch {batch_idx + 1} failed: {e}")
                return []
        
        # 병렬 처리 (최대 5개 동시)
        max_concurrent = min(5, total_batches)
        with ThreadPoolExecutor(max_workers=max_concurrent) as executor:
            future_to_batch = {executor.submit(process_batch, idx, batch): idx for idx, batch in enumerate(batches)}
            
            completed_count = 0
            for future in as_completed(future_to_batch):
                batch_idx = future_to_batch[future]
                try:
                    result = future.result(timeout=120)
                    all_file_analyses.extend(result)
                    completed_count += 1
                    
                    yield {
                        "type": "progress",
                        "stage": "map",
                        "message": f"분석 중... ({completed_count}/{total_batches})",
                        "total_batches": total_batches,
                        "completed_batches": completed_count,
                        "current_batch": batch_idx + 1
                    }
                except Exception as e:
                    logger.error(f"Batch {batch_idx} future failed: {e}")
        
        map_time = time.time() - start_time
        logger.info(f"[BatchSummary FLAT] MAP 완료: {len(all_file_analyses)}개 분석, {map_time:.1f}초")
        
        yield {
            "type": "progress",
            "stage": "aggregating",
            "message": "분석 결과 집계 중...",
            "total_batches": total_batches,
            "completed_batches": total_batches
        }
        
        # =====================================================
        # FINAL 단계: 카테고리별 직접 집계 (LLM 없이 파이썬 코드로)
        # =====================================================
        final_start = time.time()
        
        category_name = category.get('name', '분류')
        category_values = category.get('values', [])
        
        # 카테고리별로 분석 결과 그룹화
        grouped = {val: [] for val in category_values}
        for analysis in all_file_analyses:
            cat_val = analysis.get("카테고리", analysis.get(category_name, ""))
            if cat_val in grouped:
                grouped[cat_val].append(analysis)
            else:
                # 가장 유사한 카테고리 찾기 (부분 매치)
                found = False
                for val in category_values:
                    if val in cat_val or cat_val in val:
                        grouped[val].append(analysis)
                        found = True
                        break
                if not found:
                    # 어디에도 속하지 않으면 첫 번째 카테고리 또는 기타에 넣을 수도 있지만, 여기선 무시하거나 첫번째에 넣음
                    if category_values:
                        grouped[category_values[0]].append(analysis)
        
        # 각 카테고리별로 집계하여 테이블 생성
        flat_table = []
        for cat_val in category_values:
            items = grouped.get(cat_val, [])
            row = {category_name: cat_val}
            
            for col in columns:
                col_name = col['name']
                if not items:
                    row[col_name] = "-"
                elif "파일" in col_name.lower():
                    # 파일 목록 컬럼
                    file_list = [item.get("파일", "").split("/")[-1] for item in items if item.get("파일")]
                    row[col_name] = ", ".join(file_list[:10]) if file_list else "-"
                    if len(file_list) > 10:
                        row[col_name] += f" 외 {len(file_list) - 10}개"
                else:
                    # 다른 컬럼: 첫 번째 값 또는 통합
                    values = [item.get(col_name, "") for item in items if item.get(col_name)]
                    if values:
                        # 중복 제거 후 결합
                        unique_vals = list(dict.fromkeys(values))[:3]
                        row[col_name] = " / ".join(unique_vals)
                        if len(values) > 3:
                            row[col_name] += " ..."
                    else:
                        row[col_name] = "-"
            
            row["_count"] = len(items)  # 파일 개수
            flat_table.append(row)
        
        final_time = time.time() - final_start
        total_time = time.time() - start_time
        
        logger.info(f"[BatchSummary FLAT] ✓ {config.get('name')} 완료: {len(flat_table)}행, 총 {total_time:.1f}초")
        
        final_result = {
            "success": True,
            "template_type": template_type,
            "template_name": config.get("name", template_type),
            "template_icon": config.get("icon", "📊"),
            "output_format": "flat",
            "category": category,
            "columns": columns,
            "table": flat_table,
            "raw_analyses": all_file_analyses,
            "stats": {
                "total_files": len(files),
                "total_batches": total_batches,
                "batch_size": batch_size,
                "table_rows": len(flat_table),
                "analyzed_files": len(all_file_analyses),
                "map_time_seconds": round(map_time, 2),
                "final_time_seconds": round(final_time, 2),
                "total_time_seconds": round(total_time, 2),
                "concurrent_batches": max_concurrent
            }
        }
        
        yield {
            "type": "result",
            "data": final_result
        }

    def _parse_json_response(self, response: str) -> Any:
        """JSON 응답 파싱 (마크다운 코드블록 처리)"""
        clean = response.strip()
        if clean.startswith("```"):
            parts = clean.split("```")
            if len(parts) >= 2:
                clean = parts[1]
                if clean.startswith("json"):
                    clean = clean[4:]
        clean = clean.strip()
        try:
            return json.loads(clean)
        except json.JSONDecodeError:
            return {"parse_error": response}


# ============================================================================
# 유틸리티 함수
# ============================================================================

def get_export_llm(
    openai_api_key: Optional[str] = None,
    openai_base_url: Optional[str] = None,
    openai_model: str = "gpt-4o-mini"
) -> Optional[ChatOpenAI]:
    """Export 에이전트용 LLM 인스턴스 생성"""
    return get_llm(
        model=openai_model,
        temperature=0.2,  # 추출 작업은 더 낮은 temperature
        openai_api_key=openai_api_key,
        openai_base_url=openai_base_url
    )


def create_export_agents(
    openai_api_key: Optional[str] = None,
    openai_base_url: Optional[str] = None,
    openai_model: str = "gpt-4o-mini",
    langfuse_public_key: Optional[str] = None,
    langfuse_secret_key: Optional[str] = None,
    langfuse_host: Optional[str] = None,
    session_id: Optional[str] = None
) -> Dict[str, BaseAgent]:
    """모든 Export 에이전트 인스턴스 생성
    
    Returns:
        {
            "field_extractor": FileFieldExtractorAgent,
            "batch_summary": BatchSummaryAgent,
            "custom_group": CustomGroupExportAgent
        }
    """
    llm = get_export_llm(openai_api_key, openai_base_url, openai_model)
    if not llm:
        raise ValueError("LLM 초기화 실패: OpenAI API 키를 확인하세요.")
    
    tracing_context = create_tracing_context(
        langfuse_public_key=langfuse_public_key,
        langfuse_secret_key=langfuse_secret_key,
        langfuse_host=langfuse_host,
        session_id=session_id or "export-analysis",
        tags=["export", "analysis"]
    )
    
    return {
        "field_extractor": FileFieldExtractorAgent(llm, None, tracing_context),
        "batch_summary": BatchSummaryAgent(llm, None, tracing_context),
        "custom_group": CustomGroupExportAgent(llm, None, tracing_context)
    }
