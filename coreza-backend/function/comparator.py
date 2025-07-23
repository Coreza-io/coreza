"""
Module: Comparator Service

Provides utilities to compute comparison-based nodes (If, Switch)
from execution payloads for workflow endpoints.
"""

# Standard library imports
import json
from typing import Any, Dict, List


def if_func(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Evaluate one or more conditions and return a boolean result.

    Args:
        payload: {
            'conditions': List[{'left': Any, 'operator': str, 'right': Any}],
            'logicalOp': 'AND' or 'OR'
        }

    Returns:
        {'result': bool} or {'error': message}
    """
    conditions = payload.get('conditions')
    logicalOp = payload.get('logicalOp', 'AND')
    if conditions is None:
        return {'error': 'conditions field is required'}
    if not isinstance(conditions, list):
        return {'error': 'conditions must be a list of dicts'}

    results: List[bool] = []
    for cond in conditions:
        left = cond.get('left')
        op = cond.get('operator')
        right = cond.get('right')
        if op == '===':
            res = left == right
        elif op == '!==':
            res = left != right
        elif op == '>=':
            res = left >= right
        elif op == '<=':
            res = left <= right
        else:
            return {'error': f'Unsupported operator: {op}'}
        results.append(res)

    if logicalOp == 'AND':
        passed = all(results)
    elif logicalOp == 'OR':
        passed = any(results)
    else:
        return {'error': f'Unsupported logicalOp: {logicalOp}'}

    return {"true": passed, "false": not passed}


def switch_func(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Select a branch based on matching cases against an input value.
    
    Frontend sends:
    {
        'inputValue': 'AAPL',
        'cases': [
            {'caseName': 'AAPL', 'caseValue': 'case1'},
            {'caseName': 'MSFT', 'caseValue': 'case2'}
        ],
        'defaultCase': 'default',  # NEW: handle name for no matches
        'user_id': 'some-uuid'
    }

    Args:
        payload: {
          'inputValue': Any - the value to match against
          'cases': List[{'caseName': Any, 'caseValue': str}] - list of case mappings
          'defaultCase': str - handle name to use when no cases match (defaults to 'default')
          'user_id': str - authenticated user ID
        }

    Returns:
        {'result': matched_caseValue_or_defaultCase}
    """
    input_value = payload.get('inputValue')
    cases = payload.get('cases')
    default_case = payload.get('defaultCase', 'default')  # NEW: extract defaultCase
    
    # Validation
    if input_value is None:
        return {'error': 'inputValue is required'}
    if not cases:
        return {'error': 'cases array is required'}
    if not isinstance(cases, list):
        return {'error': 'cases must be a list of objects'}

    # Find matching case
    for case in cases:
        if not isinstance(case, dict):
            continue
        case_name = case.get('caseName')
        case_value = case.get('caseValue')
        
        if case_name is not None and input_value == case_value:
            return {'result': case_value}

    # No match found - return default case instead of error
    return {'result': default_case}  # CHANGED: return default instead of error


