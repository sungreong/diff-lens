from pydantic import BaseModel, Field as PydanticField
from typing import List, Optional, Dict, Any
from sqlmodel import SQLModel, Field as SQLField, Relationship
from sqlalchemy import JSON, Column
from datetime import datetime, timezone

# --- Database Models ---

class Profile(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    name: str = SQLField(index=True)
    is_active: bool = SQLField(default=False)
    
    repositories: List["GitRepository"] = Relationship(back_populates="profile", sa_relationship_kwargs={"cascade": "all, delete-orphan"})
    llm_configs: List["LLMConfig"] = Relationship(back_populates="profile", sa_relationship_kwargs={"cascade": "all, delete-orphan"})
    tracing_configs: List["TracingConfig"] = Relationship(back_populates="profile", sa_relationship_kwargs={"cascade": "all, delete-orphan"})
    prompt_config: Optional["PromptConfig"] = Relationship(
        back_populates="profile", 
        sa_relationship_kwargs={"uselist": False, "cascade": "all, delete-orphan"}
    )

class PromptConfig(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    profile_id: int = SQLField(foreign_key="profile.id", unique=True)
    data: Dict[str, Any] = SQLField(default={}, sa_column=Column(JSON))
    
    profile: Optional[Profile] = Relationship(back_populates="prompt_config")

class GitRepository(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    profile_id: Optional[int] = SQLField(default=None, foreign_key="profile.id")
    name: str = SQLField(default="Default Repo")
    git_url: str
    git_token: str
    project_id: str
    branch: str = SQLField(default="main")
    commit_limit: int = SQLField(default=100)
    is_active: bool = SQLField(default=False)
    
    profile: Optional[Profile] = Relationship(back_populates="repositories")

class RefBookmark(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    profile_id: Optional[int] = SQLField(default=None, index=True)
    repo_id: Optional[int] = SQLField(default=None, foreign_key="gitrepository.id", index=True)
    git_url: Optional[str] = None
    project_id: Optional[str] = SQLField(default=None, index=True)
    label: str
    ref: str
    ref_type: str = "ref"
    sha: Optional[str] = SQLField(default=None, index=True)
    short_sha: Optional[str] = None
    title: Optional[str] = None
    note: Optional[str] = None
    color: Optional[str] = "amber"
    is_favorite: bool = True
    created_at: str = SQLField(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = SQLField(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class LLMConfig(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    profile_id: Optional[int] = SQLField(default=None, foreign_key="profile.id")
    name: str = SQLField(default="Default LLM")
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = "https://api.openai.com/v1"
    openai_model: str = SQLField(default="gpt-4o-mini")
    is_active: bool = SQLField(default=False)
    
    profile: Optional[Profile] = Relationship(back_populates="llm_configs")

class TracingConfig(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    profile_id: Optional[int] = SQLField(default=None, foreign_key="profile.id")
    name: str = SQLField(default="Default Tracing")
    langfuse_public_key: Optional[str] = None
    langfuse_secret_key: Optional[str] = None
    langfuse_host: str = "https://cloud.langfuse.com"
    is_active: bool = SQLField(default=False)
    
    profile: Optional[Profile] = Relationship(back_populates="tracing_configs")

# --- Read Models (DTOs) ---

class GitRepositoryRead(SQLModel):
    id: int
    profile_id: int
    name: str
    git_url: str
    git_token: str
    project_id: str
    branch: str
    commit_limit: int
    is_active: bool

class LLMConfigRead(SQLModel):
    id: int
    profile_id: int
    name: str
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    openai_model: str
    is_active: bool

class TracingConfigRead(SQLModel):
    id: int
    profile_id: int
    name: str
    langfuse_public_key: Optional[str] = None
    langfuse_secret_key: Optional[str] = None
    langfuse_host: str
    is_active: bool

class PromptConfigRead(SQLModel):
    id: int
    profile_id: int
    data: Dict[str, Any]

class ProfileRead(SQLModel):
    id: int
    name: str
    is_active: bool
    repositories: List[GitRepositoryRead] = []
    llm_configs: List[LLMConfigRead] = []
    tracing_configs: List[TracingConfigRead] = []
    # prompt_config might be loaded separately or included if needed. 
    # For list view we might skip it to save bandwidth.

# --- API Models ---

class AnalyzeRequest(BaseModel):
    # IDs (Preferred if available)
    repo_id: Optional[int] = None
    llm_config_id: Optional[int] = None
    tracing_config_id: Optional[int] = None
    
    # Direct Fields (Legacy or Override)
    git_url: Optional[str] = None
    git_token: Optional[str] = None
    project_id: Optional[str] = None
    branch: Optional[str] = None
    base_commit: str
    target_commit: Optional[str] = None
    author_filter: Optional[str] = None
    analysis_mode: str = "full"  # "full" or "quick"
    max_files: int = 0  # 0 = all files, otherwise limit to top N
    file_status_filter: Optional[str] = None  # all, added, modified, deleted, renamed
    analysis_sort: str = "changes"  # changes, deletions, additions, commits, recent, risk, path
    
    # LLM Settings (Optional overrides)
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    openai_model: Optional[str] = None
    langfuse_public_key: Optional[str] = None
    langfuse_secret_key: Optional[str] = None
    langfuse_host: Optional[str] = None

class FileChange(BaseModel):
    path: str
    status: str
    additions: int
    deletions: int
    diff: Optional[str] = None
    old_path: Optional[str] = None
    ai_summary: Optional[str] = None
    commit_ids: List[str] = PydanticField(default_factory=list)
    
    # Enhanced Analysis Fields
    has_history_only: bool = PydanticField(default=False, description="True if file had intermediate changes but no net final diff")
    related_commits: List[Dict[str, str]] = PydanticField(default_factory=list, description="Commit messages related to this file")
    commit_file_stats: List[Dict[str, Any]] = PydanticField(default_factory=list, description="Per-commit file additions/deletions for heatmap export")
    last_touched_by: Optional[str] = PydanticField(default=None, description="Author of the latest commit in the selected range that touched this file")
    last_touched_email: Optional[str] = None
    last_touched_commit: Optional[str] = PydanticField(default=None, description="Full SHA of the latest commit in the selected range that touched this file")
    last_touched_commit_short: Optional[str] = None
    last_touched_at: Optional[str] = None
    impact_areas: List[str] = PydanticField(default_factory=list, description="Detected impact areas: frontend, backend, database, api, config, security")
    
    # Evidence-oriented fields. These keep the existing natural-language UI fields
    # intact while exposing a conservative before/after proof record.
    before_summary: Optional[str] = None
    after_summary: Optional[str] = None
    change_evidence: List[Dict[str, Any]] = PydanticField(default_factory=list)
    risk_verdict: str = "불확실"
    risk_reason: Optional[str] = None
    confidence: str = "low"
    uncertainty_reason: Optional[str] = None
    recommended_checks: List[str] = PydanticField(default_factory=list)
    evidence_level: str = "unknown"
    omitted_hunks: int = 0
    analysis_warnings: List[str] = PydanticField(default_factory=list)
    triage_score: int = 0
    triage_reason_codes: List[str] = PydanticField(default_factory=list)
    
    # v2 pre-deploy impact fields. Direct Git diff files keep
    # is_impact_candidate=False so inferred candidates are visually separated.
    is_impact_candidate: bool = False
    impact_reason_codes: List[str] = PydanticField(default_factory=list)
    impact_evidence: List[Dict[str, Any]] = PydanticField(default_factory=list)
    confidence_score: Optional[float] = None
    compare_origin: Optional[str] = None
    compare_origin_label: Optional[str] = None
    deployment_risk_flag: Optional[str] = None

class AnalyzeResponse(BaseModel):
    summary: str
    file_changes: List[FileChange]
    total_files: Optional[int] = None
    total_additions: int
    total_deletions: int
    cache_hit: bool = False
    cache_key: Optional[str] = None
    cache_hits: Optional[int] = None
    cache_waited: bool = False

class HistoryAnalysisRequest(BaseModel):
    """Request for deep history analysis of a single file"""
    git_url: Optional[str] = None
    git_token: Optional[str] = None
    project_id: Optional[str] = None
    
    file_path: str
    base_commit: str
    target_commit: str
    branch: Optional[str] = None
    
    # LLM Settings
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    openai_model: Optional[str] = None
    langfuse_public_key: Optional[str] = None
    langfuse_secret_key: Optional[str] = None
    langfuse_host: Optional[str] = None

class CommitAnalysis(BaseModel):
    """Analysis of a file change in a specific commit"""
    commit_id: str
    short_id: str
    message: str
    author: str
    date: str
    diff_stat: str  # +10/-5
    analysis: str   # LLM generated explanation
    confidence: str = "low"
    evidence_level: str = "diff"
    omitted_hunks: int = 0
    warnings: List[str] = PydanticField(default_factory=list)
    change_evidence: List[Dict[str, Any]] = PydanticField(default_factory=list)
    risk_verdict: str = "불확실"
    risk_reason: Optional[str] = None

class FileHistoryAnalysis(BaseModel):
    """Deep history analysis result for a file"""
    file_path: str
    commits_analyzed: int
    history: List[CommitAnalysis]
    final_summary: str
    before_summary: Optional[str] = None
    after_summary: Optional[str] = None
    risk_verdict: str = "불확실"
    risk_reason: Optional[str] = None
    confidence: str = "low"
    recommended_checks: List[str] = PydanticField(default_factory=list)
    cache_hit: bool = False
    cache_key: Optional[str] = None
    cache_hits: Optional[int] = None
    cache_waited: bool = False

class LLMTestResult(BaseModel):
    success: bool
    message: str
    model: Optional[str] = None

class LangfuseTestResult(BaseModel):
    success: bool
    message: str

class PreviewRequest(BaseModel):
    git_url: str
    git_token: str
    project_id: str
    branch: Optional[str] = None
    base_commit: str
    target_commit: Optional[str] = None
    author_filter: Optional[str] = None

class PreviewResult(BaseModel):
    file_count: int
    commit_count: int
    total_additions: int
    total_deletions: int
    files: List[FileChange] = []


class ResolvedGitRef(BaseModel):
    name: str
    ref: str
    type: str
    sha: str
    full_sha: str
    short_sha: str
    title: Optional[str] = None
    author_name: Optional[str] = None
    author_email: Optional[str] = None
    created_at: Optional[str] = None
    web_url: Optional[str] = None


class CompareV2Request(BaseModel):
    # IDs (Preferred if available)
    repo_id: Optional[int] = None
    llm_config_id: Optional[int] = None
    tracing_config_id: Optional[int] = None

    # Direct Git fields
    git_url: Optional[str] = None
    git_token: Optional[str] = None
    project_id: Optional[str] = None
    branch: Optional[str] = None

    # New v2 semantics
    comparison_type: str = "pre_deploy"  # pre_deploy or commit
    baseline_ref: Optional[str] = None
    candidate_ref: Optional[str] = None
    baseline_sha: Optional[str] = None
    candidate_sha: Optional[str] = None
    fail_on_ref_drift: bool = True
    compare_strategy: str = "deployment_state"  # deployment_state or branch_delta
    include_impact: bool = True
    impact_max_files: int = 15
    context_depth: int = 1
    merge_check_context: Optional[Dict[str, Any]] = None

    # Legacy-compatible aliases and analysis controls
    base_commit: Optional[str] = None
    target_commit: Optional[str] = None
    author_filter: Optional[str] = None
    analysis_mode: str = "full"
    max_files: int = 0
    file_status_filter: Optional[str] = None
    analysis_sort: str = "risk"

    # LLM Settings (Optional overrides)
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    openai_model: Optional[str] = None
    langfuse_public_key: Optional[str] = None
    langfuse_secret_key: Optional[str] = None
    langfuse_host: Optional[str] = None

    def effective_baseline_ref(self) -> Optional[str]:
        return self.baseline_ref or self.base_commit

    def effective_candidate_ref(self) -> Optional[str]:
        return self.candidate_ref or self.target_commit or self.branch


class CompareV2PreviewResult(BaseModel):
    schema_version: str = "2.0"
    comparison_type: str
    compare_strategy: str
    baseline_ref: str
    candidate_ref: str
    baseline_resolved: ResolvedGitRef
    candidate_resolved: ResolvedGitRef
    file_count: int
    commit_count: int
    total_additions: int
    total_deletions: int
    files: List[FileChange] = []
    include_impact: bool = True
    impact_max_files: int = 15
    direct_origin_counts: Dict[str, int] = {}
    run_manifest: Dict[str, Any] = {}
    triage_coverage: Dict[str, Any] = {}
    skipped_reasons: List[Dict[str, Any]] = []


class GitRefListResponse(BaseModel):
    default_branch: Optional[str] = None
    branches: List[Dict[str, Any]] = []
    tags: List[Dict[str, Any]] = []
    commits: List[Dict[str, Any]] = []


class MergeCheckResult(BaseModel):
    status: str
    mergeable: Optional[bool] = None
    has_conflicts: Optional[bool] = None
    conflict_files: List[str] = []
    method: str = "git_dry_run_merge"
    message: str
    target_ref: Optional[str] = None
    source_ref: Optional[str] = None
    target_sha: Optional[str] = None
    source_sha: Optional[str] = None
    merge_base_sha: Optional[str] = None
    target_resolved: Optional[ResolvedGitRef] = None
    source_resolved: Optional[ResolvedGitRef] = None
    diagnostics: Dict[str, Any] = {}


class MergePlanCandidate(BaseModel):
    id: str
    label: Optional[str] = None
    ref: str
    sha: Optional[str] = None


class MergePlanRequest(CompareV2Request):
    target_ref: str
    target_sha: Optional[str] = None
    candidates: List[MergePlanCandidate] = PydanticField(default_factory=list)
    include_ai_review: bool = True
    review_style: str = "balanced"
    force_refresh: bool = False


class MergePlanResult(BaseModel):
    schema_version: str = "merge_plan.1"
    status: str
    target_resolved: Optional[ResolvedGitRef] = None
    candidates: List[Dict[str, Any]] = PydanticField(default_factory=list)
    individual_results: List[Dict[str, Any]] = PydanticField(default_factory=list)
    sequential_results: List[Dict[str, Any]] = PydanticField(default_factory=list)
    summary_counts: Dict[str, Any] = PydanticField(default_factory=dict)
    first_blocker: Optional[Dict[str, Any]] = None
    ai_review: Optional[Dict[str, Any]] = None
    diagnostics: Dict[str, Any] = PydanticField(default_factory=dict)


class RefBookmarkCreate(BaseModel):
    repo_id: Optional[int] = None
    profile_id: Optional[int] = None
    git_url: Optional[str] = None
    project_id: Optional[str] = None
    label: str
    ref: str
    ref_type: str = "ref"
    sha: Optional[str] = None
    short_sha: Optional[str] = None
    title: Optional[str] = None
    note: Optional[str] = None
    color: Optional[str] = "amber"
    is_favorite: bool = True


class RefBookmarkUpdate(BaseModel):
    label: Optional[str] = None
    note: Optional[str] = None
    color: Optional[str] = None
    is_favorite: Optional[bool] = None

class GitCredentials(BaseModel):
    git_url: str
    git_token: str
    project_id: str
    branch: Optional[str] = None
    limit: Optional[int] = 100

class CommitInfo(BaseModel):
    id: str
    short_id: str
    title: str
    author_name: str
    author_email: str
    created_at: str

class AuthorInfo(BaseModel):
    name: str
    email: str

class ConnectionTestResult(BaseModel):
    success: bool
    message: str
    project_name: Optional[str] = None
    default_branch: Optional[str] = None


# --- Risk Review Models ---

class RiskFileInfo(BaseModel):
    """Single file with detected risk"""
    file_path: str
    risk_type: str
    severity: str  # HIGH, MEDIUM, LOW
    location: str
    original_content: str
    diff: Optional[str] = None

class RiskReviewRequest(BaseModel):
    """Request for AI-generated risk review prompt"""
    files: List[RiskFileInfo]
    base_commit: Optional[str] = None
    target_commit: Optional[str] = None
    checklist: List[str] = []
    style: str = PydanticField(default="balanced", description="프롬프트 스타일: detailed(자세하게), concise(핵심만), balanced(균형잡힌)")
    
    # LLM Settings
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    openai_model: Optional[str] = None
    langfuse_public_key: Optional[str] = None
    langfuse_secret_key: Optional[str] = None
    langfuse_host: Optional[str] = None

class RiskReviewResponse(BaseModel):
    """AI-generated risk review prompt"""
    generated_prompt: str
    file_count: int
    high_count: int
    medium_count: int
    low_count: int
    generation_mode: str = "local_template"
    fallback_reason: Optional[str] = None
    cache_hit: bool = False
    cache_key: Optional[str] = None
    cache_hits: Optional[int] = None
    cache_waited: bool = False


class RiskReviewRunRequest(BaseModel):
    """Request to execute the generated risk review prompt with the configured LLM"""
    prompt: str
    files: List[RiskFileInfo] = []
    base_commit: Optional[str] = None
    target_commit: Optional[str] = None
    style: str = "balanced"

    # LLM Settings
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    openai_model: Optional[str] = None
    langfuse_public_key: Optional[str] = None
    langfuse_secret_key: Optional[str] = None
    langfuse_host: Optional[str] = None


class RiskReviewRunResponse(BaseModel):
    """LLM result produced from the risk review prompt"""
    review_result: str
    file_count: int = 0
    generation_mode: str = "llm"
    model: Optional[str] = None
    prompt_chars: int = 0
    cache_hit: bool = False
    cache_key: Optional[str] = None
    cache_hits: Optional[int] = None
    cache_waited: bool = False

