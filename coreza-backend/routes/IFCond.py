from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any
import operator
import re

# Router for IF node evaluation
router = APIRouter(prefix="/execute", tags=["IF"])

# Supported operators mapping\TOP_MAP = {
OP_MAP = {
    "===": operator.eq,
    "==":  operator.eq,
    "!==": operator.ne,
    "!=":  operator.ne,
    ">":   operator.gt,
    "<":   operator.lt,
    ">=":  operator.ge,
    "<=":  operator.le,
}

class Condition(BaseModel):
    left: str
    operator: str
    right: str

class IFRequest(BaseModel):
    conditions: List[Condition]
    logicalOp: str  # "AND" or "OR"
    inputData: Dict[str, Any]

@router.post("/if")
def if_node(req: IFRequest) -> Dict[str, bool]:
    """
    Evaluate a series of comparisons (conditions) against inputData.
    Returns a dict with keys 'true' and 'false' indicating which branch passed.
    """
    print("req", req)
    # Validate logical operator
    logic = req.logicalOp.upper()
    if logic not in ("AND", "OR"):
        raise HTTPException(status_code=400, detail="logicalOp must be 'AND' or 'OR'")

    # Validate operator keys
    for cond in req.conditions:
        if cond.operator not in OP_MAP:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported operator: {cond.operator}"
            )

    def resolve(expr: str) -> Any:
        """
        Resolve an expression string against inputData.
        Supports placeholders like '{{ $json.key.subkey }}' or literals.
        """
        expr = expr.strip()
        # Placeholder pattern
        m = re.fullmatch(r"{{\s*\$json\.([\w\.]+)\s*}}", expr)
        if m:
            path = m.group(1).split('.')
            data = req.inputData
            try:
                for p in path:
                    data = data[p]
                return data
            except Exception:
                raise HTTPException(
                    status_code=400,
                    detail=f"Path '{m.group(1)}' not found in inputData"
                )
        # Boolean literals
        if expr.lower() == 'true':
            return True
        if expr.lower() == 'false':
            return False
        # Numeric
        try:
            if '.' in expr:
                return float(expr)
            return int(expr)
        except ValueError:
            return expr

    # Evaluate each condition
    results: List[bool] = []
    for cond in req.conditions:
        left_val = resolve(cond.left)
        right_val = resolve(cond.right)
        op_func = OP_MAP[cond.operator]
        try:
            results.append(op_func(left_val, right_val))
        except Exception:
            results.append(False)

    # Combine results
    if logic == "AND":
        passed = all(results)
    else:
        passed = any(results)

    return {"true": passed, "false": not passed}
