# scheduler/api/routes/workflow_routes.py
from fastapi import APIRouter, HTTPException, Response, status
import logging

from scheduler.api.controllers.workflow_controller import (
    list_workflows,
    get_workflow,
    activate_workflow,
    deactivate_workflow,
)

router = APIRouter(prefix='/workflows')

@router.get('/', response_model=list)
def api_list():
    return list_workflows()

@router.get('/{workflow_id}', response_model=dict)
def api_get(workflow_id: str):
    wf = get_workflow(workflow_id)
    if not wf:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Not found')
    return wf

@router.post('/{workflow_id}/activate', status_code=status.HTTP_204_NO_CONTENT)
def api_activate(workflow_id: str):
    try:
        activate_workflow(workflow_id)
    except Exception as e:
        logging.error(f"Activate failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    return Response(status_code=status.HTTP_204_NO_CONTENT)

@router.post('/{workflow_id}/deactivate', status_code=status.HTTP_204_NO_CONTENT)
def api_deactivate(workflow_id: str):
    try:
        deactivate_workflow(workflow_id)
    except Exception as e:
        logging.error(f"Deactivate failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    return Response(status_code=status.HTTP_204_NO_CONTENT)