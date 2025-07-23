import os
import uuid
from typing import Optional, Dict, Any
from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import JSONResponse
from supabase import create_client
import httpx
from pydantic import BaseModel

# Initialize Supabase client (replace with env vars or config)
SUPABASE_URL = "https://tiitofotheupylvxivge.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXRvZm90aGV1cHlsdnhpdmdlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDkyNzI0MSwiZXhwIjoyMDY2NTAzMjQxfQ.azjdmYIYlqd9-CBTuHoPHux_PUs97Dk4jpP_2RX9_n8"
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

router = APIRouter(prefix="/alpaca", tags=["Alpaca"])

# Pydantic model for REST proxy requests
class RestRequest(BaseModel):
    user_id: str
    credential_id: str
    endpoint: str
    params: Optional[Dict[str, Any]] = None

@router.post("/auth_url")
def add_alpaca_credential(payload: Dict[str, Any] = Body(...)):
    """
    Expects JSON body { user_id, api_key, secret_key, credential_name? } per your authFields.
    Validates the keys by hitting Alpaca’s /account endpoint, then upserts into Supabase.
    Returns { success: bool, credential_id: str }.
    """
    print("payload", payload)
    user_id = payload.get("user_id")
    api_key = payload.get("api_key")
    credential_name = payload.get("credential_name", "Personal Alpaca")

    if not user_id or not api_key:
        return JSONResponse(
            {"success": False, "error": "Missing user_id, api_key"},
            status_code=400
        )

    # Validate the API credentials by fetching account info
    try:
        resp = httpx.get(
            "https://paper-api.alpaca.markets/v2",
            params={"symbol": "AAPL", "token": api_key},
            timeout=8
        )
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.json().get("message", exc.response.text)
        return JSONResponse(
            {"success": False, "error": f"Validation failed: {detail}"},
            status_code=400
        )
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)

    # Upsert credential into Supabase
    cred_id = str(uuid.uuid4())
    upsert = supabase.table("user_credentials").upsert(
        {
            "id": cred_id,
            "user_id": user_id,
            "name": credential_name,
            "service_type": "alpaca",
            "token_json": {}
        },
        on_conflict="user_id,name"
    ).execute()

    # If an existing record was returned, update cred_id
    if upsert.data and isinstance(upsert.data, list) and len(upsert.data) > 0:
        cred_id = upsert.data[0].get("id", cred_id)

    return {"success": True, "credential_id": cred_id}

@router.get("/credentials")
def list_alpaca_credentials(user_id: str = Query(...)):
    """
    Returns stored Alpaca credentials for a given user.
    Query-param: user_id
    Returns { success: True, credentials: [{ id, name }, …] }
    """
    try:
        resp = (
            supabase.table("user_credentials")
            .select("id, name")
            .eq("user_id", user_id)
            .eq("service_type", "alpaca")
            .execute()
        )
        return {"success": True, "credentials": resp.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/rest")
async def alpaca_rest(req: RestRequest):
    """
    Proxies Alpaca REST API requests.
    Expects POST { user_id, credential_id, endpoint, params? }.
    Returns { success: True, data: ... } or HTTP error.
    """
    # Retrieve stored credentials
    try:
        result = (
            supabase.table("user_credentials")
            .select("client_json")
            .eq("user_id", req.user_id)
            .eq("id", req.credential_id)
            .eq("service_type", "alpaca")
            .single()
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    creds = result.data.get("client_json", {})
    api_key = creds.get("api_key")
    secret_key = creds.get("secret_key")
    if not api_key or not secret_key:
        raise HTTPException(status_code=400, detail="API credentials not found.")

    # Build request to Alpaca
    url = req.endpoint if req.endpoint.startswith("http") else f"https://api.alpaca.markets{req.endpoint}"
    headers = {
        "APCA-API-KEY-ID": api_key,
        "APCA-API-SECRET-KEY": secret_key
    }

    try:
        resp = httpx.get(
            url,
            headers=headers,
            params=req.params or {},
            timeout=10
        )
        resp.raise_for_status()
        return {"success": True, "data": resp.json()}
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        detail = exc.response.text
        raise HTTPException(status_code=status, detail=detail)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
