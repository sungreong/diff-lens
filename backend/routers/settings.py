from fastapi import APIRouter, HTTPException, Depends, Query, Body
from sqlmodel import Session, select
from typing import Dict, Any, Optional

from schemas import PromptsConfig, ReferencePrompts, ResetRequest
from src.database import get_session
from src.models import Profile, PromptConfig as DbPromptConfig
from src.prompt_registry import get_required_variables, load_default_prompts, merge_prompt_configs

router = APIRouter(prefix="/settings/prompts", tags=["settings"])

def get_profile_prompts(session: Session, profile_id: int) -> Dict[str, Any]:
    statement = select(DbPromptConfig).where(DbPromptConfig.profile_id == profile_id)
    prompt_config = session.exec(statement).first()
    current = prompt_config.data if prompt_config else {}
    return merge_prompt_configs(current)

@router.get("", response_model=ReferencePrompts)
def get_prompts(
    profile_id: Optional[int] = Query(None, description="Profile ID to fetch prompts for"),
    session: Session = Depends(get_session)
):
    fresh_defaults = load_default_prompts()

    if not profile_id:
        statement = select(Profile).where(Profile.is_active == True)
        active_profile = session.exec(statement).first()
        if active_profile:
            profile_id = active_profile.id
        else:
            return ReferencePrompts(current=fresh_defaults, default=fresh_defaults)

    # Fetch from DB
    statement = select(DbPromptConfig).where(DbPromptConfig.profile_id == profile_id)
    prompt_config = session.exec(statement).first()
    
    current_data = prompt_config.data if prompt_config else {}
    merged_data = merge_prompt_configs(current_data)
    needs_sync = merged_data != current_data

    # If missing defaults were found, persist them to DB immediately
    if needs_sync:
        if not prompt_config:
            prompt_config = DbPromptConfig(profile_id=profile_id, data=merged_data)
            session.add(prompt_config)
        else:
            prompt_config.data = merged_data
            session.add(prompt_config)
        session.commit()
        session.refresh(prompt_config)

    return ReferencePrompts(
        current=prompt_config.data if prompt_config else merged_data,
        default=fresh_defaults
    )

@router.put("", response_model=PromptsConfig)
def update_prompts(
    config: PromptsConfig,
    profile_id: Optional[int] = Query(None, description="Profile ID to update prompts for"),
    session: Session = Depends(get_session)
):
    if not profile_id:
         # Try active
        statement = select(Profile).where(Profile.is_active == True)
        active_profile = session.exec(statement).first()
        if active_profile:
            profile_id = active_profile.id
        else:
            raise HTTPException(status_code=400, detail="Profile ID required")

    data = config.model_dump()
    
    data = merge_prompt_configs(data)

    # Server-side Validation of Required Variables
    for agent, prompt_data in data.items():
        if not isinstance(prompt_data, dict) or "user_prompt" not in prompt_data:
            continue
        
        user_prompt = prompt_data.get("user_prompt") or ""
        missing = []
        for var in get_required_variables(agent):
            if var not in user_prompt:
                missing.append(var)
        
        if missing:
             raise HTTPException(
                status_code=400, 
                detail=f"Missing required variables in {agent} user_prompt: {', '.join(missing)}"
            )

    try:
        # Upsert
        statement = select(DbPromptConfig).where(DbPromptConfig.profile_id == profile_id)
        prompt_config = session.exec(statement).first()
        
        if not prompt_config:
            prompt_config = DbPromptConfig(profile_id=profile_id, data=data)
            session.add(prompt_config)
        else:
            prompt_config.data = data
            session.add(prompt_config)
            
        session.commit()
        session.refresh(prompt_config)
        
        return prompt_config.data
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/reset", response_model=PromptsConfig)
def reset_prompts(
    request: ResetRequest,
    profile_id: Optional[int] = Query(None, description="Profile ID to reset prompts for"),
    session: Session = Depends(get_session)
):
    fresh_defaults = load_default_prompts()
    
    if not profile_id:
        # Try active
        statement = select(Profile).where(Profile.is_active == True)
        active_profile = session.exec(statement).first()
        if active_profile:
            profile_id = active_profile.id
        else:
             raise HTTPException(status_code=400, detail="Profile ID required")

    agent = request.agent_name
    
    if agent not in fresh_defaults:
        raise HTTPException(status_code=400, detail=f"Invalid agent name: {agent}")
        
    # Get database record
    statement = select(DbPromptConfig).where(DbPromptConfig.profile_id == profile_id)
    prompt_config = session.exec(statement).first()
    
    # Get current data or start with empty
    current_data = prompt_config.data.copy() if prompt_config else {}
    
    # Overwrite only the requested agent's prompt with fresh default
    current_data[agent] = fresh_defaults[agent]
    
    # Ensure other default keys exist if it's a legacy profile
    for key, val in fresh_defaults.items():
        if key not in current_data:
            current_data[key] = val
    
    if not prompt_config:
        prompt_config = DbPromptConfig(profile_id=profile_id, data=current_data)
        session.add(prompt_config)
    else:
        prompt_config.data = current_data
        session.add(prompt_config)
        
    session.commit()
    session.refresh(prompt_config)
    
    return prompt_config.data
