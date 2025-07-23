import asyncio
from typing import Dict, Any
from datetime import datetime, time, timedelta
import pytz

# Caching (optional)
# from functools import lru_cache

# Duration (milliseconds) for caching, if using an external cache layer
CACHE_DURATION = {
    "stocks": 60_000,       # 1 minute
    "crypto": 30_000,       # 30 seconds
    "forex": 60_000,        # 1 minute
    "commodities": 300_000, # 5 minutes
    "bonds": 300_000        # 5 minutes
}

async def market_info_func(market_type: str, exchange: str, timezone: str) -> Dict[str, Any]:
    """
    Dispatch to the appropriate market data fetcher based on market_type.

    Returns a dict containing all keys: status, hours, next_event, holidays, session_type.
    """
    dispatch_map = {
        "stocks": get_stock_market_data,
        "crypto": get_crypto_market_data,
        "forex": get_forex_market_data,
        "commodities": get_commodity_market_data,
        "bonds": get_bond_market_data
    }

    fn = dispatch_map.get(market_type)
    if not fn:
        raise ValueError(f"Unsupported market_type: {market_type}")

    # Call the underlying function and return its result
    return await fn(exchange, timezone)

async def get_stock_market_data(exchange: str, timezone: str) -> Dict[str, Any]:
    """
    Fetch market hours, status, next event, holidays, and session type for stock exchanges.
    Placeholder implementation -- integrate with IEX Cloud, Alpha Vantage, or Polygon.
    """
    tz = pytz.timezone(timezone)
    now = datetime.now(tz)

    # Placeholder static schedule (NY regular hours)
    hours = {
        "regular_hours": {"open": "09:30:00", "close": "16:00:00"},
        "extended_hours": {
            "pre_market": {"open": "04:00:00", "close": "09:30:00"},
            "after_market": {"open": "16:00:00", "close": "20:00:00"}
        }
    }

    open_time = tz.localize(datetime.combine(now.date(), time.fromisoformat(hours["regular_hours"]["open"])))
    close_time = tz.localize(datetime.combine(now.date(), time.fromisoformat(hours["regular_hours"]["close"])))
    is_open = open_time <= now < close_time

    status = {
        "is_open": is_open,
        "current_status": "open" if is_open else "closed",
        "last_updated": now.isoformat()
    }

    # Next event (open or close)
    if is_open:
        next_event = {"type": "close", "time": close_time.isoformat(),
                      "countdown_minutes": int((close_time - now).total_seconds() // 60)}
    else:
        # If before open, next open
        if now < open_time:
            next_event = {"type": "open", "time": open_time.isoformat(),
                          "countdown_minutes": int((open_time - now).total_seconds() // 60)}
        else:
            # After close, next open is tomorrow
            tomorrow = now.date() + timedelta(days=1)
            next_open = tz.localize(datetime.combine(tomorrow, time.fromisoformat(hours["regular_hours"]["open"])))
            next_event = {"type": "open", "time": next_open.isoformat(),
                          "countdown_minutes": int((next_open - now).total_seconds() // 60)}

    # Placeholder holiday list
    holidays = [
        {"name": "New Year's Day", "date": f"{now.year}-01-01", "market_closed": True}
    ]

    session_type = "regular"

    return {"status": status, "hours": hours, "next_event": next_event,
            "holidays": holidays, "session_type": session_type}

async def get_crypto_market_data(exchange: str, timezone: str) -> Dict[str, Any]:
    """
    Crypto markets trade 24/7. Placeholder logic:
    """
    tz = pytz.timezone(timezone)
    now = datetime.now(tz)
    # Always open with rolling 24h session
    status = {"is_open": True, "current_status": "open", "last_updated": now.isoformat()}
    hours = {
        "regular_hours": {"open": "00:00:00", "close": "23:59:59"},
        "extended_hours": {}
    }
    next_event = {"type": "none", "time": now.isoformat(), "countdown_minutes": 0}
    holidays = []
    session_type = "continuous"
    return {"status": status, "hours": hours, "next_event": next_event,
            "holidays": holidays, "session_type": session_type}

async def get_forex_market_data(exchange: str, timezone: str) -> Dict[str, Any]:
    """
    Forex hours vary by region. Placeholder 24h schedule Mon-Fri.
    """
    tz = pytz.timezone(timezone)
    now = datetime.now(tz)
    status = {"is_open": now.weekday() < 5, "current_status": "open" if now.weekday() < 5 else "closed",
              "last_updated": now.isoformat()}
    hours = {"regular_hours": {"open": "00:00:00", "close": "23:59:59"}, "extended_hours": {}}
    next_event = {"type": "none", "time": now.isoformat(), "countdown_minutes": 0}
    holidays = []
    session_type = "continuous"
    return {"status": status, "hours": hours, "next_event": next_event,
            "holidays": holidays, "session_type": session_type}

async def get_commodity_market_data(exchange: str, timezone: str) -> Dict[str, Any]:
    """
    Commodity exchanges have specific hours. Placeholder implementation.
    """
    return await get_stock_market_data(exchange, timezone)  # Fallback to stock-like schedule

async def get_bond_market_data(exchange: str, timezone: str) -> Dict[str, Any]:
    """
    Bond markets similar to stocks. Placeholder implementation.
    """
    return await get_stock_market_data(exchange, timezone)
