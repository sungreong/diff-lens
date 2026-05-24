"""Custom group export agent."""

import json
import logging
from typing import Any, Dict, List, Optional

from langchain_openai import ChatOpenAI

from .agents import BaseAgent
from .langfuse_utils import LangfuseTracingContext

logger = logging.getLogger("diff-lens.export_agents")


class CustomGroupExportAgent(BaseAgent):
    """Extract user-defined grouped fields from analyzed file summaries."""

    def __init__(
        self,
        llm: ChatOpenAI,
        prompts: Optional[Dict] = None,
        tracing_context: Optional[LangfuseTracingContext] = None,
    ):
        super().__init__(llm, prompts, tracing_context)
        self.system_prompt, self.user_prompt = self._prompt_pair(
            "custom_group_extractor",
            system_default="""당신은 데이터 추출 전문가입니다.
주어진 파일 분석 결과에서 요청된 그룹과 키에 해당하는 정보를 추출합니다.

규칙:
1. 각 그룹에 해당하는 정보를 추출하여 구조화된 JSON으로 반환합니다.
2. 정보가 없으면 빈 문자열("")로 표시합니다.
3. 반드시 JSON 형식으로 응답합니다.""",
            user_default="""## 파일 정보
- 경로: {file_path}
- 상태: {status}

## 분석 결과
{ai_summary}

## 추출할 그룹별 키
{groups_keys}

위 분석 결과에서 각 그룹별 키 값을 추출하여 JSON으로 응답해주세요.
응답 형식:
{{
  "그룹명": {{
    "키1": "값1",
    "키2": "값2"
  }},
  ...
}}""",
        )

    def run(
        self,
        files: List[Dict[str, Any]],
        groups: List[Dict[str, Any]],
    ) -> Dict[str, List[Dict[str, Any]]]:
        chain = self._build_string_chain(
            "custom_group_extractor",
            system_prompt=self.system_prompt,
            user_prompt=self.user_prompt,
        )

        result = {group["name"]: [] for group in groups}
        groups_keys_str = "\n".join([
            f"- **{group['name']}**: {', '.join(group.get('keys', []))}"
            for group in groups
        ])

        for file_info in files:
            trace_config = self._get_config(
                trace_name=f"custom_group_extract:{file_info.get('path', 'unknown')}",
                metadata={"file": file_info.get("path"), "groups": [group["name"] for group in groups]},
            )

            try:
                response = chain.invoke({
                    "file_path": file_info.get("path", ""),
                    "status": file_info.get("status", "modified"),
                    "ai_summary": file_info.get("ai_summary", ""),
                    "groups_keys": groups_keys_str,
                }, config=trace_config)
                extracted = self._parse_json_response(response)
                for group in groups:
                    group_name = group["name"]
                    group_data = extracted.get(group_name, {})
                    flat_row = {"file_path": file_info.get("path", "")}
                    for key in group.get("keys", []):
                        flat_row[key] = group_data.get(key, "")
                    result[group_name].append(flat_row)
            except Exception as exc:
                logger.error("Group extraction failed for %s: %s", file_info.get("path"), exc)
                for group in groups:
                    flat_row = {"file_path": file_info.get("path", ""), "error": str(exc)}
                    for key in group.get("keys", []):
                        flat_row[key] = ""
                    result[group["name"]].append(flat_row)

        return result

    @staticmethod
    def _parse_json_response(response: str) -> Dict[str, Any]:
        try:
            clean_response = response.strip()
            if clean_response.startswith("```"):
                clean_response = clean_response.split("```")[1]
                if clean_response.startswith("json"):
                    clean_response = clean_response[4:]
            return json.loads(clean_response.strip())
        except json.JSONDecodeError:
            return {}
