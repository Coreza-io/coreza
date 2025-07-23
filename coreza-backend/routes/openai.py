# openai_auth.py

import uuid
from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse
from supabase import create_client
import requests

router = APIRouter(prefix="/openai", tags=["OpenAI"])

SUPABASE_URL = "https://tiitofotheupylvxivge.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXRvZm90aGV1cHlsdnhpdmdlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDkyNzI0MSwiZXhwIjoyMDY2NTAzMjQxfQ.azjdmYIYlqd9-CBTuHoPHux_PUs97Dk4jpP_2RX9_n8"
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# 1. Add/validate OpenAI credential
@router.post("/credentials")
def add_openai_credential(payload: dict = Body(...)):
    try:
        user_id = payload.get("user_id")
        api_key = payload.get("api_key")
        credential_name = payload.get("credential_name", "OpenAI Key")
        print("Sending OpenAI credential payload:", user_id, api_key, credential_name)
        if not user_id or not api_key:
            return JSONResponse({"success": False, "error": "Missing user_id or api_key"}, status_code=400)
        
        # Validate OpenAI key by making a quick test call
        headers = {"Authorization": f"Bearer {api_key}"}
        resp = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers=headers,
            json={"model": "gpt-3.5-turbo", "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1},
            timeout=8
        )
        if resp.status_code != 200:
            try:
                error_detail = resp.json().get("error", {}).get("message", "Invalid OpenAI API key")
            except Exception:
                error_detail = resp.text
            return JSONResponse({"success": False, "error": error_detail}, status_code=400)
        
        cred_id = str(uuid.uuid4())
        # Save in Supabase
        resp = supabase.table("user_credentials").upsert({
            "id": cred_id,
            "user_id": user_id,
            "name": credential_name,
            "service_type": "openai_api",
            "client_json": {"api_key": api_key},
            "token_json": {},
        }, on_conflict="user_id,name").execute()
        data = resp.data[0] if resp.data else None
        cred_id = data["id"] if data else cred_id

        return {"success": True, "credential_id": cred_id}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)

# 2. List OpenAI credentials for user
@router.get("/credentials")
def list_openai_credentials(user_id: str):
    try:
        resp = (
            supabase.table("user_credentials")
            .select("id, name")
            .eq("user_id", user_id)
            .eq("service_type", "openai_api")
            .execute()
        )
        return {"success": True, "credentials": resp.data}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)
