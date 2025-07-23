# routers/finnhubb_auth.py

import uuid
from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import JSONResponse
from supabase import create_client
import httpx
from pydantic import BaseModel
import time

router = APIRouter(prefix="/finnhub", tags=["FinnHub"])

# ✅ Pydantic model for data request
class QuoteRequest(BaseModel):
    user_id: str
    credential_id: str
    ticker: str

# replace with your real supabase service-role URL & key,
# ideally pulled from env vars
SUPABASE_URL = "https://tiitofotheupylvxivge.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXRvZm90aGV1cHlsdnhpdmdlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDkyNzI0MSwiZXhwIjoyMDY2NTAzMjQxfQ.azjdmYIYlqd9-CBTuHoPHux_PUs97Dk4jpP_2RX9_n8"
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

@router.post("/auth-url")
def add_finnhub_credential(payload: dict = Body(...)):
    """
    Expects JSON body { user_id, api_key, credential_name? } per your authFields.
    Validates the key by hitting Finnhub’s /quote endpoint, then upserts into Supabase.
    Returns { success: bool, credential_id: str }.
    """
    print("payload",payload)
    user_id        = payload.get("user_id")
    api_key        = payload.get("api_key")
    credential_name= payload.get("credential_name", "Personal FinnHub")

    if not user_id or not api_key:
        return JSONResponse(
            {"success": False, "error": "Missing user_id or api_key"},
            status_code=400
        )

    # validate the API key with a quick quote call
    try:
        resp = httpx.get(
            "https://finnhub.io/api/v1/quote",
            params={"symbol": "AAPL", "token": api_key},
            timeout=8
        )
        resp.raise_for_status()
    except httpx.HTTPStatusError:
        detail = resp.json().get("error", resp.text)
        return JSONResponse(
            {"success": False, "error": f"Validation failed: {detail}"},
            status_code=400
        )
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)

    # upsert into user_credentials
    cred_id = str(uuid.uuid4())
    up = supabase.table("user_credentials").upsert(
        {
            "id": cred_id,
            "user_id": user_id,
            "name": credential_name,
            "service_type": "finnhub_api",
            "client_json": {"api_key": api_key},
            "token_json": {}
        },
        on_conflict="user_id,name"
    ).execute()

    # if it already existed, grab the real id back
    if up.data and isinstance(up.data, list):
        cred_id = up.data[0].get("id", cred_id)

    return {"success": True, "credential_id": cred_id}


@router.get("/credentials")
def list_finnhub_credentials(user_id: str):
    """
    Called by your node’s credentialsApi to populate the credential_id select.
    Query-param: user_id
    Returns { success: True, credentials: [{ id, name }, …] }
    """
    try:
        resp = (
            supabase.table("user_credentials")
            .select("id, name")
            .eq("user_id", user_id)
            .eq("service_type", "finnhub_api")
            .execute()
        )
        return {"success": True, "credentials": resp.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@router.post("/get-quote")
async def get_quote(req: QuoteRequest):
    try:
        # 1. Get API key from Supabase (same as before)
        result = (
            supabase.table("user_credentials")
            .select("client_json")
            .eq("user_id", req.user_id)
            .eq("name", req.credential_id)
            .eq("service_type", "finnhub_api")
            .single()
            .execute()
        )
        api_key = result.data.get("client_json", {}).get("api_key")
        if not api_key:
            raise HTTPException(status_code=400, detail="API key not found.")

        # 2. Get quote from Finnhub
        res = httpx.get(
            "https://finnhub.io/api/v1/quote",
            params={"symbol": req.ticker, "token": api_key}
        )
        res.raise_for_status()
        return {"success": True, "data": res.json()}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
