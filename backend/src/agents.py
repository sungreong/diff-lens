import os
import logging
from typing import List, Optional, Dict, Any
from abc import ABC, abstractmethod
from langchain_openai import ChatOpenAI
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnableConfig

from .agent_runtime import create_tracing_context, get_llm, llm_client_stats
from .models import FileChange
from .git_client import build_diff_evidence
from .langfuse_utils import (
    LangfuseTracingContext
)
from .prompt_registry import (
    DEFAULT_PROMPTS,
    build_chat_prompt,
    build_string_chain,
    get_prompt_config,
    get_prompt_pair,
    load_default_prompts,
    merge_prompt_configs,
)

# Setup logger
logger = logging.getLogger("diff-lens.agents")


class BaseAgent(ABC):
    """Base class for all agents with Langfuse tracing support"""
    
    def __init__(
        self, 
        llm: ChatOpenAI, 
        prompts: Optional[Dict] = None,
        tracing_context: Optional[LangfuseTracingContext] = None
    ):
        self.llm = llm
        self.prompts = merge_prompt_configs(prompts)
        # Tracing context for Langfuse monitoring
        self.tracing_context = tracing_context
        
        # Log agent initialization
        agent_name = self.__class__.__name__
        if tracing_context and tracing_context.is_enabled:
            logger.debug(f"{agent_name} initialized with Langfuse tracing ✓")
        else:
            logger.debug(f"{agent_name} initialized (no tracing)")
    
    def _get_config(
        self, 
        trace_name: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Optional[RunnableConfig]:
        """Get RunnableConfig with tracing if context is available."""
        if self.tracing_context:
            config = self.tracing_context.get_config(
                trace_name=trace_name,
                metadata=metadata
            )
            logger.debug(f"Trace: {trace_name} (Langfuse enabled: {self.tracing_context.is_enabled})")
            return config
        return None

    def _prompt_config(self, name: str) -> Dict[str, Any]:
        """Return this agent's merged prompt config for a registry key."""
        return get_prompt_config(self.prompts, name)

    def _prompt_pair(
        self,
        name: str,
        *,
        system_default: str = "",
        user_default: str = "",
        system_key: str = "system_prompt",
        user_key: str = "user_prompt",
    ) -> tuple[str, str]:
        return get_prompt_pair(
            self.prompts,
            name,
            system_key=system_key,
            user_key=user_key,
            system_default=system_default,
            user_default=user_default,
        )

    def _build_prompt(self, name: str, **kwargs: Any):
        return build_chat_prompt(self.prompts, name, **kwargs)

    def _build_string_chain(self, name: str, **kwargs: Any):
        return build_string_chain(self.llm, self.prompts, name, **kwargs)
    
    @abstractmethod
    def run(self, *args, **kwargs) -> str:
        pass


class FileAnalyzerAgent(BaseAgent):
    """Agent that analyzes individual file changes for evidence documentation
    
    Enhanced to:
    - Chunk large diffs (>3000 chars) for better analysis
    - Include related commit messages in context
    - Consolidate chunk results using DiffConsolidatorAgent
    """
    
    CHUNK_SIZE = 3000  # Characters per chunk
    
    def __init__(self, llm: ChatOpenAI, prompts: Optional[Dict] = None, tracing_context: Optional[LangfuseTracingContext] = None):
        super().__init__(llm, prompts, tracing_context)
        self.system_prompt, self.user_prompt = self._prompt_pair(
            "file_analyzer",
            system_default="당신은 코드 변경 증빙 문서 작성 전문가입니다.",
            user_default="## 파일 정보\n- 경로: {path}\n- 상태: {status}\n- 변경량: +{additions} / -{deletions}\n\n## 관련 커밋\n{commit_context}\n\n{evidence_context}\n\n## Diff{chunk_info}\n```\n{diff}\n```\n\n위 diff를 분석하여 전/후 증빙과 보수적 리스크 검토를 작성해주세요.\n각 섹션은 `### 섹션명` Markdown 제목으로 분리하고, 본문은 불릿으로 작성하세요.\n섹션 제목과 본문 사이에는 빈 줄을 넣고 여러 섹션을 한 문단에 이어 쓰지 마세요.",
        )
        self.consolidator = None  # Lazy init

    def _get_consolidator(self):
        if self.consolidator is None:
            self.consolidator = DiffConsolidatorAgent(self.llm, self.prompts, self.tracing_context)
        return self.consolidator
    
    def _format_commit_context(self, file: FileChange) -> str:
        """Format related commits for context"""
        if not file.related_commits:
            return "(관련 커밋 정보 없음)"
        
        lines = []
        for c in file.related_commits[:5]:  # Limit to 5 commits
            lines.append(f"- [{c.get('id', '')}] {c.get('title', '')} (by {c.get('author', '')})")
        
        if len(file.related_commits) > 5:
            lines.append(f"- ... 외 {len(file.related_commits) - 5}개")
        
        return "\n".join(lines)

    def _format_evidence_context(self, file: FileChange) -> str:
        """Format deterministic evidence metadata for the LLM."""
        evidence_lines = []
        for item in file.change_evidence[:5]:
            quote = item.get("quote") or ""
            evidence_lines.append(
                f"- Hunk {item.get('hunk_index')} ({item.get('line_hint')}): "
                f"{item.get('header')}\n  {quote[:300]}"
            )
        evidence = "\n".join(evidence_lines) if evidence_lines else "(diff hunk evidence 없음)"
        checks = "\n".join([f"- {check}" for check in file.recommended_checks]) or "- 변경 범위 수동 확인"
        warnings = ", ".join(file.analysis_warnings) if file.analysis_warnings else "(없음)"
        return f"""## 전/후 증빙
- Before: {file.before_summary or '(없음)'}
- After: {file.after_summary or '(없음)'}
- 증거 수준: {file.evidence_level}
- 생략된 hunk 수: {file.omitted_hunks}
- 분석 경고: {warnings}

## 변경 근거
{evidence}

## 보수적 리스크 초안
- 판정: {file.risk_verdict}
- 이유: {file.risk_reason or '증거 부족'}
- 신뢰도: {file.confidence}
- 불확실성: {file.uncertainty_reason or '(없음)'}

## 권장 확인
{checks}"""

    def _prepare_prompt_inputs(self, commit_context: str, evidence_context: str, diff_chunk: str) -> Dict[str, str]:
        """Keep saved custom prompts compatible with newer evidence inputs.

        Existing profile prompts may not contain {evidence_context}. If possible,
        attach evidence to {commit_context}; if that placeholder is also absent,
        prepend it to {diff}, which is required by settings validation.
        """
        has_evidence_var = "{evidence_context}" in self.user_prompt
        has_commit_var = "{commit_context}" in self.user_prompt

        if has_evidence_var:
            return {
                "commit_context": commit_context,
                "evidence_context": evidence_context,
                "diff": diff_chunk
            }

        if has_commit_var:
            return {
                "commit_context": f"{commit_context}\n\n{evidence_context}",
                "evidence_context": evidence_context,
                "diff": diff_chunk
            }

        return {
            "commit_context": commit_context,
            "evidence_context": evidence_context,
            "diff": f"{evidence_context}\n\n## Raw Diff\n{diff_chunk}"
        }
    
    def _chunk_diff(self, diff_text: str) -> List[str]:
        """Split diff into manageable chunks"""
        if len(diff_text) <= self.CHUNK_SIZE:
            return [diff_text]
        
        chunks = []
        lines = diff_text.split('\n')
        current_chunk = []
        current_size = 0
        
        for line in lines:
            line_size = len(line) + 1  # +1 for newline
            if current_size + line_size > self.CHUNK_SIZE and current_chunk:
                chunks.append('\n'.join(current_chunk))
                current_chunk = []
                current_size = 0
            current_chunk.append(line)
            current_size += line_size
        
        if current_chunk:
            chunks.append('\n'.join(current_chunk))
        
        return chunks

    def run(self, file: FileChange) -> str:
        """Analyze a single file and return summary"""
        logger.info(f"[FileAnalyzer] 분석 시작: {file.path} (status={file.status}, +{file.additions}/-{file.deletions})")
        
        # Handle history-only files
        if file.has_history_only:
            commit_desc = ", ".join([c.get('title', '')[:30] for c in file.related_commits[:3]])
            logger.info(f"[FileAnalyzer] → History-only 파일, LLM 호출 생략")
            return f"📝 중간 변경 후 원복됨 (커밋: {commit_desc})"
        
        if not file.diff:
            logger.info(f"[FileAnalyzer] → No-diff 파일, 커밋 컨텍스트 기반 분석")
            commit_context = self._format_commit_context(file)
            return (
                f"- **Before**: {file.before_summary or '(증거 없음)'}\n"
                f"- **After**: {file.after_summary or '(증거 없음)'}\n"
                f"- **변경 내용**: 최종 diff가 제공되지 않아 코드 변경 사실을 직접 확인할 수 없습니다.\n"
                f"- **근거**: {commit_context}\n"
                f"- **문제 여부**: 불확실\n"
                f"- **검증 권고**: base/target 파일 내용과 관련 커밋 diff를 직접 확인하세요."
            )
        
        commit_context = self._format_commit_context(file)
        evidence_context = self._format_evidence_context(file)
        chunks = self._chunk_diff(file.diff)
        
        chain = self._build_string_chain(
            "file_analyzer",
            system_prompt=self.system_prompt,
            user_prompt=self.user_prompt,
        )
        
        try:
            # Get tracing config for file analysis
            trace_config = self._get_config(
                trace_name=f"file_analysis:{file.path}",
                metadata={"file_path": file.path, "status": file.status}
            )
            
            if len(chunks) == 1:
                # Single chunk - direct analysis
                logger.info(f"[FileAnalyzer] → 단일 청크 ({len(file.diff)}자), LLM 분석 중...")
                prompt_inputs = self._prepare_prompt_inputs(commit_context, evidence_context, chunks[0])
                result = chain.invoke({
                    "path": file.path,
                    "status": file.status,
                    "additions": file.additions,
                    "deletions": file.deletions,
                    "commit_context": prompt_inputs["commit_context"],
                    "evidence_context": prompt_inputs["evidence_context"],
                    "chunk_info": "",
                    "diff": prompt_inputs["diff"]
                }, config=trace_config)
                logger.info(f"[FileAnalyzer] ✓ 분석 완료: {file.path}")
                return result
            else:
                # Multiple chunks - analyze each and consolidate
                logger.info(f"[FileAnalyzer] → 대용량 파일, {len(chunks)}개 청크로 분할 분석")
                chunk_summaries = []
                for i, chunk in enumerate(chunks):
                    logger.info(f"[FileAnalyzer]   청크 {i+1}/{len(chunks)} 분석 중...")
                    prompt_inputs = self._prepare_prompt_inputs(commit_context, evidence_context, chunk)
                    summary = chain.invoke({
                        "path": file.path,
                        "status": file.status,
                        "additions": file.additions,
                        "deletions": file.deletions,
                        "commit_context": prompt_inputs["commit_context"],
                        "evidence_context": prompt_inputs["evidence_context"],
                        "chunk_info": f" (청크 {i+1}/{len(chunks)})",
                        "diff": prompt_inputs["diff"]
                    }, config=trace_config)
                    chunk_summaries.append(summary)
                
                # Consolidate
                logger.info(f"[FileAnalyzer]   청크 통합 중...")
                consolidated = self._get_consolidator().run(file.path, chunk_summaries)
                logger.info(f"[FileAnalyzer] ✓ 분석 완료: {file.path}")
                return consolidated
        except Exception as e:
            return f"분석 실패: {str(e)}"

    async def arun(self, file: FileChange) -> str:
        """Async analyze a single file and return summary"""
        # Handle history-only files
        if file.has_history_only:
            commit_desc = ", ".join([c.get('title', '')[:30] for c in file.related_commits[:3]])
            return f"📝 중간 변경 후 원복됨 (커밋: {commit_desc})"
        
        if not file.diff:
            commit_context = self._format_commit_context(file)
            return (
                f"- **Before**: {file.before_summary or '(증거 없음)'}\n"
                f"- **After**: {file.after_summary or '(증거 없음)'}\n"
                f"- **변경 내용**: 최종 diff가 제공되지 않아 코드 변경 사실을 직접 확인할 수 없습니다.\n"
                f"- **근거**: {commit_context}\n"
                f"- **문제 여부**: 불확실\n"
                f"- **검증 권고**: base/target 파일 내용과 관련 커밋 diff를 직접 확인하세요."
            )
        
        commit_context = self._format_commit_context(file)
        evidence_context = self._format_evidence_context(file)
        chunks = self._chunk_diff(file.diff)
        
        chain = self._build_string_chain(
            "file_analyzer",
            system_prompt=self.system_prompt,
            user_prompt=self.user_prompt,
        )
        
        try:
            # Get tracing config for file analysis
            trace_config = self._get_config(
                trace_name=f"file_analysis_async:{file.path}",
                metadata={"file_path": file.path, "status": file.status}
            )
            
            if len(chunks) == 1:
                # Single chunk - direct analysis
                prompt_inputs = self._prepare_prompt_inputs(commit_context, evidence_context, chunks[0])
                return await chain.ainvoke({
                    "path": file.path,
                    "status": file.status,
                    "additions": file.additions,
                    "deletions": file.deletions,
                    "commit_context": prompt_inputs["commit_context"],
                    "evidence_context": prompt_inputs["evidence_context"],
                    "chunk_info": "",
                    "diff": prompt_inputs["diff"]
                }, config=trace_config)
            else:
                # Multiple chunks - analyze each and consolidate
                import asyncio
                chunk_concurrency = max(1, int(os.getenv("AI_CHUNK_CONCURRENCY", "3")))
                chunk_semaphore = asyncio.Semaphore(chunk_concurrency)
                
                async def analyze_chunk(i: int, chunk: str):
                    async with chunk_semaphore:
                        prompt_inputs = self._prepare_prompt_inputs(commit_context, evidence_context, chunk)
                        return await chain.ainvoke({
                            "path": file.path,
                            "status": file.status,
                            "additions": file.additions,
                            "deletions": file.deletions,
                            "commit_context": prompt_inputs["commit_context"],
                            "evidence_context": prompt_inputs["evidence_context"],
                            "chunk_info": f" (청크 {i+1}/{len(chunks)})",
                            "diff": prompt_inputs["diff"]
                        }, config=trace_config)
                
                chunk_summaries = await asyncio.gather(*[
                    analyze_chunk(i, chunk) for i, chunk in enumerate(chunks)
                ])
                
                # Consolidate
                return await self._get_consolidator().arun(file.path, list(chunk_summaries))
        except Exception as e:
            return f"분석 실패: {str(e)}"


class CategoryAgent(BaseAgent):
    """Agent that categorizes files by their purpose (frontend/backend/config/etc)"""
    
    def run(self, files: List[FileChange]) -> dict:
        """Categorize files by type"""
        categories = {
            "frontend": [],
            "backend": [],
            "config": [],
            "docs": [],
            "tests": [],
            "other": []
        }
        
        for file in files:
            path_lower = file.path.lower()
            
            if any(x in path_lower for x in ['.jsx', '.tsx', '.vue', '.css', '.scss', 'frontend/', 'src/components', 'src/pages']):
                categories["frontend"].append(file)
            elif any(x in path_lower for x in ['.py', 'backend/', 'api/', 'server/']):
                categories["backend"].append(file)
            elif any(x in path_lower for x in ['test', 'spec', '__test__']):
                categories["tests"].append(file)
            elif any(x in path_lower for x in ['.md', '.txt', '.rst', 'docs/']):
                categories["docs"].append(file)
            elif any(x in path_lower for x in ['.json', '.yaml', '.yml', '.toml', '.env', 'config', 'dockerfile', 'docker-compose']):
                categories["config"].append(file)
            else:
                categories["other"].append(file)
        
        return {k: v for k, v in categories.items() if v}


class DiffConsolidatorAgent(BaseAgent):
    """Agent that consolidates multiple chunk summaries into a single coherent analysis"""
    
    def __init__(self, llm: ChatOpenAI, prompts: Optional[Dict] = None, tracing_context: Optional[LangfuseTracingContext] = None):
        super().__init__(llm, prompts, tracing_context)
        self.system_prompt, self.user_prompt = self._prompt_pair(
            "diff_consolidator",
            system_default="당신은 코드 분석 전문가입니다. 여러 개의 부분 분석 결과를 하나의 일관된 요약으로 통합합니다.",
            user_default="## 파일 정보\n- 경로: {file_path}\n\n## 청크별 분석 결과\n{chunk_summaries}\n\n위 부분 분석들을 하나의 통합 요약으로 정리해주세요:",
        )
    
    def run(self, file_path: str, chunk_summaries: List[str]) -> str:
        """Consolidate multiple chunk summaries into one"""
        if len(chunk_summaries) == 1:
            return chunk_summaries[0]
        
        formatted_chunks = "\n\n".join([
            f"### 청크 {i+1}\n{summary}" 
            for i, summary in enumerate(chunk_summaries)
        ])
        
        chain = self._build_string_chain(
            "diff_consolidator",
            system_prompt=self.system_prompt,
            user_prompt=self.user_prompt,
        )
        
        # Get tracing config
        trace_config = self._get_config(
            trace_name=f"diff_consolidation:{file_path}",
            metadata={"file_path": file_path, "chunk_count": len(chunk_summaries)}
        )
        
        try:
            return chain.invoke({
                "file_path": file_path,
                "chunk_summaries": formatted_chunks
            }, config=trace_config)
        except Exception as e:
            return f"통합 실패: {str(e)}"
    
    async def arun(self, file_path: str, chunk_summaries: List[str]) -> str:
        """Async consolidate multiple chunk summaries into one"""
        if len(chunk_summaries) == 1:
            return chunk_summaries[0]
        
        formatted_chunks = "\n\n".join([
            f"### 청크 {i+1}\n{summary}" 
            for i, summary in enumerate(chunk_summaries)
        ])
        
        chain = self._build_string_chain(
            "diff_consolidator",
            system_prompt=self.system_prompt,
            user_prompt=self.user_prompt,
        )
        
        # Get tracing config
        trace_config = self._get_config(
            trace_name=f"diff_consolidation_async:{file_path}",
            metadata={"file_path": file_path, "chunk_count": len(chunk_summaries)}
        )
        
        try:
            return await chain.ainvoke({
                "file_path": file_path,
                "chunk_summaries": formatted_chunks
            }, config=trace_config)
        except Exception as e:
            return f"통합 실패: {str(e)}"


class ImpactAnalyzerAgent(BaseAgent):
    """Agent that analyzes system impact areas of file changes"""
    
    # Impact area detection rules (no LLM needed for basic detection)
    IMPACT_RULES = {
        "frontend": ['.jsx', '.tsx', '.vue', '.css', '.scss', '.html', 'frontend/', 'src/components', 'src/pages', 'src/styles'],
        "backend": ['.py', 'backend/', 'api/', 'server/', 'routes/', 'controllers/'],
        "database": ['models.py', 'schema', 'migration', 'alembic', '.sql', 'database', 'orm'],
        "api": ['routes/', 'endpoints/', 'api/', 'swagger', 'openapi', 'rest'],
        "config": ['.env', '.yaml', '.yml', '.json', 'config', 'settings', 'dockerfile', 'docker-compose'],
        "security": ['auth', 'login', 'password', 'token', 'jwt', 'oauth', 'permission', 'role'],
        "tests": ['test', 'spec', '__test__', 'pytest', 'unittest'],
        "ci_cd": ['.github', 'gitlab-ci', 'jenkins', 'pipeline', 'deploy', 'workflow']
    }
    
    def run(self, files: List[FileChange]) -> Dict[str, List[str]]:
        """Analyze impact areas for all files"""
        impact_map = {}  # area -> list of file paths
        
        for file in files:
            if file.has_history_only:
                continue  # Skip history-only files
                
            path_lower = file.path.lower()
            detected_areas = []
            
            for area, patterns in self.IMPACT_RULES.items():
                if any(p in path_lower for p in patterns):
                    detected_areas.append(area)
                    
                    if area not in impact_map:
                        impact_map[area] = []
                    if file.path not in impact_map[area]:
                        impact_map[area].append(file.path)
            
            # Update file's impact_areas
            file.impact_areas = detected_areas
        
        return impact_map
    
    def get_impact_summary(self, impact_map: Dict[str, List[str]]) -> str:
        """Generate human-readable impact summary"""
        if not impact_map:
            return "변경 영향 범위를 감지할 수 없습니다."
        
        lines = ["## 🎯 시스템 영향 범위\n"]
        area_names = {
            "frontend": "🎨 Frontend (UI)",
            "backend": "⚙️ Backend (서버)",
            "database": "🗄️ Database (DB)",
            "api": "🔌 API (엔드포인트)",
            "config": "🔧 Config (설정)",
            "security": "🔒 Security (보안)",
            "tests": "🧪 Tests (테스트)",
            "ci_cd": "🚀 CI/CD (배포)"
        }
        
        for area, files in impact_map.items():
            name = area_names.get(area, area)
            lines.append(f"### {name}")
            lines.append(f"- 영향 파일: {len(files)}개")
            if len(files) <= 5:
                for f in files:
                    lines.append(f"  - `{f}`")
            else:
                for f in files[:3]:
                    lines.append(f"  - `{f}`")
                lines.append(f"  - ... 외 {len(files) - 3}개")
            lines.append("")
        
        return "\n".join(lines)


class SummaryGeneratorAgent(BaseAgent):
    """Agent that generates the final comprehensive summary
    
    Enhanced to include:
    - Impact analysis summary
    - History-only files section
    """
    
    def __init__(self, llm: ChatOpenAI, prompts: Optional[Dict] = None, tracing_context: Optional[LangfuseTracingContext] = None):
        super().__init__(llm, prompts, tracing_context)
        self.system_prompt, self.user_prompt = self._prompt_pair(
            "summary_generator",
            system_default="당신은 시니어 개발자입니다. Git 변경 사항을 분석하여 **증빙용 문서**로 사용할 수 있는 상세한 요약을 작성합니다.",
            user_default="## 📊 변경 통계\n{commit_count}개 파일...\n",
        )
    
    def run(
        self, 
        commits: List[dict], 
        files: List[FileChange],
        categories: dict,
        impact_summary: str = "",
        history_only_files: str = ""
    ) -> str:
        """Generate comprehensive summary"""
        logger.info(f"[SummaryGenerator] 최종 요약 생성 시작 (커밋: {len(commits)}개, 파일: {len(files)}개)")
        
        # Build commit messages
        commit_messages = "\n".join([
            f"- {c.get('title', 'No title')} (by {c.get('author_name', 'Unknown')})"
            for c in commits[:25]
        ])
        
        # Build categorized file summary
        file_sections = []
        for category, category_files in categories.items():
            if not category_files:
                continue
            
            category_names = {
                "frontend": "🎨 Frontend",
                "backend": "⚙️ Backend", 
                "config": "🔧 Config",
                "docs": "📄 Documentation",
                "tests": "🧪 Tests",
                "other": "📦 Other"
            }
            
            section_lines = [f"### {category_names.get(category, category)}"]
            for f in category_files[:15]:
                status_emoji = {"added": "🆕", "deleted": "🗑️", "modified": "✏️", "renamed": "📝", "history_only": "📝"}.get(f.status, "📄")
                line = f"- {status_emoji} `{f.path}` (+{f.additions}/-{f.deletions})"
                if f.ai_summary:
                    line += f"\n  - {f.ai_summary}"
                section_lines.append(line)
            file_sections.append("\n".join(section_lines))
        
        categorized_summary = "\n\n".join(file_sections)
        
        # Build history-only files summary if not provided
        if not history_only_files:
            history_files = [f for f in files if f.has_history_only]
            if history_files:
                history_lines = ["이 파일들은 중간 커밋에서 변경되었지만 최종적으로 원래 상태로 돌아갔습니다:"]
                for f in history_files[:10]:
                    commits_desc = ", ".join([c.get('title', '')[:20] for c in f.related_commits[:2]])
                    history_lines.append(f"- `{f.path}` (커밋: {commits_desc})")
                if len(history_files) > 10:
                    history_lines.append(f"- ... 외 {len(history_files) - 10}개")
                history_only_files = "\n".join(history_lines)
            else:
                history_only_files = "(없음)"
        
        # Stats
        actual_files = [f for f in files if not f.has_history_only]
        total_added = sum(f.additions for f in actual_files)
        total_deleted = sum(f.deletions for f in actual_files)
        new_files = len([f for f in actual_files if f.status == "added"])
        deleted_files = len([f for f in actual_files if f.status == "deleted"])
        modified_files = len([f for f in actual_files if f.status == "modified"])
        
        chain = self._build_string_chain(
            "summary_generator",
            system_prompt=self.system_prompt,
            user_prompt=self.user_prompt,
        )
        
        # Get tracing config
        trace_config = self._get_config(
            trace_name="summary_generation",
            metadata={"commit_count": len(commits), "file_count": len(actual_files)}
        )
        
        try:
            result = chain.invoke({
                "commit_count": len(commits),
                "file_count": len(actual_files),
                "new_files": new_files,
                "deleted_files": deleted_files,
                "modified_files": modified_files,
                "total_added": total_added,
                "total_deleted": total_deleted,
                "commit_messages": commit_messages,
                "categorized_summary": categorized_summary,
                "impact_summary": impact_summary or "(분석되지 않음)",
                "history_only_files": history_only_files
            }, config=trace_config)
            logger.info(f"[SummaryGenerator] ✓ 최종 요약 생성 완료")
            return result
        except Exception as e:
            logger.error(f"[SummaryGenerator] ✗ 요약 생성 실패: {e}")
            return f"⚠️ 요약 생성 실패: {str(e)}"

    async def arun(
        self,
        commits: List[dict],
        files: List[FileChange],
        categories: dict,
        impact_summary: str = "",
        history_only_files: str = ""
    ) -> str:
        """Async comprehensive summary generation."""
        logger.info(f"[SummaryGenerator] 비동기 최종 요약 생성 시작 (커밋: {len(commits)}개, 파일: {len(files)}개)")

        commit_messages = "\n".join([
            f"- {c.get('title', 'No title')} (by {c.get('author_name', 'Unknown')})"
            for c in commits[:25]
        ])

        file_sections = []
        for category, category_files in categories.items():
            if not category_files:
                continue

            category_names = {
                "frontend": "🎨 Frontend",
                "backend": "⚙️ Backend",
                "config": "🔧 Config",
                "docs": "📄 Documentation",
                "tests": "🧪 Tests",
                "other": "📦 Other"
            }

            section_lines = [f"### {category_names.get(category, category)}"]
            for f in category_files[:15]:
                status_emoji = {"added": "🆕", "deleted": "🗑️", "modified": "✏️", "renamed": "📝", "history_only": "📝"}.get(f.status, "📄")
                line = f"- {status_emoji} `{f.path}` (+{f.additions}/-{f.deletions})"
                if f.ai_summary:
                    line += f"\n  - {f.ai_summary}"
                section_lines.append(line)
            file_sections.append("\n".join(section_lines))

        categorized_summary = "\n\n".join(file_sections)

        if not history_only_files:
            history_files = [f for f in files if f.has_history_only]
            if history_files:
                history_lines = ["이 파일들은 중간 커밋에서 변경되었지만 최종적으로 원래 상태로 돌아갔습니다:"]
                for f in history_files[:10]:
                    commits_desc = ", ".join([c.get('title', '')[:20] for c in f.related_commits[:2]])
                    history_lines.append(f"- `{f.path}` (커밋: {commits_desc})")
                if len(history_files) > 10:
                    history_lines.append(f"- ... 외 {len(history_files) - 10}개")
                history_only_files = "\n".join(history_lines)
            else:
                history_only_files = "(없음)"

        actual_files = [f for f in files if not f.has_history_only]
        total_added = sum(f.additions for f in actual_files)
        total_deleted = sum(f.deletions for f in actual_files)
        new_files = len([f for f in actual_files if f.status == "added"])
        deleted_files = len([f for f in actual_files if f.status == "deleted"])
        modified_files = len([f for f in actual_files if f.status == "modified"])

        chain = self._build_string_chain(
            "summary_generator",
            system_prompt=self.system_prompt,
            user_prompt=self.user_prompt,
        )
        trace_config = self._get_config(
            trace_name="summary_generation_async",
            metadata={"commit_count": len(commits), "file_count": len(actual_files)}
        )

        try:
            result = await chain.ainvoke({
                "commit_count": len(commits),
                "file_count": len(actual_files),
                "new_files": new_files,
                "deleted_files": deleted_files,
                "modified_files": modified_files,
                "total_added": total_added,
                "total_deleted": total_deleted,
                "commit_messages": commit_messages,
                "categorized_summary": categorized_summary,
                "impact_summary": impact_summary or "(분석되지 않음)",
                "history_only_files": history_only_files
            }, config=trace_config)
            logger.info(f"[SummaryGenerator] ✓ 비동기 최종 요약 생성 완료")
            return result
        except Exception as e:
            logger.error(f"[SummaryGenerator] ✗ 비동기 요약 생성 실패: {e}")
            return f"⚠️ 요약 생성 실패: {str(e)}"


class HistoryAnalyzerAgent(BaseAgent):
    """Agent that analyzes the evolution of a file across multiple commits (Deep Analysis)"""
    
    def __init__(self, llm: ChatOpenAI, prompts: Optional[Dict] = None, tracing_context: Optional[LangfuseTracingContext] = None):
        super().__init__(llm, prompts, tracing_context)
        
        # Safe default fallback strings just in case config is totally missing
        default_commit_system = "당신은 코드 변경 상세 분석가입니다. 특정 커밋에서 파일이 어떻게 변경되었는지 '사실 기반(Fact-based)'으로 분석합니다."
        default_commit_user = """## 파일: {file_path}
## 커밋: {commit_message} ({author}, {date})
## 변경 사항 (Diff):
```
{diff}
```

이 커밋에서 이 파일의 **실질적인 변화**를 1-2문장으로 요약해주세요."""

        self.commit_analysis_prompt = self._build_prompt(
            "history_commit_analyzer",
            system_default=default_commit_system,
            user_default=default_commit_user,
        )
        
        default_summary_system = "당신은 코드 히스토리 전문 에디터입니다. 파일의 진화 과정을 분석하여 통찰력 있는 리포트를 작성합니다."
        default_summary_user = """## 파일: {file_path}
## 변경 이력:
{history_text}

위 이력을 바탕으로 상세 분석 리포트를 작성해주세요."""

        self.history_summary_prompt = self._build_prompt(
            "history_summary_generator",
            system_default=default_summary_system,
            user_default=default_summary_user,
        )

    def run(self, *args, **kwargs) -> str:
        """Abstract method implementation - not used directly for this agent"""
        return "HistoryAnalyzerAgent uses analyze_commit and summarize_history methods"

    def build_evidence_pack(self, diff: str, max_chars: int = 6000) -> Dict[str, Any]:
        """Prepare hunk-aware evidence for conservative commit analysis."""
        if not diff:
            return {
                "diff_input": "(diff evidence 없음)",
                "change_evidence": [],
                "omitted_hunks": 0,
                "warnings": ["diff_evidence_missing"],
                "evidence_level": "none",
                "confidence": "low"
            }

        change_evidence, omitted_hunks = build_diff_evidence(diff, max_hunks=8)
        if len(diff) <= max_chars and omitted_hunks == 0:
            diff_input = diff
            evidence_level = "diff"
        else:
            evidence_lines = []
            for item in change_evidence:
                evidence_lines.append(
                    f"### Hunk {item.get('hunk_index')} ({item.get('line_hint')})\n"
                    f"{item.get('header')}\n{item.get('quote')}"
                )
            if omitted_hunks:
                evidence_lines.append(f"\n[주의] 생략된 hunk 수: {omitted_hunks}. 전체 변경의 일부만 제공됨.")
            diff_input = "\n\n".join(evidence_lines) if evidence_lines else diff[:max_chars]
            evidence_level = "partial_diff" if omitted_hunks else "diff"

        warnings = []
        if omitted_hunks:
            warnings.append(f"large_diff_hunks_omitted:{omitted_hunks}")

        return {
            "diff_input": diff_input,
            "change_evidence": change_evidence,
            "omitted_hunks": omitted_hunks,
            "warnings": warnings,
            "evidence_level": evidence_level,
            "confidence": "medium" if omitted_hunks else "high"
        }

    def analyze_commit(self, file_path: str, commit_info: dict, diff: str) -> str:
        """Analyze a single commit's impact on a file"""
        chain = self.commit_analysis_prompt | self.llm | StrOutputParser()
        evidence_pack = self.build_evidence_pack(diff)
        
        trace_config = self._get_config(
            trace_name=f"history_commit_analysis:{file_path}",
            metadata={
                "commit": commit_info.get('full_sha') or commit_info.get('id'),
                "file": file_path,
                "evidence_level": evidence_pack["evidence_level"],
                "omitted_hunks": evidence_pack["omitted_hunks"]
            }
        )
        
        return chain.invoke({
            "file_path": file_path,
            "commit_message": commit_info.get('message'),
            "author": commit_info.get('author'),
            "date": commit_info.get('date'),
            "diff": evidence_pack["diff_input"]
        }, config=trace_config)

    def summarize_history(self, file_path: str, analyses: List[Dict]) -> str:
        """Summarize the full history based on individual commit analyses"""
        history_text = "\n".join([
            f"- {a['date']} {a['author']} (커밋: {a['short_id']}): {a['analysis']}"
            for a in analyses
        ])
        
        chain = self.history_summary_prompt | self.llm | StrOutputParser()
        
        trace_config = self._get_config(
            trace_name=f"history_full_summary:{file_path}",
            metadata={"file": file_path, "commit_count": len(analyses)}
        )
        
        return chain.invoke({
            "file_path": file_path,
            "history_text": history_text
        }, config=trace_config)



