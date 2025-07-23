from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import pandas as pd
import json

router = APIRouter(prefix="/execute", tags=["MovingAverageCross"])

class MACrossoverRequest(BaseModel):
    user_id: str
    candle_data: str               # comes from Yahoo node
    short_window: str
    long_window: str

@router.post("/ma_crossover")
def ma_crossover(req: MACrossoverRequest):
    print("RAW candle_data:", repr(req.candle_data))
    try:
        short_w = int(req.short_window)
        long_w  = int(req.long_window)
    except ValueError:
        raise HTTPException(400, "Windows must be integers")

    try:
        data = json.loads(req.candle_data)
    except Exception:
        raise HTTPException(400, "candle_data must be valid JSON string")

    try:
        df = pd.DataFrame({
            "t": data["t"],
            "o": data["o"],
            "h": data["h"],
            "l": data["l"],
            "c": data["c"],
            "v": data["v"]
        })
    except Exception:
        raise HTTPException(400, "candle_data JSON must have t,o,h,l,c,v arrays")

    df["ma_s"] = df["c"].rolling(short_w).mean()
    df["ma_l"] = df["c"].rolling(long_w).mean()
    signals = []
    prev = None
    for _, row in df.iterrows():
        diff = row["ma_s"] - row["ma_l"]
        if prev is not None:
            if prev <= 0 < diff:
                signals.append({"timestamp": int(row["t"]), "signal": "buy"})
            if prev >= 0 > diff:
                signals.append({"timestamp": int(row["t"]), "signal": "sell"})
        prev = diff

    # **ADD the original candles to output!**
    return {
        "success": True,
        "signals": signals,
        "candles": data   # <--- This lets Visualize node always get candles
    }
