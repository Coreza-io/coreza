import os
from supabase import create_client, Client
from celery import Celery

# --- Supabase client
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# --- Celery (Redis broker)
CELERY_BROKER_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
celery_app = Celery("coreza", broker=CELERY_BROKER_URL, backend=CELERY_BROKER_URL)
