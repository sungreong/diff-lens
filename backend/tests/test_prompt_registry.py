import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.prompt_registry import build_chat_prompt, load_default_prompts, merge_prompt_configs
from src.analysis_graph import COMPARE_GRAPH_STEPS


def test_prompt_registry_includes_backend_agent_prompts():
    prompts = load_default_prompts()

    for key in [
        "file_analyzer",
        "diff_consolidator",
        "summary_generator",
        "history_commit_analyzer",
        "history_summary_generator",
        "risk_review_prompt_generator",
        "impact_candidate_analyzer",
        "release_risk_summarizer",
        "field_extractor",
        "batch_summary_refiner",
        "batch_summary_compressor",
        "batch_summary_extractor",
        "custom_group_extractor",
    ]:
        assert key in prompts
        assert prompts[key]["system_prompt"]
        assert prompts[key]["user_prompt"]


def test_prompt_merge_preserves_nested_defaults_for_legacy_profiles():
    merged = merge_prompt_configs({
        "risk_review_prompt_generator": {
            "styles": {
                "concise": {
                    "display_name": "짧게"
                }
            }
        }
    })

    concise = merged["risk_review_prompt_generator"]["styles"]["concise"]
    assert concise["display_name"] == "짧게"
    assert concise["description"]
    assert concise["output_sections"]


def test_registered_prompts_compile_as_langchain_templates():
    prompts = load_default_prompts()
    prompt = build_chat_prompt(prompts, "impact_candidate_analyzer")

    assert sorted(prompt.input_variables) == ["candidate", "changed_context"]


def test_compare_graph_steps_are_ordered_for_extension():
    assert COMPARE_GRAPH_STEPS[0] == "resolve_refs"
    assert COMPARE_GRAPH_STEPS[-1] == "summarize_release_risk"
    assert "analyze_impact_files" in COMPARE_GRAPH_STEPS
