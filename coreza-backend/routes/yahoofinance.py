# routers/market_data_yahoo.py

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import yfinance as yf

router = APIRouter(prefix="/yahoofinance", tags=["YahooFinance"])

class MarketDataYFRequest(BaseModel):
    user_id: str
    ticker: str    # e.g. "AAPL"
    interval: str  # "1m","5m","15m","60m","1d"
    lookback: str  # number of most recent bars, coming in as string

@router.post("/get-candle")
def fetch_market_data_yf(req: MarketDataYFRequest):
    """
    Pulls OHLCV from Yahoo Finance via yfinance,
    parsing `lookback` from string to int, then returns the last `lookback` bars.
    """
    # 1) parse lookback
    print("req", req)
    try:
        lookback = int(req.lookback)
        if lookback <= 0:
            raise ValueError
    except ValueError:
        raise HTTPException(status_code=400, detail="`lookback` must be a positive integer string")

    # 2) determine how much history to fetch
    #    intraday intervals (< '1d') need at least 1d period
    period = "1d" if req.interval.endswith("m") else f"{lookback}d"

    # 3) fetch data
    try:
        df = yf.Ticker(req.ticker).history(
            period=period,
            interval=req.interval,
            back_adjust=False
        )
        if df.empty:
            raise HTTPException(status_code=404, detail="No data found for ticker/interval")
        # only keep last `lookback` rows
        df = df.tail(lookback)
    except HTTPException:
        # re-raise our HTTP errors
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching data: {e}")

    # 4) serialize and return in dict-of-arrays format (t = yyyy-mm-dd)
    candles = {
        "t": [ts.strftime("%Y-%m-%d") for ts in df.index],  # always yyyy-mm-dd
        "o": df["Open"].tolist(),
        "h": df["High"].tolist(),
        "l": df["Low"].tolist(),
        "c": df["Close"].tolist(),
        "v": df["Volume"].tolist(),
    }
    return {
        "success": True,
        "candles": candles
    }
