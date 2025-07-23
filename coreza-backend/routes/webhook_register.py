from fastapi import APIRouter
from pydantic import BaseModel
from fastapi.responses import PlainTextResponse, JSONResponse
import httpx

router = APIRouter()

VERIFY_TOKEN = "my_verify_token"

class WebhookRegisterRequest(BaseModel):
    clientId: str
    clientSecret: str
    accessToken: str
    callbackUrl: str

@router.options("/register-whatsapp-webhook")
async def options_webhook():
    print("✅ Inside register_webhook options")
    # This lets browsers do preflight CORS checks
    return PlainTextResponse("ok", status_code=200)

@router.post("/register-whatsapp-webhook")
async def register_webhook(data: WebhookRegisterRequest):
    print("✅ Inside register_webhook route")
    print("data.clientId", data.clientId)

    url = f"https://graph.facebook.com/v18.0/{data.clientId}/subscriptions"
    print("url:", url)
    payload = {
        "object": "whatsapp_business_account",
        "callback_url": data.callbackUrl,
        "fields": "messages",
        "verify_token": VERIFY_TOKEN,
        "access_token": data.accessToken
    }
    headers = {
        "Authorization": f"Bearer {data.accessToken}",
        "Content-Type": "application/json"
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(url, headers=headers, json=payload)
        print("🔴 Facebook API response:", response.status_code)
        print("🔍 Response text:", response.text)
        json_resp = response.json()
    return JSONResponse(content={
        "success": response.status_code in [200, 201],
        "details": json_resp
    })
