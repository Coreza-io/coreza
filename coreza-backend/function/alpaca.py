# === server/services/alpaca_service.py ===
import os
import uuid
import json
from typing import Optional, Dict, Any, List
from config.supabaseClient import create_client
from alpaca.trading.client import TradingClient
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.requests import StockBarsRequest
from alpaca.data.timeframe import TimeFrame, TimeFrameUnit
from alpaca.trading.requests import LimitOrderRequest, MarketOrderRequest
from alpaca.trading.enums import (
    AssetExchange,
    AssetStatus,
    OrderClass,
    OrderSide,
    OrderType,
    QueryOrderStatus,
    TimeInForce,
)
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from fastapi import HTTPException
from dotenv import load_dotenv
from pydantic import BaseModel

# Load environment variables
load_dotenv()

# Initialize Supabase client
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set as environment variables.")

ALPACA_PAPER_URL = os.getenv("ALPACA_PAPER_URL", "https://paper-api.alpaca.markets")
ALPACA_DATA_URL = os.getenv("ALPACA_DATA_URL", "https://data.alpaca.markets")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# --- Request models (can be reused by routes) ---
class AuthRequest(BaseModel):
    user_id: str
    api_key: str
    secret_key: str
    credential_name: Optional[str] = "Personal Alpaca"

class GetCandleRequest(BaseModel):
    user_id: str
    credential_id: str
    symbol: str
    interval: str
    lookback: str

class OrderRequest(BaseModel):
    user_id: str
    credential_id: str
    symbol: str
    side: str  # "buy" or "sell"
    qty: str
    type: str  # "market", "limit", etc.
    time_in_force: str  # "day", "gtc", etc.



# --- Helper to fetch credentials ---
def get_api_credentials(user_id: str, credential_id: str) -> Dict[str, str]:
    try:
        res = supabase.table("user_credentials") \
            .select("client_json") \
            .eq("user_id", user_id) \
            .eq("name", credential_id) \
            .eq("service_type", "alpaca") \
            .single() \
            .execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Supabase error: {e}")
    creds = res.data.get("client_json", {})
    api_key = creds.get("api_key")
    secret_key = creds.get("secret_key")
    if not api_key or not secret_key:
        raise HTTPException(status_code=400, detail="API credentials not found.")
    return {"api_key": api_key, "secret_key": secret_key}

# --- Business logic functions, all take a single dict (inputs) ---

def auth_url_func(inputs: dict) -> Dict[str, Any]:
    # Accepts dict with: user_id, api_key, secret_key, credential_name
    try:
        tc = TradingClient(inputs["api_key"], inputs["secret_key"], paper=True)
        tc.get_account()
    except Exception as e:
        return {"success": False, "error": f"Validation failed: {e}"}
    cred_id = str(uuid.uuid4())
    record = {
        "id": cred_id,
        "user_id": inputs["user_id"],
        "name": inputs.get("credential_name", "Personal Alpaca"),
        "service_type": "alpaca",
        "client_json": {"api_key": inputs["api_key"], "secret_key": inputs["secret_key"]}
    }
    upsert = supabase.table("user_credentials").upsert(record, on_conflict="user_id,name").execute()
    if not upsert.data:
        return {"success": False, "error": "No data returned from upsert"}
    return {"success": True, "credential_id": upsert.data[0].get("id", cred_id)}

def list_credentials_func(user_id: dict) -> List[Dict[str, Any]]:
    resp = supabase.table("user_credentials")\
        .select("id,name")\
        .eq("user_id", user_id)\
        .eq("service_type", "alpaca")\
        .execute()
    return resp.data

def get_account_func(inputs: dict) -> Dict[str, Any]:
    user_id = inputs["user_id"]
    credential_id = inputs["credential_id"]
    creds = get_api_credentials(user_id, credential_id)
    client = TradingClient(creds["api_key"], creds["secret_key"], paper=True)
    acct = client.get_account()
    return acct.dict()

def list_positions_func(inputs: dict) -> List[Dict[str, Any]]:
    user_id = inputs["user_id"]
    credential_id = inputs["credential_id"]
    creds = get_api_credentials(user_id, credential_id)
    client = TradingClient(creds["api_key"], creds["secret_key"], paper=True)
    positions = client.get_all_positions()
    return [p.dict() for p in positions]

def list_orders_func(inputs: dict) -> List[Dict[str, Any]]:
    user_id = inputs["user_id"]
    credential_id = inputs["credential_id"]
    creds = get_api_credentials(user_id, credential_id)
    client = TradingClient(creds["api_key"], creds["secret_key"], paper=True)
    orders = client.get_all_assets(status="all", limit=100)
    return [o.dict() for o in orders]

def place_order_func(inputs: dict) -> Dict[str, Any]:
    creds = get_api_credentials(inputs["user_id"], inputs["credential_id"])
    side = OrderSide(inputs["side"].lower())
    otype = OrderType(inputs["type"].lower())
    tif = TimeInForce(inputs["time_in_force"].lower())
    try:
        qty = float(inputs["qty"])
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid num value, must be a number.")
    client = TradingClient(creds["api_key"], creds["secret_key"], paper=True)
    ordReq = MarketOrderRequest(
        symbol=inputs["symbol"],
        qty=qty,
        side=side,
        type=otype,
        time_in_force=tif
    )
    order = client.submit_order(ordReq)
    return order.dict()

def cancel_order_func(inputs: dict) -> Dict[str, Any]:
    user_id = inputs["user_id"]
    credential_id = inputs["credential_id"]
    order_id = inputs["order_id"]
    creds = get_api_credentials(user_id, credential_id)
    client = TradingClient(creds["api_key"], creds["secret_key"], paper=True)
    client.cancel_order(order_id)
    return {"order_id": order_id, "status": "canceled"}

def get_candle_func(inputs: dict) -> Dict[str, Any]:
    user_id = inputs["user_id"]
    credential_id = inputs["credential_id"]
    symbol = inputs["symbol"]
    interval = inputs["interval"]
    lookback = inputs["lookback"]
    creds = get_api_credentials(user_id, credential_id)
    data_client = StockHistoricalDataClient(creds["api_key"], creds["secret_key"], url_override=ALPACA_DATA_URL)
    interval_map = {
        "1Min": (1, TimeFrameUnit.Minute),
        "5Min": (5, TimeFrameUnit.Minute),
        "15Min": (15, TimeFrameUnit.Minute),
        "1Hour": (1, TimeFrameUnit.Hour),
        "1Day": (1, TimeFrameUnit.Day),
    }
    cfg = interval_map.get(interval)
    if not cfg:
        raise HTTPException(status_code=400, detail=f"Invalid interval: {interval}")
    amount, unit = cfg
    tz = ZoneInfo("America/New_York")
    now = datetime.now(tz)
    start = now - timedelta(days=int(lookback))
    bar_request = StockBarsRequest(
        symbol_or_symbols=[symbol.upper()],
        timeframe=TimeFrame(amount=amount, unit=unit),
        start=start,
        limit=lookback
    )
    bars = data_client.get_stock_bars(bar_request)
    df = bars.df.reset_index()
    candles = []
    for _, row in df.iterrows():
        ts = row.get("timestamp") or row.get("t")
        if not isinstance(ts, str):
            try:
                ts = ts.isoformat()
            except Exception:
                ts = str(ts)
        candles.append({
            "t": ts,
            "o": row.get("open") or row.get("o"),
            "h": row.get("high") or row.get("h"),
            "l": row.get("low") or row.get("l"),
            "c": row.get("close") or row.get("c"),
            "v": row.get("volume") or row.get("v")
        })
    return {"symbol": symbol, "candles": candles}
