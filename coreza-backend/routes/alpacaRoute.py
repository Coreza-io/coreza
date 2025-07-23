# === server/api/routes/alpaca.py ===
import os
from fastapi import APIRouter, Body, HTTPException, Query, Path
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, Dict, Any
from dotenv import load_dotenv
from function.alpaca import (
    AuthRequest,
    GetCandleRequest,
    OrderRequest,
    auth_url_func,
    list_credentials_func,
    get_account_func,
    list_positions_func,
    list_orders_func,
    place_order_func,
    cancel_order_func,
    get_candle_func
)

load_dotenv()
router = APIRouter(prefix="/alpaca", tags=["Alpaca"])

@router.post("/auth_url")
def auth_url(payload: AuthRequest = Body(...)):
    result = auth_url_func(payload)
    if not result.get("success"):
        return JSONResponse(result, status_code=400)
    return result

@router.get("/credentials")
def list_credentials(user_id: str = Query(...)):
    try:
        print("user_id",user_id)
        creds = list_credentials_func(user_id)
        return {"success": True, "credentials": creds}
    except HTTPException as e:
        raise e

@router.get("/get_account")
def get_account(user_id: str = Query(...), credential_id: str = Query(...)):
    try:
        payload = {
            "user_id": user_id,
            "credential_id": credential_id
        }
        data = get_account_func(payload)
        return {"success": True, "data": data}
    except HTTPException as e:
        raise e

@router.get("/get_positions")
def list_positions(user_id: str = Query(...), credential_id: str = Query(...)):
    try:
        payload = {
            "user_id": user_id,
            "credential_id": credential_id
        }
        data = list_positions_func(payload)
        return {"success": True, "data": data}
    except HTTPException as e:
        raise e

@router.get("/get_orders")
def list_orders(user_id: str = Query(...), credential_id: str = Query(...)):
    try:
        payload = {
            "user_id": user_id,
            "credential_id": credential_id
        }
        data = list_orders_func(payload)
        return {"success": True, "data": data}
    except HTTPException as e:
        raise e

@router.post("/place_order")
def place_order(payload: OrderRequest = Body(...)):
    try:
        data = place_order_func(payload.model_dump())
        return {"success": True, "data": data}
    except HTTPException as e:
        raise e

@router.delete("/cancel_order")
def cancel_order(user_id: str = Query(...), credential_id: str = Query(...), order_id: str = Path(...)):
    try:
        payload = {
            "user_id": user_id,
            "credential_id": credential_id,
            "order_id": order_id
        }
        data = cancel_order_func(payload)
        return {"success": True, **data}
    except HTTPException as e:
        raise e

@router.post("/get_candle")
def get_candle(payload: GetCandleRequest = Body(...)):
    try:
        data = get_candle_func(payload.model_dump())
        return data
    except HTTPException as e:
        raise e