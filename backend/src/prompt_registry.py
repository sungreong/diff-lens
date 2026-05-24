"""Central prompt registry for backend agents.

This module keeps prompt loading, merging, validation metadata, and LangChain
chain construction in one place so new agents can be added by extending
``prompts.yaml`` and referencing a single registry key in code.
"""
import copy
import logging
import os
from typing import Any, Dict, Mapping, Optional, Sequence, Tuple

import yaml
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate

logger = logging.getLogger("diff-lens.prompt_registry")

PROMPTS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "prompts.yaml")

SYSTEM_PROMPT_KEY = "system_prompt"
USER_PROMPT_KEY = "user_prompt"

PROMPT_REQUIRED_VARIABLES: Dict[str, Sequence[str]] = {
    "file_analyzer": ["{path}", "{status}", "{additions}", "{deletions}", "{diff}"],
    "diff_consolidator": ["{file_path}", "{chunk_summaries}"],
    "summary_generator": ["{commit_count}", "{file_count}", "{commit_messages}", "{categorized_summary}"],
    "history_commit_analyzer": ["{file_path}", "{commit_message}", "{diff}"],
    "history_summary_generator": ["{file_path}", "{history_text}"],
    "risk_review_prompt_generator": ["{risk_files_info}"],
    "merge_plan_reviewer": ["{payload}"],
    "impact_candidate_analyzer": ["{candidate}", "{changed_context}"],
    "release_risk_summarizer": ["{payload}"],
    "field_extractor": ["{file_path}", "{status}", "{additions}", "{deletions}", "{ai_summary}", "{diff_preview}", "{schema_description}"],
    "batch_summary_refiner": ["{summary_type}", "{summary_description}", "{current_context}", "{files_content}"],
    "batch_summary_compressor": ["{context}", "{summary_type}"],
    "batch_summary_extractor": ["{final_context}", "{groups_description}"],
    "custom_group_extractor": ["{file_path}", "{status}", "{ai_summary}", "{groups_keys}"],
}

PROMPT_OPTIONAL_VARIABLES: Dict[str, Sequence[str]] = {
    "file_analyzer": ["{commit_context}", "{evidence_context}", "{chunk_info}"],
    "summary_generator": ["{impact_summary}", "{history_only_files}", "{new_files}", "{deleted_files}", "{modified_files}", "{total_added}", "{total_deleted}"],
    "risk_review_prompt_generator": ["{analysis_date}", "{base_commit}", "{target_commit}", "{risk_count}", "{checklist_items}"],
    "merge_plan_reviewer": ["{style}"],
    "batch_summary_refiner": ["{prev_version}", "{batch_index}", "{total_batches}"],
    "batch_summary_compressor": ["{summary_description}"],
}


def _deep_merge(default: Any, override: Any) -> Any:
    """Merge prompt dictionaries without dropping nested default settings."""
    if isinstance(default, dict) and isinstance(override, Mapping):
        merged = copy.deepcopy(default)
        for key, value in override.items():
            if key in merged:
                merged[key] = _deep_merge(merged[key], value)
            else:
                merged[key] = copy.deepcopy(value)
        return merged

    if override is None:
        return copy.deepcopy(default)

    return copy.deepcopy(override)


def load_default_prompts() -> Dict[str, Any]:
    """Load the checked-in prompt registry from ``backend/prompts.yaml``."""
    if not os.path.exists(PROMPTS_FILE):
        logger.warning("Prompt registry file not found: %s", PROMPTS_FILE)
        return {}

    with open(PROMPTS_FILE, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data


DEFAULT_PROMPTS = load_default_prompts()


def merge_prompt_configs(prompts: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
    """Return prompts overlaid on current defaults.

    Profiles can be older than the latest ``prompts.yaml``. Deep merging keeps
    new agents, new styles, and new template fields available while preserving
    the user's existing custom prompt text.
    """
    if not prompts:
        return copy.deepcopy(DEFAULT_PROMPTS)
    return _deep_merge(DEFAULT_PROMPTS, prompts)


def get_prompt_config(prompts: Optional[Mapping[str, Any]], name: str) -> Dict[str, Any]:
    """Fetch one prompt config after applying defaults."""
    merged = merge_prompt_configs(prompts)
    config = merged.get(name, {})
    return copy.deepcopy(config) if isinstance(config, dict) else {}


def get_prompt_pair(
    prompts: Optional[Mapping[str, Any]],
    name: str,
    *,
    system_key: str = SYSTEM_PROMPT_KEY,
    user_key: str = USER_PROMPT_KEY,
    system_default: str = "",
    user_default: str = "",
) -> Tuple[str, str]:
    """Return a system/user prompt pair for a registry key."""
    config = get_prompt_config(prompts, name)
    system_prompt = config.get(system_key) or system_default
    user_prompt = config.get(user_key) or user_default
    return system_prompt, user_prompt


def build_chat_prompt(
    prompts: Optional[Mapping[str, Any]],
    name: str,
    *,
    system_key: str = SYSTEM_PROMPT_KEY,
    user_key: str = USER_PROMPT_KEY,
    system_prompt: Optional[str] = None,
    user_prompt: Optional[str] = None,
    system_default: str = "",
    user_default: str = "",
    user_role: str = "user",
) -> ChatPromptTemplate:
    """Build a LangChain chat prompt from a registry key."""
    if system_prompt is None or user_prompt is None:
        default_system, default_user = get_prompt_pair(
            prompts,
            name,
            system_key=system_key,
            user_key=user_key,
            system_default=system_default,
            user_default=user_default,
        )
        system_prompt = default_system if system_prompt is None else system_prompt
        user_prompt = default_user if user_prompt is None else user_prompt

    return ChatPromptTemplate.from_messages([
        ("system", system_prompt or ""),
        (user_role, user_prompt or ""),
    ])


def build_string_chain(llm: Any, prompts: Optional[Mapping[str, Any]], name: str, **kwargs: Any) -> Any:
    """Build the common prompt -> LLM -> string parser LangChain pipeline."""
    return build_chat_prompt(prompts, name, **kwargs) | llm | StrOutputParser()


def get_required_variables(name: str) -> Sequence[str]:
    config = DEFAULT_PROMPTS.get(name, {})
    if isinstance(config, dict) and config.get("required_variables"):
        return list(config["required_variables"])
    return list(PROMPT_REQUIRED_VARIABLES.get(name, []))


def get_optional_variables(name: str) -> Sequence[str]:
    config = DEFAULT_PROMPTS.get(name, {})
    if isinstance(config, dict) and config.get("optional_variables"):
        return list(config["optional_variables"])
    return list(PROMPT_OPTIONAL_VARIABLES.get(name, []))
