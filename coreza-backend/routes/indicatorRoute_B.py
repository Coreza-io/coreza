from fastapi import APIRouter, HTTPException, Body
from pydantic import BaseModel
from graphin_backend.function.indicator import ema_func, rsi_func

router = APIRouter(prefix="/indicators", tags=["Indicators"])

class IndicatorRequest(BaseModel):
    user_id: str
    candle_data: str
    window: int

@router.post("/ema")
def run_ema(req: IndicatorRequest = Body(...)):
    result = ema_func(req.model_dump())
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result

@router.post("/rsi")
def run_rsi(req: IndicatorRequest = Body(...)):
    result = rsi_func(req.model_dump())
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result

@router.post("/adx")
def run_adx(req: IndicatorRequest = Body(...)):
    result = adx_func(req.model_dump())
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result

@router.post("/bb")
def run_bb(req: IndicatorRequest = Body(...)):
    result = bb_func(req.model_dump())
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result

@router.post("/Ichimoku")
def run_Ichimoku(req: IndicatorRequest = Body(...)):
    result = Ichimoku_func(req.model_dump())
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result

@router.post("/macd")
def run_macd(req: IndicatorRequest = Body(...)):
    result = macd_func(req.model_dump())
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result

@router.post("/obv")
def run_obv(req: IndicatorRequest = Body(...)):
    result = obv_func(req.model_dump())
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result

@router.post("/stoch")
def run_stoch(req: IndicatorRequest = Body(...)):
    result = stoch_func(req.model_dump())
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result

@router.post("/vwap")
def run_vwap(req: IndicatorRequest = Body(...)):
    result = _func(req.model_dump())
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result
