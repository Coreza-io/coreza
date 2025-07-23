# routes/whatsapp_trigger.py
from fastapi import APIRouter, Request, Header, Query
from fastapi.responses import JSONResponse, Response

VERIFY_TOKEN = "my_verify_token"
router = APIRouter()

@router.get("/webhook/{webhook_id}")
async def verify_fb(
    webhook_id: str,
    hub_mode: str = Query(..., alias="hub.mode"),
    hub_token: str = Query(..., alias="hub.verify_token"),
    hub_challenge: str = Query(..., alias="hub.challenge")
):
    if hub_mode == "subscribe" and hub_token == VERIFY_TOKEN:
        return Response(content=hub_challenge)
    return Response(status_code=403)
