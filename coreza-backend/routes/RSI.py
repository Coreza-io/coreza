from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import pandas as pd
import json
import talib
import numpy as np
from datetime import datetime

router = APIRouter(prefix="/execute", tags=["RSI"])

class RSIRequest(BaseModel):
    user_id: str
    candle_data: str
    window: str

def convert_t_to_date_str(t):
    # Handles int/float (unix ts) or string
    if isinstance(t, (int, float)):
        return datetime.utcfromtimestamp(t).strftime("%Y-%m-%d")
    if isinstance(t, str):
        if len(t) >= 10 and t[4] == '-' and t[7] == '-':
            return t[:10]  # already yyyy-mm-dd or longer ISO
        try:
            # Try as unix timestamp in string
            return datetime.utcfromtimestamp(int(t)).strftime("%Y-%m-%d")
        except:
            return t
    return t

# Converts list-of-objects to dict-of-arrays with t as yyyy-mm-dd
def to_dict_of_arrays(bars):
    result = {k: [] for k in ["t", "o", "h", "l", "c", "v"]}
    for bar in bars:
        t = bar.get("timestamp") or bar.get("t")
        t = convert_t_to_date_str(t)
        result["t"].append(t)
        result["o"].append(bar.get("open") or bar.get("o"))
        result["h"].append(bar.get("high") or bar.get("h"))
        result["l"].append(bar.get("low") or bar.get("l"))
        result["c"].append(bar.get("close") or bar.get("c"))
        result["v"].append(bar.get("volume") or bar.get("v"))
    return result

@router.post("/rsi")
def rsi_node(req: RSIRequest):
    try:
        window = int(req.window)
    except ValueError:
        raise HTTPException(400, "Window must be an integer")

    try:
        data = json.loads(req.candle_data)
    except Exception:
        raise HTTPException(400, "candle_data must be valid JSON string")

    # Handle dict-of-arrays OR list-of-objects input
    if isinstance(data, dict):
        t_dates = [convert_t_to_date_str(t) for t in data.get("t", [])]
        try:
            df = pd.DataFrame({
                "t": t_dates,
                "o": data["o"],
                "h": data["h"],
                "l": data["l"],
                "c": data["c"],
                "v": data["v"]
            })
        except Exception:
            raise HTTPException(400, "candle_data JSON must have t,o,h,l,c,v arrays")
        candles_out = {
            "t": df["t"].tolist(),
            "o": df["o"].tolist(),
            "h": df["h"].tolist(),
            "l": df["l"].tolist(),
            "c": df["c"].tolist(),
            "v": df["v"].tolist(),
        }
    elif isinstance(data, list):
        # Convert list-of-objects to dict-of-arrays (with t as yyyy-mm-dd)
        candles_out = to_dict_of_arrays(data)
        try:
            df = pd.DataFrame(candles_out)
        except Exception:
            raise HTTPException(400, "candle_data array objects must have t,o,h,l,c,v keys")
    else:
        raise HTTPException(400, "Unsupported candle_data format")

    # Calculate RSI using TA-Lib
    df["rsi"] = talib.RSI(df["c"], timeperiod=window)
    # Replace NaN/inf with None for JSON safety
    df["rsi"] = df["rsi"].replace({np.nan: None, np.inf: None, -np.inf: None})

    # Output as array of {t, value}, always t=yyyy-mm-dd
    rsi_values = [
        {"t": row["t"], "value": row["rsi"]}
        for _, row in df.iterrows()
    ]

    return {
        "indicator": rsi_values,
        "candles": candles_out
    }
