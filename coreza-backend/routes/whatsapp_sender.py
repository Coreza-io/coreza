from fastapi import APIRouter
from pydantic import BaseModel
import httpx

router = APIRouter()

class WhatsAppSendRequest(BaseModel):
    phoneNumber: str
    apiToken: str
    message: str

@router.post("/api/send-whatsapp")
async def send_whatsapp(data: WhatsAppSendRequest):
    headers = {
        "Authorization": f"Bearer {data.apiToken}",
        "Content-Type": "application/json"
    }

    payload = {
        "messaging_product": "whatsapp",
        "to": data.phoneNumber,
        "type": "text",
        "text": {"body": data.message}
    }

    url = "https://graph.facebook.com/v18.0/919650181997/messages"

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(url, headers=headers, json=payload)
            return {
                "success": response.status_code in [200, 201],
                "response": await response.json()
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
