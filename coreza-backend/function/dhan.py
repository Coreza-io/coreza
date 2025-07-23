import os
import uuid
from typing import Any, Dict, List, Tuple
from datetime import datetime, timedelta, timezone
import csv
from functools import lru_cache

from dotenv import load_dotenv
from config.supabaseClient import create_client
import httpx
from fastapi import HTTPException, status
from pydantic import BaseModel

# Load environment variables
load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set as environment variables.")

# Initialize Supabase client
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Base URL and Scrip-Master URL for Dhan API
BASE_URL = "https://sandbox.dhan.co/v2"
SCRIP_MASTER_URL = "https://images.dhan.co/api-data/api-scrip-master-detailed.csv"

# --- Request models ---
class AuthRequest(BaseModel):
    user_id: str
    credential_name: str
    client_id: str
    api_key: str

class CancelOrderRequest(BaseModel):
    user_id: str
    credential_id: str
    order_id: str

class GetCandleRequest(BaseModel):
    user_id: str
    credential_id: str
    exchange: str
    symbol: str
    interval: str  # '1Min', '5Min', '15Min', '1Hour', '1Day'
    lookback: int

# --- Helper to fetch credentials ---
def get_api_credentials(user_id: str, credential_id: str) -> Dict[str, str]:
    try:
        res = supabase.table("user_credentials") \
            .select("client_json") \
            .eq("user_id", user_id) \
            .eq("name", credential_id) \
            .eq("service_type", "dhan") \
            .single() \
            .execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Supabase error: {e}")
    creds = res.data.get("client_json", {})
    client_id = creds.get("client_id")
    api_key = creds.get("api_key")
    if not client_id or not api_key:
        raise HTTPException(status_code=400, detail="API credentials not found.")
    return {"client_id": client_id, "api_key": api_key}

# --- Load and lookup Scrip-Master CSV ---
@lru_cache(maxsize=1)
def load_scrip_master() -> Dict[Tuple[str, str], str]:
    resp = httpx.get(SCRIP_MASTER_URL, timeout=30)
    try:
        resp.raise_for_status()
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Failed to load scrip master: {e}")
    reader = csv.DictReader(resp.text.splitlines())
    master: Dict[Tuple[str, str], str] = {}
    for row in reader:
        seg = row.get("EXCH_ID")  # e.g., 'NSE_EQ'
        sym = row.get("UNDERLYING_SYMBOL")  # human-friendly symbol
        secid = row.get("SECURITY_ID")  # numeric ID
        if seg and sym and secid:
            master[(seg, sym.upper())] = secid
    return master


def lookup_security_id(symbol: str, exchange_segment: str) -> str:
    master = load_scrip_master()
    key = (exchange_segment, symbol.upper())
    try:
        return master[key]
    except KeyError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Security ID not found for symbol {symbol} on segment {exchange_segment}"
        )

# --- Service-layer functions ---
def auth_url_func(request: AuthRequest) -> Dict[str, Any]:
    headers = {"access-token": request.api_key, "Accept": "application/json"}
    try:
        resp = httpx.get(f"{BASE_URL}/user/profile", headers=headers, timeout=10)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Network error: {exc}")
    if resp.status_code != 200:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Validation failed: " + resp.text)
    cred_id = str(uuid.uuid4())
    record = {
        "id": cred_id,
        "user_id": request.user_id,
        "name": request.credential_name,
        "service_type": "dhan",
        "client_json": {"client_id": request.client_id, "api_key": request.api_key}
    }
    upsert = supabase.table("user_credentials").upsert(record, on_conflict="user_id,name").execute()
    if not upsert.data:
        raise HTTPException(status_code=500, detail="Failed to store credentials.")
    return {"success": True, "credential_id": upsert.data[0].get("id", cred_id)}

def list_credentials_func(user_id: str) -> List[Dict[str, Any]]:
    resp = supabase.table("user_credentials")\
        .select("id,name")\
        .eq("user_id", user_id)\
        .eq("service_type", "dhan")\
        .execute()
    return resp.data

def get_account_func(params: Dict[str, Any]) -> Dict[str, Any]:
    user_id = params.get("user_id")
    credential_id = params.get("credential_id")
    creds = get_api_credentials(user_id, credential_id)
    headers = {"access-token": creds["api_key"], "Accept": "application/json"}
    resp = httpx.get(f"{BASE_URL}/orders/account", headers=headers, timeout=10)
    if resp.status_code != 200:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Dhan API error: " + resp.text)
    return resp.json()

def list_positions_func(params: Dict[str, Any]) -> Dict[str, Any]:
    user_id = params.get("user_id")
    credential_id = params.get("credential_id")
    creds = get_api_credentials(user_id, credential_id)
    headers = {"access-token": creds["api_key"], "Accept": "application/json"}
    resp = httpx.get(f"{BASE_URL}/orders/holdings", headers=headers, timeout=10)
    if resp.status_code != 200:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Dhan API error: " + resp.text)
    return resp.json()

def list_orders_func(params: Dict[str, Any]) -> Dict[str, Any]:
    user_id = params.get("user_id")
    credential_id = params.get("credential_id")
    creds = get_api_credentials(user_id, credential_id)
    headers = {"access-token": creds["api_key"], "Accept": "application/json"}
    resp = httpx.get(f"{BASE_URL}/order", headers=headers, timeout=10)
    if resp.status_code != 200:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Dhan API error: " + resp.text)
    return resp.json()

def cancel_order_func(request: CancelOrderRequest) -> Dict[str, Any]:
    creds = get_api_credentials(request.user_id, request.credential_id)
    headers = {"access-token": creds["api_key"], "Accept": "application/json"}
    payload = {"orderId": request.order_id}
    resp = httpx.post(f"{BASE_URL}/order/cancel", headers=headers, json=payload, timeout=10)
    if resp.status_code != 200:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Dhan API error: " + resp.text)
    return resp.json()

def get_candle_func(request: GetCandleRequest) -> Dict[str, Any]:
    """
    Fetch historical or intraday bar data from Dhan API using the proper securityId.
    Formats the returned bars into a standardized candle list.
    """
    # Extract and validate parameters
    user_id = request["user_id"]
    exchange = request["exchange"]
    credential_id = request["credential_id"]
    symbol = request["symbol"]
    interval = request["interval"]
    lookback = request["lookback"]

    if not all([user_id, credential_id, exchange, symbol, interval, lookback]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing parameters for get_candle")

    # Retrieve API credentials and prepare headers
    creds = get_api_credentials(user_id, credential_id)
    api_key = creds["api_key"]
    headers = {
        "access-token": api_key,
        "Accept": "application/json",
        "Content-Type": "application/json"
    }
    today = datetime.now(timezone.utc).date()

    # Map symbol to security ID
    security_id = lookup_security_id(symbol, exchange.split("_")[0])

    # Build payload
    endpoint = f"{BASE_URL}/charts/historical" if interval == "1Day" else f"{BASE_URL}/charts/intraday"
    payload: Dict[str, Any] = {
        "securityId": security_id,
        "exchangeSegment": exchange,
        "instrument": "EQUITY",
        "expiryCode": 0,
        "oi": False
    }
    if interval == "1Day":
        payload.update({
            "fromDate": (today - timedelta(days=lookback)).strftime("%Y-%m-%d"),
            "toDate": today.strftime("%Y-%m-%d")
        })

    # Fetch data
    try:
        resp = httpx.post(endpoint, headers=headers, json=payload, timeout=10)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Network error: {exc}")

    if resp.status_code != 200:
        try:
            err = resp.json()
            detail_msg = err.get("errorMessage") or resp.text
        except Exception:
            detail_msg = resp.text
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Dhan API error: " + detail_msg)

    result = resp.json()
    # Handle bars returned as dict of lists (open, high, low, close, volume, timestamp)
    bars = result.get("data", result)
    if isinstance(bars, dict) and isinstance(bars.get("open"), list):
        length = len(bars.get("open"))
        reconstructed: List[Dict[str, Any]] = []
        for i in range(length):
            reconstructed.append({
                "timestamp": bars.get("timestamp")[i],
                "open": bars.get("open")[i],
                "high": bars.get("high")[i],
                "low": bars.get("low")[i],
                "close": bars.get("close")[i],
                "volume": bars.get("volume")[i]
            })
        bars = reconstructed
    # Trim to lookback if needed
    if interval != "1Day" and isinstance(bars, list):
        bars = bars[-lookback:]
    if interval != "1Day" and isinstance(bars, list):
        bars = bars[-lookback:]

    # Transform bars into candle dicts matching Alpaca format
    candles: List[Dict[str, Any]] = []
    for bar in bars:
        # Skip invalid entries
        if not isinstance(bar, dict):
            continue
        # Extract timestamp
        ts = bar.get("timestamp") or bar.get("t") or bar.get("T")
        if not isinstance(ts, str) and hasattr(ts, "isoformat"):
            try:
                ts = ts.isoformat()
            except Exception:
                ts = str(ts)
        # Extract OHLCV values
        o = bar.get("open") or bar.get("o") or bar.get("O")
        h = bar.get("high") or bar.get("h") or bar.get("H")
        l = bar.get("low") or bar.get("l") or bar.get("L")
        c = bar.get("close") or bar.get("c") or bar.get("C")
        v = bar.get("volume") or bar.get("v") or bar.get("V")
        candles.append({"t": ts, "o": o, "h": h, "l": l, "c": c, "v": v})

    return {"symbol": symbol, "candles": candles}
