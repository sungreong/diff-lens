"""Risk review prompt generation agent."""

import logging
from datetime import datetime
from typing import Dict, List, Optional

from langchain_openai import ChatOpenAI

from .agents import BaseAgent
from .langfuse_utils import LangfuseTracingContext

logger = logging.getLogger("diff-lens.agents")


class RiskReviewPromptAgent(BaseAgent):
    """Generate AI review request prompts from detected risks."""

    def __init__(self, llm: ChatOpenAI, prompts: Optional[Dict] = None, tracing_context: Optional[LangfuseTracingContext] = None):
        super().__init__(llm, prompts, tracing_context)
        config = self._prompt_config("risk_review_prompt_generator")
        self.system_prompt_template = config.get(
            "system_prompt",
            "당신은 코드 리뷰 요청서 작성 전문가입니다. 잠재적 리스크가 감지된 코드들에 대해 외부 AI에게 전달할 검토 요청 프롬프트를 작성합니다.",
        )
        self.user_prompt = config.get(
            "user_prompt",
            "## 리스크 파일 목록\n{risk_files_info}\n\n위 정보를 바탕으로 검토 요청 프롬프트를 작성해주세요.",
        )
        self.styles = config.get("styles", {})
        self.default_style = config.get("default_style", "balanced")

    def get_available_styles(self) -> List[Dict[str, str]]:
        return [
            {
                "key": key,
                "display_name": style_config.get("display_name", key),
                "description": style_config.get("description", ""),
            }
            for key, style_config in self.styles.items()
        ]

    def _get_system_prompt_with_style(self, style: str) -> str:
        style_config = self.styles.get(style, self.styles.get(self.default_style, {}))
        return self.system_prompt_template.replace("{style_modifier}", style_config.get("system_modifier", ""))

    def run(
        self,
        risk_files: List[Dict],
        base_commit: str = "",
        target_commit: str = "",
        checklist: Optional[List[str]] = None,
        style: str = "balanced",
    ) -> str:
        logger.info("[RiskReviewPrompt] Generating prompt for %s risk files (style: %s)", len(risk_files), style)

        severity_emoji = {"HIGH": "🔴", "MEDIUM": "🟠", "LOW": "🟡"}
        risk_files_info = ""
        for idx, risk_file in enumerate(risk_files, 1):
            emoji = severity_emoji.get(risk_file.get("severity", "LOW"), "🟡")
            file_path = risk_file.get("file_path", "")
            ext = file_path.split(".")[-1] if "." in file_path else ""
            risk_files_info += f"### {idx}. `{file_path}` {emoji} {risk_file.get('severity', 'LOW')}\n"
            risk_files_info += f"- **위치**: {risk_file.get('location', '위치 미상')}\n"
            risk_files_info += f"- **리스크 유형**: {risk_file.get('risk_type', '')}\n"
            risk_files_info += f"- **원본 분석 내용**: {risk_file.get('original_content', '')}\n"
            diff = risk_file.get("diff", "")
            if diff:
                diff_preview = diff[:1500] + "\n... (생략)" if len(diff) > 1500 else diff
                risk_files_info += f"\n**Diff**:\n```{ext}\n{diff_preview}\n```\n\n"
            else:
                risk_files_info += "\n"

        checklist_str = "\n".join([f"- [ ] {item}" for item in checklist]) if checklist else """- [ ] 실제 위험 여부 판단 (오탐 가능성)
- [ ] 문제 발생 조건 및 시나리오 식별
- [ ] 구체적인 수정 방안 제안
- [ ] 테스트 케이스 제안"""

        chain = self._build_string_chain(
            "risk_review_prompt_generator",
            system_prompt=self._get_system_prompt_with_style(style),
            user_prompt=self.user_prompt,
        )
        trace_config = self._get_config(
            trace_name="risk_review_prompt_generation",
            metadata={"file_count": len(risk_files), "style": style},
        )

        try:
            return chain.invoke({
                "analysis_date": datetime.now().strftime("%Y-%m-%d %H:%M"),
                "base_commit": base_commit or "N/A",
                "target_commit": target_commit or "HEAD",
                "risk_count": len(risk_files),
                "risk_files_info": risk_files_info,
                "checklist_items": checklist_str,
            }, config=trace_config)
        except Exception as exc:
            logger.error("[RiskReviewPrompt] Generation failed: %s", exc)
            return f"⚠️ 프롬프트 생성 실패: {str(exc)}"
