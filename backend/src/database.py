from sqlmodel import create_engine, SQLModel, Session
from sqlmodel import select
import os

# SQLite 최적화 설정 모듈 임포트
from .sqlite_config import configure_sqlite_engine

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./storage.db")

engine = create_engine(
    DATABASE_URL, 
    echo=True, 
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {}
)

# SQLite 최적화 PRAGMA 설정 적용 (WAL 모드, busy timeout, synchronous 등)
if "sqlite" in DATABASE_URL:
    configure_sqlite_engine(engine)

def reset_database_if_needed():
    """
    Reset database if RESET_DB_ON_STARTUP environment variable is set to 'true'.
    This is useful for development to start with a clean slate.
    """
    reset_db = os.environ.get("RESET_DB_ON_STARTUP", "false").lower() == "true"
    
    if reset_db:
        db_file = DATABASE_URL.replace("sqlite:///", "").replace("./", "")
        if os.path.exists(db_file):
            try:
                os.remove(db_file)
                print(f"🔄 Database file '{db_file}' removed for reset (RESET_DB_ON_STARTUP=true)")
            except Exception as e:
                print(f"⚠️  Warning: Could not remove database file: {e}")
        else:
            print(f"ℹ️  Database file '{db_file}' does not exist, will create new one")
    else:
        print("ℹ️  Database reset disabled (RESET_DB_ON_STARTUP=false or not set)")


def create_db_and_tables():
    # Reset database if environment variable is set
    reset_database_if_needed()
    
    from .models import Profile, GitRepository, LLMConfig, TracingConfig, RefBookmark
    from sqlalchemy import inspect, text
    
    inspector = inspect(engine)
    existing_tables = inspector.get_table_names()
    
    # Check if migration is needed (if profile exists but gitrepository doesn't)
    migration_needed = 'profile' in existing_tables and 'gitrepository' not in existing_tables
    old_profiles_data = []

    if migration_needed:
        print("Migration needed: Extracting old profile data...")
        with Session(engine) as session:
            try:
                # Fetch raw data to avoid model validation errors
                result = session.execute(text("SELECT * FROM profile"))
                columns = result.keys()
                for row in result:
                    row_dict = dict(zip(columns, row))
                    old_profiles_data.append(row_dict)
            except Exception as e:
                print(f"Error reading old profiles: {e}")

    # Create new tables
    SQLModel.metadata.create_all(engine)
    
    if migration_needed and old_profiles_data:
        print(f"Migrating {len(old_profiles_data)} profiles...")
        with Session(engine) as session:
            for p_data in old_profiles_data:
                pid = p_data.get('id')
                if not pid: continue
                
                # Migrate Git Settings
                if p_data.get('git_url'):
                    repo = GitRepository(
                        profile_id=pid,
                        name="Default Repo",
                        git_url=p_data.get('git_url', ''),
                        git_token=p_data.get('git_token', ''),
                        project_id=p_data.get('project_id', ''),
                        is_active=True
                    )
                    session.add(repo)
                
                # Migrate LLM Settings
                if p_data.get('openai_api_key') or p_data.get('openai_base_url'):
                    llm = LLMConfig(
                        profile_id=pid,
                        name="Default LLM",
                        openai_api_key=p_data.get('openai_api_key'),
                        openai_base_url=p_data.get('openai_base_url', "https://api.openai.com/v1"),
                        openai_model=p_data.get('openai_model', "gpt-4o-mini"),
                        is_active=True
                    )
                    session.add(llm)

                # Migrate Tracing Settings
                if p_data.get('langfuse_public_key'):
                    tracing = TracingConfig(
                        profile_id=pid,
                        name="Default Tracing",
                        langfuse_public_key=p_data.get('langfuse_public_key'),
                        langfuse_secret_key=p_data.get('langfuse_secret_key'),
                        langfuse_host=p_data.get('langfuse_host', "https://cloud.langfuse.com"),
                        is_active=True
                    )
                    session.add(tracing)
            
            session.commit()
            session.commit()
            print("Settings migration completed.")
    
    # Schema Cleanup: Remove legacy columns from 'profile' table if they exist
    # This fixes IntegrityError: NOT NULL constraint failed: profile.git_url
    try:
        inspector = inspect(engine)
        columns = [c['name'] for c in inspector.get_columns('profile')]
        if 'git_url' in columns:
            print("Schema cleanup needed: removing legacy columns from 'profile'...")
            with Session(engine) as session:
                # 1. Rename old table
                session.exec(text("ALTER TABLE profile RENAME TO profile_legacy"))
                
                # 2. Create new table (clean schema)
                SQLModel.metadata.create_all(engine)
                
                # 3. Copy core data back
                # We simply copy id, name, is_active. 
                # Newer columns/relationships are handled by new schema or empty.
                session.exec(text("""
                    INSERT INTO profile (id, name, is_active)
                    SELECT id, name, is_active FROM profile_legacy
                """))
                
                # 4. Drop legacy table
                session.exec(text("DROP TABLE profile_legacy"))
                session.commit()
                print("Schema cleanup completed.")
    except Exception as e:
        print(f"Schema cleanup warning: {e}")

    # Migration: Add 'branch' column to 'gitrepository' if missing
    try:
        inspector = inspect(engine)
        if 'gitrepository' in inspector.get_table_names():
            columns = [c['name'] for c in inspector.get_columns('gitrepository')]
            if 'branch' not in columns:
                print("Migration needed: Adding 'branch' column to gitrepository...")
                with Session(engine) as session:
                    session.exec(text("ALTER TABLE gitrepository ADD COLUMN branch VARCHAR DEFAULT 'main'"))
                    session.commit()
                print("Migration: 'branch' column added.")
    except Exception as e:
        print(f"Migration warning: {e}")

    # Migration: Add 'commit_limit' column to 'gitrepository' if missing
    try:
        inspector = inspect(engine)
        if 'gitrepository' in inspector.get_table_names():
            columns = [c['name'] for c in inspector.get_columns('gitrepository')]
            if 'commit_limit' not in columns:
                print("Migration needed: Adding 'commit_limit' column to gitrepository...")
                with Session(engine) as session:
                    session.exec(text("ALTER TABLE gitrepository ADD COLUMN commit_limit INTEGER DEFAULT 100"))
                    session.commit()
                print("Migration: 'commit_limit' column added.")
    except Exception as e:
        print(f"Migration warning: {e}")

    # Initialize / Sync Default Prompts for all profiles
    try:
        from .models import PromptConfig as DbPromptConfig, Profile
        from .prompt_registry import DEFAULT_PROMPTS, merge_prompt_configs
        
        with Session(engine) as session:
            profiles = session.exec(select(Profile)).all()
            for profile in profiles:
                # Check if prompt config exists
                statement = select(DbPromptConfig).where(DbPromptConfig.profile_id == profile.id)
                db_config = session.exec(statement).first()
                
                if not db_config:
                    print(f"Initializing default prompts for profile '{profile.name}'")
                    new_config = DbPromptConfig(profile_id=profile.id, data=DEFAULT_PROMPTS)
                    session.add(new_config)
                else:
                    # Sync missing keys from defaults to database, including nested prompt settings.
                    updated_data = merge_prompt_configs(db_config.data or {})
                    added_keys = [key for key in DEFAULT_PROMPTS.keys() if key not in (db_config.data or {})]

                    if updated_data != (db_config.data or {}):
                        if added_keys:
                            print(f"Syncing new prompt defaults ({', '.join(added_keys)}) to profile '{profile.name}'")
                        else:
                            print(f"Syncing nested prompt defaults to profile '{profile.name}'")
                        db_config.data = updated_data
                        session.add(db_config)
            
            session.commit()
    except Exception as e:
        print(f"Prompt initialization error: {e}")

def get_session():
    with Session(engine) as session:
        yield session
