from langchain.chat_models import ChatOpenAI
from langchain.schema import SystemMessage, HumanMessage
from typing import Dict, Any, Optional
import logging
from supabase import create_client
async def run_agent(data: Dict[str, Any]) -> str:
    """
    Execute an LLM agent with validated parameters.
    
    Args:
        data: Dictionary containing:
            - userid: str
            - api_key: (str) OpenAI API key (required)
            - model: (str) Model name (required)
            - user_msg: (str) User message (required)
            - prompt: (str) System prompt (optional)
            - temperature: (float, optional) 0-2, default 0
            - max_tokens: (int, optional) Default None
            
    Returns:
        str: Generated response content
        
    Raises:
        ValueError: For missing/invalid required fields
        HTTPException: For request processing errors (if using FastAPI)
    """
    # Set up logging
    logger = logging.getLogger(__name__)

    SUPABASE_URL = "https://tiitofotheupylvxivge.supabase.co"
    SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXRvZm90aGV1cHlsdnhpdmdlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDkyNzI0MSwiZXhwIjoyMDY2NTAzMjQxfQ.azjdmYIYlqd9-CBTuHoPHux_PUs97Dk4jpP_2RX9_n8"
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    try:
        # Validate required fields with clear error messages
        required_fields = {
            "api_key": "OpenAI API key is required",
            "model": "Model name is required",
            "user_msg": "User message is required"
        }
        
        missing_fields = [field for field, msg in required_fields.items() if not data.get(field)]
        if missing_fields:
            raise ValueError(f"Missing required fields: {', '.join(missing_fields)}")

        # Parse and validate numerical parameters
        temperature = _parse_float(data.get("temperature"), default=0.0, min_val=0.0, max_val=2.0)
        max_tokens = _parse_int(data.get("max_tokens"))
        response = (
            supabase.table("user_credentials")
            .select("client_json")
            .eq("user_id", data.get("user_id"))  # Make sure this key exists in `data`
            .eq("name", data.get("api_key"))
            .single()
            .execute()
        )
        print("response",response)
        api_key = response.data.get("client_json", {}).get("api_key")
        print("api_key",api_key)

        # Initialize LLM with validated parameters
        llm = ChatOpenAI(
            openai_api_key=api_key,
            model_name=data["model"].strip(),
            temperature=temperature,
            max_tokens=max_tokens,
            request_timeout=30  # Add timeout for production
        )

        # Prepare messages with defaults
        messages = [
            SystemMessage(content=data.get("prompt", "").strip()),
            HumanMessage(content=data["user_msg"].strip())
        ]
        
        # Execute and return response
        result = await llm.ainvoke(messages)
        return result.content

    except ValueError as ve:
        logger.error(f"Validation error: {str(ve)}")
        raise  # Re-raise for FastAPI to handle as 422
    except Exception as e:
        logger.error(f"Unexpected error in run_agent: {str(e)}", exc_info=True)
        raise  # Consider custom error class for API responses

def _parse_float(value: Any, default: float, min_val: Optional[float] = None, max_val: Optional[float] = None) -> float:
    """Safe float parsing with validation."""
    try:
        num = float(value) if value not in [None, ""] else default
        if min_val is not None and num < min_val:
            return min_val
        if max_val is not None and num > max_val:
            return max_val
        return num
    except (TypeError, ValueError):
        return default

def _parse_int(value: Any) -> Optional[int]:
    """Safe integer parsing."""
    try:
        return int(value) if value not in [None, ""] else None
    except (TypeError, ValueError):
        return None