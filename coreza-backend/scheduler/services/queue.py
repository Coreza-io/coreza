# === server/services/queue.py ===
from celery import Celery
from config.supabaseClient import supabase
from scheduler.services.workflow_engine import execute_workflow

# APScheduler imports
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

# Initialize Celery app
celery_app = Celery('workflow', broker='redis://localhost:6379/0')

# Initialize and start the APScheduler
scheduler = BackgroundScheduler()
scheduler.start()

@celery_app.task(name='scheduler.services.queue.run_job')
def run_job(workflow_id: str):
    """
    1. Insert a record into workflow_runs (status: running)
    2. Execute the workflow with the returned run_id
    3. Update the workflow_runs status (success/failed)
    """
    # import pdb; pdb.set_trace()
    # 1. Create workflow run record
    insert_res = supabase.table('workflow_runs')\
        .insert({
            'workflow_id': workflow_id,
            'status': 'running'
        })\
        .execute()
    if not insert_res.data:
        print(f"[ERROR] Failed to create workflow_run for {workflow_id}")
        return
    # Supabase returns a list of inserted rows
    run_row = insert_res.data[0] if isinstance(insert_res.data, list) else insert_res.data
    run_id = run_row['id']
    print(f"[INFO] Created workflow_run record with ID {run_id}")

    # 2. Execute the workflow
    try:
        execute_workflow(workflow_id, run_id)
        # 3a. Mark run as success
        supabase.table('workflow_runs')\
            .update({'status': 'success'})\
            .eq('id', run_id).execute()
        print(f"[INFO] Workflow run {run_id} completed successfully")
    except Exception as e:
        # 3b. Mark run as failed
        print(f"[ERROR] Workflow {workflow_id} run {run_id} failed: {e}")
        supabase.table('workflow_runs')\
            .update({'status': 'failed'})\
            .eq('id', run_id).execute()


def schedule_job(workflow_id: str, cron: str):
    """
    Schedule a Celery run_job call according to the given cron string,
    using APScheduler in the FastAPI process.
    """
    minute, hour, day, month, dow = cron.split()
    trigger = CronTrigger(minute=minute, hour=hour,
                          day=day, month=month, day_of_week=dow)
    # Add or replace the job for this workflow
    scheduler.add_job(
        func=lambda: run_job.delay(workflow_id),
        trigger=trigger,
        id=f'workflow_{workflow_id}',
        replace_existing=True
    )
    print(f"[INFO] APScheduler: job 'workflow_{workflow_id}' scheduled with cron '{cron}'")


def remove_job(workflow_id: str):
    """
    Remove the scheduled APScheduler job for the workflow.
    """
    job_id = f'workflow_{workflow_id}'
    try:
        scheduler.remove_job(job_id)
        print(f"[INFO] APScheduler: job '{job_id}' removed")
    except Exception:
        print(f"[WARNING] APScheduler: job '{job_id}' not found or already removed")
