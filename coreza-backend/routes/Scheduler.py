from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/execute", tags=["Scheduler"])

class SchedulerRequest(BaseModel):
    user_id: str
    interval: str   # "Minutes", "Hours", "Days", "Weeks", or "Months"
    count: str      # e.g. "1"
    hour: str       # "0"–"23"
    minute: str     # "0"–"59"

class SchedulerResponse(BaseModel):
    success: bool
    schedule: dict

@router.post("/scheduler", response_model=SchedulerResponse)
def scheduler_node(req: SchedulerRequest):
    # --- Validate and parse ---
    try:
        count  = int(req.count)
        hour   = int(req.hour)
        minute = int(req.minute)
    except ValueError:
        raise HTTPException(400, "Fields `count`, `hour` and `minute` must be integers")

    if req.interval not in {"Minutes", "Hours", "Days", "Weeks", "Months"}:
        raise HTTPException(400, f"Unsupported interval: {req.interval}")

    # --- Return same schedule back for your NodeJS scheduler to consume ---
    return {
        "success": True,
        "schedule": {
            "user_id": req.user_id,
            "interval": req.interval,
            "count": count,
            "hour": hour,
            "minute": minute
        }
    }
