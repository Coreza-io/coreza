from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from agent_runner import run_agent

router = APIRouter()

class AgentRequest(BaseModel):
    user_id: str
    user_msg: str  # Changed from 'input' to match your implementation
    prompt: str
    model: str
    api_key: str
    temperature: Optional[str] = None  # String to match frontend payload
    max_tokens: Optional[str] = None   # String to match frontend payload

@router.post("/run_agent")
async def call_agent(request: AgentRequest):
    # Convert Pydantic model to dict (using model_dump for Pydantic v2)
    agent_data = request.model_dump()
    print("agent_data",agent_data)
    result = await run_agent(agent_data)
    return {"output": result}