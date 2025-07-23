from fastapi import APIRouter, Body, HTTPException, status
from pydantic import BaseModel, Field, validator
from typing import List, Literal, Dict, Any
from datetime import datetime
import pytz

from function.market import market_info_func

class MarketStatusRequest(BaseModel):
    market_type: Literal["stocks", "crypto", "forex", "commodities", "bonds"]
    exchange: str = Field(..., description="Exchange identifier matching the market type")
    info_types: List[Literal["status", "hours", "next_event", "holidays", "session_type"]]
    timezone: str = Field(..., description="IANA timezone for time-related responses")

# Initialize router
router = APIRouter(prefix="/market", tags=["Market"])

@router.post("/market_info", status_code=status.HTTP_200_OK)
async def market_status(request: MarketStatusRequest = Body(...)) -> Dict[str, Any]:
    # 2. Fetch raw market data
    try:
        print("Market request", request)
        raw_data = await market_info_func(
            market_type=request.market_type,
            exchange=request.exchange,
            timezone=request.timezone
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"error": f"Failed to fetch market data: {str(e)}"}
        )

    # 3. Build base response
    tz = pytz.timezone(request.timezone)
    now_ts = datetime.now(tz).isoformat()

    response_payload: Dict[str, Any] = {
        "market_type": request.market_type,
        "exchange": request.exchange,
        "timezone": request.timezone,
        "timestamp": now_ts
    }

    # 4. Filter and attach requested info_types
    for info in request.info_types:
        if info in raw_data:
            response_payload[info] = raw_data[info]

    return {"success": True, "data": response_payload}

# Helper: (Optionally, move this into .market or a utils module)
def filter_response_data(market_data: Dict[str, Any], info_types: List[str]) -> Dict[str, Any]:
    """
    Extracts only the requested keys from the full market_data.
    """
    return {key: market_data.get(key) for key in info_types if key in market_data}

# Note:
# - Implement get_market_data in market.py for each asset class (stocks, crypto, etc.)
# - Consider integrating caching (e.g., in-memory or Redis) per CACHE_DURATION constants
# - Raise exceptions in service layer to bubble errors here
