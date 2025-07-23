# === main.py ===
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from scheduler.api.routes.workflow_routes import router as wf_router
#from server.services.queue import celery_app
from routes.agent import router as agent_router
from routes.whatsapp_sender import router as whatsapp_sender_router
from routes.webhook import router as webhook_router
from routes.webhook_register import router as webhook_register_router
from routes.gmail import router as gmail_router
from routes.openai import router as openai_router
from routes.finnhub import router as finnhub_router
from routes.movingAverageCross import router as movingAverageCross_router
from routes.RSI import router as RSI_router
#from routes.emaRoute import router as EMA_router
from routes.IFCond import router as IFCond_router
from routes.Scheduler import router as Scheduler_router
from routes.alpacaRoute import router as Alpaca_router
from routes.dhanRoute import router as Dhan_router
from routes.yahoofinance import router as yahoofinance_router
from routes.indicatorsRoute import router as Indicators_router
from routes.comparatorRoute import router as comparator_router
from routes.marketRoute import router as Market_router
import os

app = FastAPI()

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health check
@app.get("/health")
async def health():
    return {"status": "OK"}

# Include routers
app.include_router(wf_router)
app.include_router(agent_router)
app.include_router(whatsapp_sender_router)
app.include_router(webhook_router)
app.include_router(webhook_register_router)
app.include_router(gmail_router)
app.include_router(openai_router)
app.include_router(finnhub_router)
app.include_router(movingAverageCross_router)
app.include_router(RSI_router)
#app.include_router(EMA_router)
app.include_router(IFCond_router)
app.include_router(Scheduler_router)
app.include_router(Alpaca_router)
app.include_router(Dhan_router)
app.include_router(yahoofinance_router)
app.include_router(Indicators_router)
app.include_router(comparator_router)
app.include_router(Market_router)

# Startup and Shutdown events
@app.on_event("startup")
async def on_startup():
    # Celery worker and beat are run separately; initialize any globals here
    print("🚀 API startup complete")

@app.on_event("shutdown")
async def on_shutdown():
    print("🛑 API shutdown complete")

# Entry point
if __name__ == '__main__':
    import uvicorn
    port = int(os.getenv('PORT', 8000))
    uvicorn.run(app, host='0.0.0.0', port=port)
