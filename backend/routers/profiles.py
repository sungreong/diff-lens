from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select
from sqlalchemy.orm import selectinload

from src import GitLabClient, AnalysisPipeline, HistoryAnalyzerAgent
from src.agents import (
    CategoryAgent,
    FileAnalyzerAgent,
    SummaryGeneratorAgent,
    create_tracing_context,
    get_llm,
)
from src.analysis_cache import (
    build_analysis_cache_key,
    cache_stats,
    claim_inflight,
    get_cached_payload,
    get_inflight_progress,
    llm_fingerprint,
    resolve_inflight,
    set_cached_payload,
    update_inflight_progress,
    wait_for_inflight_payload,
)
from src.analysis_graph import (
    annotate_compare_origin,
    build_run_manifest,
    compare_origin_counts,
    compare_strategy_to_straight,
    run_compare_graph_stream,
)
from src.analysis_services import (
    normalize_analysis_sort,
    run_history_batch_analysis,
    run_standard_analysis,
    sort_file_changes_for_analysis,
)
from src.api_shared import (
    _ai_request_cache_key,
    _cacheable_response_payload,
    _cached_response_payload,
    _executor,
    _generate_local_risk_review_payload,
    _history_job_cache_key,
    _parse_sse_json_events,
    _resolve_legacy_analysis_runtime,
    _risk_review_cache_key,
    _risk_review_run_cache_key,
    _sanitize_for_ai_cache,
    get_prompts_for_profile,
    job_runner,
    logger,
    resolve_compare_v2_runtime,
)
from src.database import engine, get_session
from src.diff_triage import DiffTriageService
from src.git_client import count_diff_changes
from src.git_repository_agent import GitRepositoryAgent, RefDriftDetected
from src.job_store import get_job, list_jobs
from src.models import (
    AnalyzeRequest,
    AnalyzeResponse,
    AuthorInfo,
    CommitAnalysis,
    CommitInfo,
    CompareV2PreviewResult,
    CompareV2Request,
    ConnectionTestResult,
    FileHistoryAnalysis,
    GitCredentials,
    GitRefListResponse,
    GitRepository,
    HistoryAnalysisRequest,
    LangfuseTestResult,
    LLMConfig,
    LLMTestResult,
    MergeCheckResult,
    MergePlanRequest,
    PreviewRequest,
    PreviewResult,
    Profile,
    ProfileRead,
    PromptConfig as DbPromptConfig,
    RefBookmark,
    RefBookmarkCreate,
    RefBookmarkUpdate,
    RiskReviewRequest,
    RiskReviewResponse,
    RiskReviewRunRequest,
    TracingConfig,
)
from schemas import (
    BatchSummaryRequest,
    CustomGroupRequest,
    ExportSummaryTypesResponse,
    FieldExtractionRequest,
    FlatSummaryRequest,
)

router = APIRouter()

@router.get("/profiles", response_model=List[ProfileRead])
def list_profiles(session: Session = Depends(get_session)):
    statement = select(Profile).options(
        selectinload(Profile.repositories),
        selectinload(Profile.llm_configs),
        selectinload(Profile.tracing_configs)
    )
    return session.exec(statement).all()

@router.post("/profiles", response_model=ProfileRead)
def create_profile(profile: Profile, session: Session = Depends(get_session)):
    # If it's the first profile, make it active
    count = session.exec(select(Profile)).all()
    if not count:
        profile.is_active = True
    
    session.add(profile)
    session.commit()
    session.refresh(profile)
    
    # Initialize prompts for the new profile
    try:
        from src.prompt_registry import load_default_prompts
        fresh_defaults = load_default_prompts()
        prompt_config = DbPromptConfig(profile_id=profile.id, data=fresh_defaults)
        session.add(prompt_config)
        session.commit()
        print(f"DEBUG: Initialized {len(fresh_defaults)} prompts for new profile {profile.id}")
    except Exception as e:
        print(f"Warning: Failed to initialize prompts for new profile: {e}")
        
    return profile

@router.get("/profiles/active", response_model=Optional[ProfileRead])
def get_active_profile(session: Session = Depends(get_session)):
    try:
        statement = select(Profile).where(Profile.is_active == True).options(
            selectinload(Profile.repositories),
            selectinload(Profile.llm_configs),
            selectinload(Profile.tracing_configs)
        )
        profile = session.exec(statement).first()
        print(f"DEBUG: get_active_profile returning: {profile.id if profile else None}")
        return profile
    except Exception as e:
        print(f"ERROR in get_active_profile: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.patch("/profiles/{profile_id}/activate", response_model=ProfileRead)
def activate_profile(profile_id: int, session: Session = Depends(get_session)):
    # Deactivate all others
    others = session.exec(select(Profile).where(Profile.is_active == True)).all()
    for p in others:
        p.is_active = False
        session.add(p)
    
    profile = session.get(Profile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    profile.is_active = True
    session.add(profile)
    session.commit()
    session.refresh(profile)
    # Re-fetch with relations
    statement = select(Profile).where(Profile.id == profile_id).options(
        selectinload(Profile.repositories),
        selectinload(Profile.llm_configs),
        selectinload(Profile.tracing_configs)
    )
    return session.exec(statement).first()

@router.delete("/profiles/{profile_id}")
def delete_profile(profile_id: int, session: Session = Depends(get_session)):
    profile = session.get(Profile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    session.delete(profile)
    session.commit()
    return {"message": "Profile deleted"}

# --- Sub-Resource Management (Repositories) ---

@router.post("/profiles/{profile_id}/repos", response_model=GitRepository)
def create_repo(profile_id: int, repo: GitRepository, session: Session = Depends(get_session)):
    profile = session.get(Profile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    print(f"DEBUG: Creating repo for profile {profile_id}, repo data: {repo.model_dump()}")
    
    repo.profile_id = profile_id
    # Check if this is the first repo for this profile
    existing_repos = session.exec(select(GitRepository).where(GitRepository.profile_id == profile_id)).all()
    if not existing_repos:
        repo.is_active = True
        print(f"DEBUG: First repo for profile, setting as active")
        
    session.add(repo)
    session.commit()
    session.refresh(repo)
    print(f"DEBUG: Repo created successfully: {repo.id}")
    return repo

@router.patch("/repos/{repo_id}/activate", response_model=GitRepository)
def activate_repo(repo_id: int, session: Session = Depends(get_session)):
    repo = session.get(GitRepository, repo_id)
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    
    # Deactivate siblings
    siblings = session.exec(select(GitRepository).where(GitRepository.profile_id == repo.profile_id)).all()
    for s in siblings:
        s.is_active = False
        session.add(s)
        
    repo.is_active = True
    session.add(repo)
    session.commit()
    session.refresh(repo)
    return repo

@router.put("/repos/{repo_id}", response_model=GitRepository)
def update_repo(repo_id: int, repo_update: GitRepository, session: Session = Depends(get_session)):
    repo = session.get(GitRepository, repo_id)
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    
    # Update fields
    repo_data = repo_update.model_dump(exclude_unset=True, exclude={"id", "profile_id"})
    for key, value in repo_data.items():
        setattr(repo, key, value)
        
    session.add(repo)
    session.commit()
    session.refresh(repo)
    return repo

@router.delete("/repos/{repo_id}")
def delete_repo(repo_id: int, session: Session = Depends(get_session)):
    repo = session.get(GitRepository, repo_id)
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    session.delete(repo)
    session.commit()
    return {"message": "Repository deleted"}

# --- Sub-Resource Management (LLMs) ---

@router.post("/profiles/{profile_id}/llms", response_model=LLMConfig)
def create_llm(profile_id: int, llm: LLMConfig, session: Session = Depends(get_session)):
    profile = session.get(Profile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    llm.profile_id = profile_id
    if not profile.llm_configs:
        llm.is_active = True
        
    session.add(llm)
    session.commit()
    session.refresh(llm)
    return llm

@router.patch("/llms/{llm_id}/activate", response_model=LLMConfig)
def activate_llm(llm_id: int, session: Session = Depends(get_session)):
    llm = session.get(LLMConfig, llm_id)
    if not llm:
        raise HTTPException(status_code=404, detail="LLM Config not found")
    
    siblings = session.exec(select(LLMConfig).where(LLMConfig.profile_id == llm.profile_id)).all()
    for s in siblings:
        s.is_active = False
        session.add(s)
        
    llm.is_active = True
    session.add(llm)
    session.commit()
    session.refresh(llm)
    return llm

@router.put("/llms/{llm_id}", response_model=LLMConfig)
def update_llm(llm_id: int, llm_update: LLMConfig, session: Session = Depends(get_session)):
    llm = session.get(LLMConfig, llm_id)
    if not llm:
        raise HTTPException(status_code=404, detail="LLM Config not found")
    
    llm_data = llm_update.model_dump(exclude_unset=True, exclude={"id", "profile_id"})
    for key, value in llm_data.items():
        setattr(llm, key, value)
        
    session.add(llm)
    session.commit()
    session.refresh(llm)
    return llm

@router.delete("/llms/{llm_id}")
def delete_llm(llm_id: int, session: Session = Depends(get_session)):
    llm = session.get(LLMConfig, llm_id)
    if not llm:
        raise HTTPException(status_code=404, detail="LLM Config not found")
    session.delete(llm)
    session.commit()
    return {"message": "LLM Config deleted"}

# --- Sub-Resource Management (Tracing) ---

@router.post("/profiles/{profile_id}/tracings", response_model=TracingConfig)
def create_tracing(profile_id: int, tracing: TracingConfig, session: Session = Depends(get_session)):
    profile = session.get(Profile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    tracing.profile_id = profile_id
    if not profile.tracing_configs:
        tracing.is_active = True
        
    session.add(tracing)
    session.commit()
    session.refresh(tracing)
    return tracing

@router.patch("/tracings/{tracing_id}/activate", response_model=TracingConfig)
def activate_tracing(tracing_id: int, session: Session = Depends(get_session)):
    tracing = session.get(TracingConfig, tracing_id)
    if not tracing:
        raise HTTPException(status_code=404, detail="Tracing Config not found")
    
    siblings = session.exec(select(TracingConfig).where(TracingConfig.profile_id == tracing.profile_id)).all()
    for s in siblings:
        s.is_active = False
        session.add(s)
        
    tracing.is_active = True
    session.add(tracing)
    session.commit()
    session.refresh(tracing)
    return tracing

@router.put("/tracings/{tracing_id}", response_model=TracingConfig)
def update_tracing(tracing_id: int, tracing_update: TracingConfig, session: Session = Depends(get_session)):
    tracing = session.get(TracingConfig, tracing_id)
    if not tracing:
        raise HTTPException(status_code=404, detail="Tracing Config not found")
    
    tracing_data = tracing_update.model_dump(exclude_unset=True, exclude={"id", "profile_id"})
    for key, value in tracing_data.items():
        setattr(tracing, key, value)
        
    session.add(tracing)
    session.commit()
    session.refresh(tracing)
    return tracing

# --- AI Service Testing ---

@router.post("/test/openai", response_model=LLMTestResult)
def test_openai(
    openai_api_key: str = Body(..., embed=True),
    openai_base_url: str = Body("https://api.openai.com/v1", embed=True),
    openai_model: str = Body("gpt-4o-mini", embed=True)
):
    try:
        from openai import OpenAI
        client = OpenAI(api_key=openai_api_key, base_url=openai_base_url)
        # Use a cheap, fast model for testing
        response = client.chat.completions.create(
            model=openai_model,
            messages=[{"role": "user", "content": "Say 'ok'"}],
            max_tokens=5
        )
        return LLMTestResult(
            success=True,
            message="OpenAI 연결 성공!",
            model=response.model
        )
    except Exception as e:
        return LLMTestResult(success=False, message=f"OpenAI 연결 실패: {str(e)}")

@router.post("/test/langfuse", response_model=LangfuseTestResult)
def test_langfuse(
    public_key: str = Body(..., embed=True),
    secret_key: str = Body(..., embed=True),
    host: str = Body(..., embed=True)
):
    try:
        from langfuse import Langfuse
        langfuse = Langfuse(
            public_key=public_key,
            secret_key=secret_key,
            host=host
        )
        # Attempt to auth/ping
        if langfuse.auth_check():
            return LangfuseTestResult(success=True, message="Langfuse 연결 성공!")
        else:
            return LangfuseTestResult(success=False, message="Langfuse 연결 실패: 인증 정보를 확인해 주세요.")
    except Exception as e:
        return LangfuseTestResult(success=False, message=f"Langfuse 연결 실패: {str(e)}")

# --- Original Endpoints ---

