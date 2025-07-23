"""
Module: Comparator Routes

Defines HTTP endpoints for comparator-based workflow nodes (if, switch).
"""

# Standard library imports
from typing import Any, List

# Third-party imports
from fastapi import APIRouter, HTTPException, Body
from pydantic import BaseModel

# Local imports
from function.comparator import if_func, switch_func

router = APIRouter(prefix="/comparator", tags=["Comparator"])


class IfCondition(BaseModel):
    """Single condition for 'if' comparisons."""
    left: Any
    operator: str
    right: Any


class IfRequest(BaseModel):
    """Payload for 'if' endpoint."""
    conditions: List[IfCondition]
    logicalOp: str = "AND"


@router.post("/if")
async def run_if(req: IfRequest = Body(...)) -> Any:
    """Run the 'if' comparator and return the boolean result."""
    payload = req.model_dump()
    result = if_func(payload)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


class SwitchCase(BaseModel):
    """Individual case for switch logic."""
    caseName: str
    caseValue: str


class SwitchRequest(BaseModel):
    """Payload for 'switch' endpoint."""
    inputValue: Any  # Changed from 'value' to 'inputValue'
    cases: List[SwitchCase]
    user_id: str  # Added user_id field
    # Note: 'default' field removed since it's not in the frontend payload


@router.post("/switch")
async def run_switch(req: SwitchRequest = Body(...)) -> Any:
    """Run the 'switch' comparator and return the selected branch."""
    payload = req.model_dump()
    print("Switch payload", payload)
    result = switch_func(payload)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result
