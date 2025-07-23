from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Dict, Any, Optional, List

from function.dhan import (
    AuthRequest,
    auth_url_func,
    list_credentials_func,
    get_account_func,
    list_positions_func,
    list_orders_func,
    cancel_order_func,
    get_candle_func,
    CancelOrderRequest,
    GetCandleRequest
)

router = APIRouter(prefix="/dhan")

@router.post("/auth-url")
def auth_url(payload: AuthRequest = Body(...)) -> Dict[str, Any]:
    """Start OAuth flow or register API credentials for Dhan."""
    try:
        print("Dhan payload", payload)
        result = auth_url_func(payload)
        return result
    except HTTPException as e:
        raise e

@router.get("/credentials")
def list_credentials(user_id: str = Query(...)) -> Dict[str, Any]:
    """List saved Dhan credentials for the user."""
    try:
        creds = list_credentials_func(user_id)
        return {"success": True, "credentials": creds}
    except HTTPException as e:
        raise e

@router.get("/get_account")
def get_account(credential_id: str = Query(...)) -> Dict[str, Any]:
    """Fetch Dhan account information."""
    try:
        data = get_account_func({"credential_id": credential_id})
        return {"success": True, **data}
    except HTTPException as e:
        raise e

@router.get("/get_positions")
def get_positions(credential_id: str = Query(...)) -> Dict[str, Any]:
    """Fetch open positions from Dhan."""
    try:
        data = list_positions_func({"credential_id": credential_id})
        return {"success": True, **data}
    except HTTPException as e:
        raise e

@router.get("/get_orders")
def get_orders(credential_id: str = Query(...)) -> Dict[str, Any]:
    """Fetch current orders from Dhan."""
    try:
        data = list_orders_func({"credential_id": credential_id})
        return {"success": True, **data}
    except HTTPException as e:
        raise e

@router.post("/cancel_order")
def cancel_order(request: CancelOrderRequest = Body(...)) -> Dict[str, Any]:
    """Cancel an existing Dhan order."""
    try:
        payload = request.model_dump()
        data = cancel_order_func(payload)
        return {"success": True, **data}
    except HTTPException as e:
        raise e

@router.post("/get_candle")
def get_candle(request: GetCandleRequest = Body(...)) -> Dict[str, Any]:
    """Fetch historical bars from Dhan."""
    try:
        params = request.model_dump()
        data = get_candle_func(params)
        return data
    except HTTPException as e:
        raise e
