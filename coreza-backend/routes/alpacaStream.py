import os
import uuid
import json
from typing import Optional, Dict, Any
from fastapi import APIRouter, Body, HTTPException, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from supabase import create_client
import websockets

# Initialize Supabase client (replace with env vars or config)
# Initialize Supabase client (replace with env vars or config)
SUPABASE_URL = "https://tiitofotheupylvxivge.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXRvZm90aGV1cHlsdnhpdmdlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDkyNzI0MSwiZXhwIjoyMDY2NTAzMjQxfQ.azjdmYIYlqd9-CBTuHoPHux_PUs97Dk4jpP_2RX9_n8"
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

router = APIRouter(prefix="/alpaca/stream", tags=["AlpacaStream"])

# Pydantic model for stream registration
class StreamRequest(BaseModel):
    user_id: str
    credential_id: str
    feed: str             # e.g. 'account_updates', 'trade_updates', 'bars', 'quotes', 'trades'
    symbols: Optional[str] = None  # comma-separated for market data feeds

@router.post("/register")
def register_stream(req: StreamRequest):
    """
    Registers a new Alpaca WebSocket stream subscription.
    Returns { success: True, subscription_id, stream_url, auth_message, subscribe_message }
    """
    # 1. Retrieve stored credentials
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

    # 2. Determine stream URL and subscribe message
    if req.feed in ["account_updates", "trade_updates"]:
        stream_url = os.getenv("ALPACA_STREAM_URL", "wss://api.alpaca.markets/stream")
        subscribe_msg = {"action": "listen", "streams": [req.feed]}
    else:
        # Market data streams
        stream_url = f"wss://stream.data.alpaca.markets/v2/{req.feed}"
        symbols_list = [s.strip() for s in req.symbols.split(",")] if req.symbols else []
        subscribe_msg = {"action": "subscribe", req.feed: symbols_list}

    auth_msg = {"action": "auth", "key": api_key, "secret": secret_key}

    # 3. Persist subscription metadata (optional)
    subscription_id = str(uuid.uuid4())
    try:
        supabase.table("user_streams").insert({
            "id": subscription_id,
            "user_id": req.user_id,
            "credential_id": req.credential_id,
            "feed": req.feed,
            "symbols": req.symbols or ""
        }).execute()
    except Exception:
        # ignore if table doesn't exist or fails
        pass

    return {
        "success": True,
        "subscription_id": subscription_id,
        "stream_url": stream_url,
        "auth_message": auth_msg,
        "subscribe_message": subscribe_msg
    }

@router.websocket("/ws/{subscription_id}")
async def stream_ws(websocket: WebSocket, subscription_id: str):
    """
    WebSocket proxy endpoint. Client connects here and receives streamed messages
    from Alpaca based on a prior registration.
    """
    await websocket.accept()

    # 1. Load subscription metadata
    try:
        sub = (
            supabase.table("user_streams")
            .select("stream_url, client_json, feed, symbols, auth_message, subscribe_message")
            .eq("id", subscription_id)
            .single()
            .execute()
        )
        meta = sub.data
    except Exception:
        await websocket.close(code=1008)
        return

    # Fallback if auth/subscribe messages not persisted
    api_key = meta.get("client_json", {}).get("api_key")
    secret_key = meta.get("client_json", {}).get("secret_key")
    feed = meta.get("feed")
    symbols = meta.get("symbols", "")
    if not all([api_key, secret_key, feed]):
        await websocket.close(code=1008)
        return

    # Reconstruct URL and messages if needed
    stream_url = meta.get("stream_url") or (
        "wss://api.alpaca.markets/stream" if feed in ["account_updates", "trade_updates"]
        else f"wss://stream.data.alpaca.markets/v2/{feed}"
    )
    auth_msg = {"action": "auth", "key": api_key, "secret": secret_key}
    if feed in ["account_updates", "trade_updates"]:
        subscribe_msg = {"action": "listen", "streams": [feed]}
    else:
        symbols_list = [s.strip() for s in symbols.split(",")] if symbols else []
        subscribe_msg = {"action": "subscribe", feed: symbols_list}

    # 2. Proxy WebSocket
    try:
        async with websockets.connect(stream_url) as alp_ws:
            await alp_ws.send(json.dumps(auth_msg))
            await alp_ws.send(json.dumps(subscribe_msg))
            while True:
                msg = await alp_ws.recv()
                await websocket.send_text(msg)
    except WebSocketDisconnect:
        pass
    except Exception:
        await websocket.close(code=1011)
