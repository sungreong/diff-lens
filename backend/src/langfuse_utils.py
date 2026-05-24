"""
Langfuse compatibility module for monitoring LangChain calls.
Supports both Langfuse 2.x and 3.x versions.
"""
import os
from typing import Optional, Dict, Any, List
from langchain_core.runnables import RunnableConfig

# Version detection
try:
    import langfuse
    LANGFUSE_VERSION = getattr(langfuse, '__version__', '2.0.0')
    IS_LANGFUSE_V3 = LANGFUSE_VERSION.startswith('3.')
except ImportError:
    LANGFUSE_VERSION = None
    IS_LANGFUSE_V3 = False


def get_langfuse_handler(
    public_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    host: Optional[str] = None,
    session_id: Optional[str] = None,
    user_id: Optional[str] = None,
    tags: Optional[List[str]] = None
):
    """
    Get Langfuse callback handler with version compatibility.
    
    Args:
        public_key: Langfuse public key
        secret_key: Langfuse secret key
        host: Langfuse host URL
        session_id: Session ID for tracing
        user_id: User ID for tracing
        tags: Tags for the trace
        
    Returns:
        Langfuse callback handler or None if not configured
    """
    pk = public_key or os.getenv("LANGFUSE_PUBLIC_KEY")
    sk = secret_key or os.getenv("LANGFUSE_SECRET_KEY")
    h = host or os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")
    
    if not pk or not sk:
        return None
    
    try:
        from langfuse.callback import CallbackHandler as LangfuseCallbackHandler
        
        handler = LangfuseCallbackHandler(
            public_key=pk,
            secret_key=sk,
            host=h,
            session_id=session_id,
            user_id=user_id,
            tags=tags or []
        )
        return handler
    except Exception as e:
        print(f"DEBUG: Failed to create Langfuse handler: {e}")
        return None


def create_runnable_config(
    langfuse_handler: Optional[Any] = None,
    session_id: Optional[str] = None,
    trace_name: Optional[str] = None,
    tags: Optional[List[str]] = None,
    metadata: Optional[Dict[str, Any]] = None
) -> RunnableConfig:
    """
    Create a RunnableConfig with Langfuse callback and metadata.
    
    Args:
        langfuse_handler: Langfuse callback handler
        session_id: Session ID for tracing
        trace_name: Name for the trace
        tags: Tags for the trace
        metadata: Additional metadata
        
    Returns:
        RunnableConfig instance
    """
    callbacks = []
    if langfuse_handler:
        callbacks.append(langfuse_handler)
    
    config_metadata = metadata.copy() if metadata else {}
    if session_id:
        config_metadata["session_id"] = session_id
    if trace_name:
        config_metadata["trace_name"] = trace_name
    if tags:
        config_metadata["tags"] = tags
    
    if IS_LANGFUSE_V3:
        # Langfuse 3.x uses RunnableConfig directly
        return RunnableConfig(
            callbacks=callbacks,
            metadata=config_metadata
        )
    else:
        # Langfuse 2.x - return dict-style config
        return {
            "callbacks": callbacks,
            "metadata": config_metadata
        }


class LangfuseTracingContext:
    """
    Context manager for Langfuse tracing.
    Provides consistent config across agent calls.
    """
    
    def __init__(
        self,
        public_key: Optional[str] = None,
        secret_key: Optional[str] = None,
        host: Optional[str] = None,
        session_id: Optional[str] = None,
        user_id: Optional[str] = None,
        tags: Optional[List[str]] = None
    ):
        self.public_key = public_key or os.getenv("LANGFUSE_PUBLIC_KEY")
        self.secret_key = secret_key or os.getenv("LANGFUSE_SECRET_KEY")
        self.host = host or os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")
        
        self.handler = get_langfuse_handler(
            public_key=public_key,
            secret_key=secret_key,
            host=host,
            session_id=session_id,
            user_id=user_id,
            tags=tags
        )
        self.session_id = session_id
        self.user_id = user_id
        self.tags = tags or []
    
    @property
    def is_enabled(self) -> bool:
        """Check if Langfuse tracing is enabled and handler is active."""
        return self.handler is not None
    
    def get_config(
        self,
        trace_name: Optional[str] = None,
        additional_tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> RunnableConfig:
        """
        Get config for a specific trace.
        
        Args:
            trace_name: Name for this specific trace
            additional_tags: Additional tags to add
            metadata: Additional metadata
            
        Returns:
            RunnableConfig for the chain
        """
        all_tags = self.tags + (additional_tags or [])
        
        return create_runnable_config(
            langfuse_handler=self.handler,
            session_id=self.session_id,
            trace_name=trace_name,
            tags=all_tags,
            metadata=metadata
        )
    
    def flush(self):
        """Flush any pending traces to Langfuse."""
        if self.handler and hasattr(self.handler, 'langfuse'):
            try:
                self.handler.langfuse.flush()
            except Exception:
                pass
    
    def get_status(self) -> Dict[str, Any]:
        """Get detailed status of Langfuse configuration."""
        return {
            "enabled": self.is_enabled,
            "version": LANGFUSE_VERSION,
            "is_v3": IS_LANGFUSE_V3,
            "host": self.host,
            "public_key_set": bool(self.public_key),
            "secret_key_set": bool(self.secret_key),
            "session_id": self.session_id,
            "handler_active": self.handler is not None
        }


def check_langfuse_status() -> Dict[str, Any]:
    """
    Check Langfuse configuration status from environment variables.
    
    Returns:
        Dict with status information
    """
    pk = os.getenv("LANGFUSE_PUBLIC_KEY")
    sk = os.getenv("LANGFUSE_SECRET_KEY")
    host = os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")
    
    status = {
        "langfuse_installed": LANGFUSE_VERSION is not None,
        "version": LANGFUSE_VERSION,
        "is_v3": IS_LANGFUSE_V3,
        "host": host,
        "public_key_configured": bool(pk),
        "secret_key_configured": bool(sk),
        "fully_configured": bool(pk and sk),
        "connection_test": None
    }
    
    # Test connection if configured
    if pk and sk:
        try:
            from langfuse import Langfuse
            client = Langfuse(
                public_key=pk,
                secret_key=sk,
                host=host
            )
            # Simple auth check
            client.auth_check()
            status["connection_test"] = "success"
            client.shutdown()
        except Exception as e:
            status["connection_test"] = f"failed: {str(e)}"
    
    return status
