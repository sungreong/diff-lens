from pydantic import BaseModel, ConfigDict
from typing import Dict, Optional, Any, List

class PromptConfig(BaseModel):
    model_config = ConfigDict(extra="allow")

    system_prompt: Optional[str] = None
    user_prompt: Optional[str] = None

class PromptsConfig(BaseModel):
    model_config = ConfigDict(extra="allow")

    file_analyzer: Optional[PromptConfig] = None
    summary_generator: Optional[PromptConfig] = None
    history_commit_analyzer: Optional[PromptConfig] = None
    history_summary_generator: Optional[PromptConfig] = None
    diff_consolidator: Optional[PromptConfig] = None

class ReferencePrompts(BaseModel):
    current: Dict[str, Any] # Use Dict to be more flexible with dynamic agents
    default: Dict[str, Any]

class ResetRequest(BaseModel):
    agent_name: str  # e.g., "file_analyzer", "history_commit_analyzer", etc.


# ============================================================================
# EXPORT 기능 관련 스키마
# ============================================================================

class FieldSchema(BaseModel):
    """추출할 필드 정의"""
    key: str
    description: str


class FileInfo(BaseModel):
    """파일 정보"""
    path: str
    status: str = "modified"
    additions: int = 0
    deletions: int = 0
    ai_summary: Optional[str] = None
    diff: Optional[str] = None


class FieldExtractionRequest(BaseModel):
    """파일별 필드 추출 요청"""
    files: List[FileInfo]
    schema: List[FieldSchema]
    # LLM 설정
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    openai_model: Optional[str] = "gpt-4o-mini"
    # Langfuse 설정
    langfuse_public_key: Optional[str] = None
    langfuse_secret_key: Optional[str] = None
    langfuse_host: Optional[str] = None


class KeyDef(BaseModel):
    """추출할 키 정의 (이름 + 설명)"""
    name: str
    description: Optional[str] = None  # 키에 대한 설명 (어떤 값을 추출할지)


class GroupDef(BaseModel):
    """요약 그룹 정의"""
    name: str
    description: Optional[str] = None  # 그룹 전체 컨텍스트/설명
    keys: List[KeyDef]  # 추출할 키와 설명


class BatchSummaryRequest(BaseModel):
    """배치 점진적 요약 요청"""
    files: List[FileInfo]
    summary_type: str = "risk_analysis"  # risk_analysis, improvement, change_reason, release_notes, dependency_impact, custom
    batch_size: int = 4
    custom_groups: Optional[List[GroupDef]] = None  # summary_type이 "custom"일 때 사용
    # LLM 설정
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    openai_model: Optional[str] = "gpt-4o-mini"
    # Langfuse 설정
    langfuse_public_key: Optional[str] = None
    langfuse_secret_key: Optional[str] = None
    langfuse_host: Optional[str] = None


class CustomGroupRequest(BaseModel):
    """커스텀 그룹 추출 요청"""
    files: List[FileInfo]
    groups: List[GroupDef]
    # LLM 설정
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    openai_model: Optional[str] = "gpt-4o-mini"
    # Langfuse 설정
    langfuse_public_key: Optional[str] = None
    langfuse_secret_key: Optional[str] = None
    langfuse_host: Optional[str] = None


class ExportSummaryTypesResponse(BaseModel):
    """사용 가능한 요약 타입 목록 응답"""
    types: Dict[str, Dict[str, Any]]


# ============================================================================
# FLAT 모드 스키마
# ============================================================================

class CategoryDef(BaseModel):
    """FLAT 모드 카테고리 정의"""
    name: str
    values: List[str]  # 예: ["상", "중", "하"]


class ColumnDef(BaseModel):
    """FLAT 모드 컬럼 정의"""
    name: str
    description: Optional[str] = None


class FlatSummaryRequest(BaseModel):
    """FLAT 모드 요약 요청"""
    files: List[FileInfo]
    template_type: str = "risk_classification"  # risk_classification, change_type, impact_scope, release_notes_flat, approval_checklist, custom
    batch_size: int = 4
    # 커스텀 설정 (template_type이 "custom"일 때)
    custom_config: Optional[Dict[str, Any]] = None
    # LLM 설정
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    openai_model: Optional[str] = "gpt-4o-mini"
    # Langfuse 설정
    langfuse_public_key: Optional[str] = None
    langfuse_secret_key: Optional[str] = None
    langfuse_host: Optional[str] = None
