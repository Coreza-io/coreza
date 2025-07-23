from fastapi import APIRouter, HTTPException
from config.supabaseClient import supabase
from scheduler.services.queue import schedule_job, run_job, remove_job
from scheduler.manifests.manifestLoader import load_manifests
import croniter
import logging

router = APIRouter(prefix='/workflows')

def schedule_obj_to_cron(schedule):
    if not schedule:
        raise Exception("Schedule object missing")
    interval = schedule.get('interval')
    count = schedule.get('count', 1)
    hour = schedule.get('hour', 0)
    minute = schedule.get('minute', 0)
    if interval == "Minutes":
        return f"*/{count or 1} * * * *"
    elif interval == "Hours":
        return f"{minute or 0} */{count or 1} * * *"
    elif interval == "Days":
        return f"{minute or 0} {hour or 0} */{count or 1} * *"
    elif interval == "Weeks":
        return f"{minute or 0} {hour or 0} * * *"
    elif interval == "Months":
        return f"{minute or 0} {hour or 0} {count or 1} * *"
    else:
        raise Exception(f"Unsupported interval: {interval}")

def build_schedule_from_definition(fields):
    def get_default(key):
        return next((f.get('default') for f in fields if f.get('key') == key), None)
    return {
        'interval': get_default('interval'),
        'count': int(get_default('count') or 1),
        'hour': int(get_default('hour') or 0),
        'minute': int(get_default('minute') or 0)
    }


def list_workflows():
    res = supabase.table("workflows").select("*").execute()
    if res.error:
        logging.error(f"[Workflow] listWorkflows error: {res.error.message}")
        raise HTTPException(500, detail=res.error.message)
    return res.data

def get_workflow(id: str):
    res = supabase.table("workflows").select("*").eq("id", id).single().execute()
    if res.error or not res.data:
        logging.error(f"[Workflow] getWorkflow {id} not found")
        raise HTTPException(404, detail="Workflow not found")
    return res.data

def activate_workflow(id: str):
    import json
    # 1. Fetch workflow nodes and user_id
    res = supabase.table("workflows").select("nodes, user_id").eq("id", id).single().execute()
    if not res.data:
        logging.error(f"[Workflow] Could not load workflow {id}: {res.error and res.error.message}")
        raise HTTPException(404, detail="Workflow not found")
    nodes = res.data['nodes']
    user_id = res.data.get('user_id')
    if isinstance(nodes, str):
        nodes = json.loads(nodes)

    # 2. Find the Scheduler node
    scheduler_node = next((n for n in nodes if n.get('type') == "Scheduler"), None)
    if not scheduler_node:
        logging.error(f"[Workflow] No Scheduler node in workflow {id}")
        raise HTTPException(400, detail="No Scheduler node found")

    # 3. Extract user-defined schedule or use defaults
    schedule_obj = None
    if 'data' in scheduler_node and scheduler_node['data'].get('schedule'):
        schedule_obj = scheduler_node['data']['schedule']
    elif scheduler_node.get('values'):
        vals = scheduler_node['values']
        schedule_obj = {
            'interval': vals.get('interval'),
            'count': int(vals.get('count', 1)),
            'hour': int(vals.get('hour', 0)),
            'minute': int(vals.get('minute', 0)),
        }
    # Fallback: get defaults from manifest
    if not schedule_obj:
        manifests = load_manifests()
        scheduler_manifest = manifests.get("Scheduler")
        def_fields = scheduler_manifest.get('fields', [])
        if not isinstance(def_fields, list):
            logging.error(f"[Workflow] Scheduler definition missing in manifest for {id}")
            raise HTTPException(500, detail="Internal: Scheduler manifest missing")
        schedule_obj = build_schedule_from_definition(def_fields)

    # 4. Convert to cron and validate
    try:
        schedule_cron = schedule_obj_to_cron(schedule_obj)
        croniter.croniter(schedule_cron)  # Validate
        logging.info(f"[Workflow] Generated CRON: {schedule_cron}")
    except Exception as e:
        logging.error(f"[Workflow] Invalid schedule for {id}: {e}")
        raise HTTPException(400, detail=f"Invalid schedule: {e}")

    # 5. Update DB: is_active = true and save cron
    upd = supabase.table("workflows") \
        .update({"is_active": True, "schedule_cron": schedule_cron}) \
        .eq("id", id).execute()
    if not upd.data:
        logging.error(f"[Workflow] Failed to mark active {id}: {upd.error.message}")
        raise HTTPException(500, detail=upd.error.message)

    # 6. Schedule and run
    try:
        schedule_job(id, schedule_cron)
        logging.info(f"[Workflow] Scheduled in APScheduler with CRON: {schedule_cron}")
        run_job.delay(id)
        logging.info(f"[Workflow] Queued immediate run for workflow {id}")
    except Exception as e:
        logging.error(f"[Workflow] Scheduling error for {id}: {e}")
        raise HTTPException(500, detail=f"Scheduling failed: {e}")

    return {}, 204

def deactivate_workflow(id: str):
    """
    Deactivate the workflow and remove any scheduled jobs.
    """
    # 1. Remove scheduled job from scheduler
    try:
        remove_job(id)
        logging.info(f"[Workflow] Removed scheduled job for {id}")
    except Exception as e:
        logging.error(f"[Workflow] Failed to remove scheduled job for {id}: {e}")

    # 2. Mark workflow inactive in DB
    upd = supabase.table("workflows") \
        .update({"is_active": False}) \
        .eq("id", id) \
        .execute()
    if not getattr(upd, 'data', None):
        logging.error(f"[Workflow] Failed to deactivate {id}: no data returned")
        raise HTTPException(500, detail="Failed to deactivate workflow")
    return {}, 204
