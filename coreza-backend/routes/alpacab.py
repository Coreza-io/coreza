import os
import uuid
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import JSONResponse
from supabase import create_client
from alpaca_trade_api.rest import REST
from pydantic import BaseModel

# Initialize Supabase client (replace with env vars or config)
SUPABASE_URL = "https://tiitofotheupylvxivge.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXRvZm90aGV1cHlsdnhpdmdlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDkyNzI0MSwiZXhwIjoyMDY2NTAzMjQxfQ.azjdmYIYlqd9-CBTuHoPHux_PUs97Dk4jpP_2RX9_n8"
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Alpaca API URLs (Paper trading by default)
ALPACA_PAPER_URL = "https://paper-api.alpaca.markets"
ALPACA_DATA_URL = "https://data.alpaca.markets"

router = APIRouter(prefix="/alpaca", tags=["Alpaca"])

class AuthRequest(BaseModel):
    user_id: str
    api_key: str
    secret_key: str
    credential_name: Optional[str] = "Personal Alpaca"

class RestRequest(BaseModel):
    user_id: str
    credential_id: str
    endpoint: str
    params: Optional[Dict[str, Any]] = None

class GetCandleRequest(BaseModel):
    user_id: str
    credential_id: str
    ticker: str
    interval: str
    lookback: int

@router.post("/auth-url")
def alpaca_auth_url(payload: AuthRequest = Body(...)):
    print("Received /auth-url payload:", payload.dict())  # Don't print secrets in production!
    user_id = payload.user_id
    api_key = payload.api_key
    secret_key = payload.secret_key
    credential_name = payload.credential_name or "Personal Alpaca"

    try:
        client = REST(api_key, secret_key, base_url=ALPACA_PAPER_URL)
        client.get_account()
    except Exception as e:
        import traceback; traceback.print_exc()
        return JSONResponse(
            {"success": False, "error": f"Validation failed: {e}"},
            status_code=400
        )

    cred_id = str(uuid.uuid4())
    record = {
        "id": cred_id,
        "user_id": user_id,
        "name": credential_name,
        "service_type": "alpaca",
        "client_json": {"api_key": api_key, "secret_key": secret_key}
    }
    try:
        upsert = supabase.table("user_credentials").upsert(
            record,
            on_conflict="user_id,name"
        ).execute()
        print("Supabase upsert result:", upsert)

        if not upsert or not upsert.data:
            raise Exception("Supabase upsert failed: No data returned.")
        cred_id = upsert.data[0].get("id", cred_id)
        return {"success": True, "credential_id": cred_id}
    except Exception as e:
        import traceback; traceback.print_exc()
        return JSONResponse(
            {"success": False, "error": f"Supabase error: {e}"},
            status_code=500
        )

@router.get("/credentials")
def list_alpaca_credentials(user_id: str = Query(...)):
    print("Get Credentials")
    try:
        resp = supabase.table("user_credentials") \
            .select("id, name") \
            .eq("user_id", user_id) \
            .eq("service_type", "alpaca") \
            .execute()
        return {"success": True, "credentials": resp.data}
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Supabase error: {e}")

@router.post("/rest")
async def alpaca_rest(req: RestRequest):
    try:
        result = supabase.table("user_credentials") \
            .select("token_json") \
            .eq("user_id", req.user_id) \
            .eq("name", req.credential_id) \
            .eq("service_type", "alpaca") \
            .single() \
            .execute()
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Supabase error: {e}")

    creds = result.data.get("client_json", {})
    api_key = creds.get("api_key")
    secret_key = creds.get("secret_key")
    if not api_key or not secret_key:
        raise HTTPException(status_code=400, detail="API credentials not found.")

    # If calling /v2/account, use SDK
    if req.endpoint.endswith("/account"):
        try:
            client = REST(api_key, secret_key, base_url=ALPACA_PAPER_URL)
            account = client.get_account()
            return {"success": True, "data": account._raw}
        except Exception as e:
            import traceback; traceback.print_exc()
            raise HTTPException(status_code=400, detail=str(e))

    # Fallback: raw HTTP for any other endpoint
    import httpx
    url = req.endpoint if req.endpoint.startswith("http") else f"{ALPACA_PAPER_URL}{req.endpoint}"
    headers = {"APCA-API-KEY-ID": api_key, "APCA-API-SECRET-KEY": secret_key}
    try:
        resp = httpx.get(url, headers=headers, params=req.params or {}, timeout=10)
        resp.raise_for_status()
        return {"success": True, "data": resp.json()}
    except httpx.HTTPStatusError as exc:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text)
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/get-candle")
async def get_candle(req: GetCandleRequest):
    try:
        result = supabase.table("user_credentials") \
            .select("client_json") \
            .eq("user_id", req.user_id) \
            .eq("name", req.credential_id) \
            .eq("service_type", "alpaca") \
            .single() \
            .execute()
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Supabase error: {e}")

    creds = result.data.get("client_json", {})
    api_key = creds.get("api_key")
    secret_key = creds.get("secret_key")
    if not api_key or not secret_key:
        raise HTTPException(status_code=400, detail="API credentials not found.")

    client = REST(
        api_key,
        secret_key,
        base_url=ALPACA_PAPER_URL
    )

    try:
        bars_response = client.get_bars(
            symbol=req.ticker.upper(),
            timeframe=req.interval,
            limit=req.lookback
        )
        bars_list: List = getattr(bars_response, 'bars', bars_response)
        serialized = []
        for bar in bars_list:
            serialized.append({
                "timestamp": bar.t.isoformat(),
                "open": bar.o,
                "high": bar.h,
                "low": bar.l,
                "close": bar.c,
                "volume": bar.v
            })
        return {"success": True, "data": {"bars": serialized}}
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=400, detail=str(e))
