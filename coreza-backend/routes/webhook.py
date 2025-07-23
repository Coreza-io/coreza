from fastapi import APIRouter, Request, Query
from fastapi.responses import JSONResponse, Response, PlainTextResponse
from globals import webhook_store, websocket_connections, VERIFY_TOKEN
import json
import uuid

router = APIRouter()

@router.post("/generate-webhook")
async def generate_webhook():
    webhook_id = str(uuid.uuid4())
    webhook_store[webhook_id] = {"id": webhook_id, "active": True}
    return {"message": "Webhook generated", "webhook_url": f"/webhook/{webhook_id}"}

@router.get("/webhook/{webhook_id}")
async def verify_webhook(webhook_id: str, hub_mode: str = Query(..., alias="hub.mode"),
                         hub_verify_token: str = Query(..., alias="hub.verify_token"),
                         hub_challenge: str = Query(..., alias="hub.challenge")):
    if hub_verify_token == VERIFY_TOKEN:
        return Response(content=hub_challenge, media_type="text/plain")
    return Response(content="Invalid token", status_code=403)

@router.options("/webhook/{webhook_id}")
async def options_webhook(webhook_id: str):
    return PlainTextResponse("ok", status_code=200)

@router.post("/webhook/{webhook_id}")
async def receive_webhook(webhook_id: str, request: Request):
    if not webhook_id:
        return JSONResponse(status_code=404, content={"error": "Invalid or inactive webhook"})
    body = await request.json()
    print(f"📥 Received on /webhook/{webhook_id}:", body)
    try:
        message = body["entry"][0]["changes"][0]["value"]["messages"][0]
        sender = message["from"]
        text = message["text"]["body"]
        timestamp = message.get("timestamp", "")
        print(f"💬 From {sender}: {text}")
        await send_to_websocket(webhook_id, sender, text, timestamp)
    except Exception as e:
        print("⚠️ Error parsing message:", e)
    return {"status": "ok", "id": webhook_id}

async def send_to_websocket(webhook_id: str, sender: str, text: str, timestamp: str):
    ws = websocket_connections.get(webhook_id)
    if ws:
        try:
            await ws.send_text(json.dumps({
                "from": sender,
                "text": text,
                "timestamp": timestamp
            }))
            print(f"✅ Sent to WebSocket: {webhook_id}")
        except Exception as e:
            print(f"🚫 Error sending to websocket {webhook_id}: {e}")
    else:
        print(f"❌ No websocket connection found for webhook_id: {webhook_id}")
