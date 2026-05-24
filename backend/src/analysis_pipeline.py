"""High-level orchestration for the legacy commit analysis pipeline."""

from typing import Dict, List, Optional

from .agents import (
    CategoryAgent,
    FileAnalyzerAgent,
    ImpactAnalyzerAgent,
    SummaryGeneratorAgent,
    create_tracing_context,
    get_llm,
)
from .models import FileChange


class AnalysisPipeline:
    """Orchestrate legacy file, impact, category, and summary agents."""

    def __init__(
        self,
        openai_api_key: Optional[str] = None,
        openai_base_url: Optional[str] = None,
        openai_model: str = "gpt-4o-mini",
        langfuse_public_key: Optional[str] = None,
        langfuse_secret_key: Optional[str] = None,
        langfuse_host: Optional[str] = None,
        prompts: Optional[Dict] = None,
        session_id: Optional[str] = None,
    ):
        self.llm = get_llm(
            openai_api_key=openai_api_key,
            openai_base_url=openai_base_url,
            model=openai_model,
            langfuse_public_key=langfuse_public_key,
            langfuse_secret_key=langfuse_secret_key,
            langfuse_host=langfuse_host,
        )
        self.prompts = prompts
        self.tracing_context = create_tracing_context(
            langfuse_public_key=langfuse_public_key,
            langfuse_secret_key=langfuse_secret_key,
            langfuse_host=langfuse_host,
            session_id=session_id,
            tags=["diff-lens", "analysis"],
        )

    def analyze(self, commits: List[dict], files: List[FileChange]) -> str:
        if not self.llm:
            return "⚠️ OpenAI API key not configured. Please set OPENAI_API_KEY in .env file."

        files_to_analyze = [file for file in files if not file.has_history_only]

        file_agent = FileAnalyzerAgent(self.llm, self.prompts, self.tracing_context)
        for file in files_to_analyze[:15]:
            if file.diff:
                file.ai_summary = file_agent.run(file)

        impact_agent = ImpactAnalyzerAgent(self.llm, self.prompts)
        impact_map = impact_agent.run(files_to_analyze)
        impact_summary = impact_agent.get_impact_summary(impact_map)

        category_agent = CategoryAgent(self.llm, self.prompts)
        categories = category_agent.run(files_to_analyze)

        summary_agent = SummaryGeneratorAgent(self.llm, self.prompts, self.tracing_context)
        summary = summary_agent.run(
            commits,
            files,
            categories,
            impact_summary=impact_summary,
        )

        if self.tracing_context:
            self.tracing_context.flush()

        return summary
