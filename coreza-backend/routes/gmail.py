import uuid
from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.responses import JSONResponse
import google.oauth2.credentials
import google_auth_oauthlib.flow
import googleapiclient.discovery
from supabase import create_client

router = APIRouter(prefix="/gmail", tags=["Gmail"])

SUPABASE_URL = "https://tiitofotheupylvxivge.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXRvZm90aGV1cHlsdnhpdmdlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDkyNzI0MSwiZXhwIjoyMDY2NTAzMjQxfQ.azjdmYIYlqd9-CBTuHoPHux_PUs97Dk4jpP_2RX9_n8"
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid"
]

# 1. Generate OAuth URL and upsert config in Supabase
@router.post("/auth-url")
def gmail_auth_url(payload: dict = Body(...)):
    try:
        user_id = payload.get("user_id")
        client_id = payload.get("client_id")
        client_secret = payload.get("client_secret")
        redirect_uri = payload.get("redirect_uri")
        credential_name = payload.get("credential_name", "Gmail OAuth")
        print("Payload received:", payload)

        if not all([user_id, client_id, client_secret, redirect_uri]):
            return JSONResponse({"success": False, "error": "Missing OAuth app settings"}, status_code=400)

        cred_id = str(uuid.uuid4())
        client_json = {
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
        }

        resp = supabase.table("user_credentials").upsert({
            "id": cred_id,
            "user_id": user_id,
            "name": credential_name,
            "service_type": "gmail_oauth",
            "client_json": client_json,
            "token_json": {},
        }, on_conflict="user_id,name").execute()
        data = resp.data[0] if resp.data else None
        cred_id = data['id'] if data else cred_id

        flow = google_auth_oauthlib.flow.Flow.from_client_config(
            {
                "web": {
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [redirect_uri],
                }
            },
            scopes=SCOPES,
        )
        flow.redirect_uri = redirect_uri
        auth_url, _ = flow.authorization_url(
            access_type="offline", include_granted_scopes="true", state=cred_id
        )
        return {"success": True, "url": auth_url, "credential_id": cred_id}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)

# 2. OAuth callback – exchange code for tokens & save them
@router.get("/oauth2callback")
def gmail_oauth2callback(request: Request):
    try:
        code = request.query_params.get("code")
        cred_id = request.query_params.get("state")
        if not code or not cred_id:
            return JSONResponse({"success": False, "error": "Missing code or state"}, status_code=400)

        row = supabase.table("user_credentials").select("*").eq("id", cred_id).single().execute().data
        if not row:
            return JSONResponse({"success": False, "error": "Credential not found"}, status_code=404)

        cfg = row["client_json"]
        flow = google_auth_oauthlib.flow.Flow.from_client_config(
            {
                "web": {
                    "client_id": cfg["client_id"],
                    "client_secret": cfg["client_secret"],
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [cfg["redirect_uri"]],
                }
            },
            scopes=SCOPES,
        )
        flow.redirect_uri = cfg["redirect_uri"]
        flow.fetch_token(code=code)
        tokens = {
            "access_token": flow.credentials.token,
            "refresh_token": getattr(flow.credentials, "refresh_token", ""),
            "token_uri": flow.credentials.token_uri,
            "expiry": flow.credentials.expiry.isoformat() if flow.credentials.expiry else None,
        }

        supabase.table("user_credentials").update({
            "token_json": tokens,
            "scopes": ",".join(flow.credentials.scopes),
        }).eq("id", cred_id).execute()

        gmail = googleapiclient.discovery.build("gmail", "v1", credentials=flow.credentials)
        profile = gmail.users().getProfile(userId="me").execute()
        email = profile["emailAddress"]

        return JSONResponse({"success": True, "email": email, "credential_id": cred_id})
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)

# 3. List Gmail creds for user
@router.get("/credentials")
def list_gmail_credentials(user_id: str):
    try:
        resp = (
            supabase.table("user_credentials")
            .select("id,name,scopes")
            .eq("user_id", user_id)
            .eq("service_type", "gmail_oauth")
            .execute()
        )
        return {"success": True, "credentials": resp.data}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)

# 4. Send email
@router.post("/send")
def send_email(payload: dict = Body(...)):
    try:
        print("payload",payload)
        user_id = payload.get("user_id")
        cid = payload.get("credential_id")
        to = payload.get("to")
        subject = payload.get("subject")
        body_text = payload.get("message")
        if not all([cid, to, subject, body_text]):
            return JSONResponse({"success": False, "error": "Missing fields"}, status_code=400)

        row = (
            supabase.table("user_credentials")
            .select("*")
            .eq("user_id", user_id)
            .eq("name", cid)
            .single()
            .execute()
            .data
        )
        if not row:
            return JSONResponse({"success": False, "error": "Credential not found"}, status_code=404)

        cfg = row["client_json"]
        tok = row["token_json"]

        print("cfg", cfg)
        print("tok", tok)

        google_creds = google.oauth2.credentials.Credentials(
            token=tok["access_token"],
            refresh_token=tok.get("refresh_token"),
            token_uri=tok["token_uri"],
            client_id=cfg["client_id"],
            client_secret=cfg["client_secret"],
            scopes=row["scopes"].split(",") if row.get("scopes") else None,
        )
        gmail = googleapiclient.discovery.build("gmail", "v1", credentials=google_creds)

        from email.mime.text import MIMEText
        import base64

        msg = MIMEText(body_text, "plain")
        msg["to"] = to
        msg["subject"] = subject
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()

        sent = gmail.users().messages().send(userId="me", body={"raw": raw}).execute()
        return {"success": True, "message_id": sent["id"]}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)
