from fastapi import APIRouter, HTTPException, Body, Path
from pydantic import ValidationError
from typing import Any, Dict
from function.indicator import indicator_map

router = APIRouter(prefix="/indicators", tags=["Indicators"])

@router.post("/{indicator}")
async def run_indicator(
    indicator: str = Path(..., description="Name of the indicator to compute"),
    raw_payload: Dict[str, Any] = Body(...),
) -> Dict[str, Any]:
    # 1️⃣ Find the entry in our map
    entry = indicator_map.get(indicator.lower())
    if not entry:
        raise HTTPException(status_code=404, detail=f"Indicator '{indicator}' not found")

    # 2️⃣ Validate & coerce the payload with the right Pydantic model
    Model = entry["model"]
    try:
        req = Model(**raw_payload)
    except ValidationError as ve:
        # Returns structured validation errors as HTTP 422
        raise HTTPException(status_code=422, detail=ve.errors())

    # 3️⃣ Call the function
    payload = req.model_dump()
    result = entry["func"](payload)

    # 4️⃣ Surface indicator‑level errors as HTTP 400
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    return result
