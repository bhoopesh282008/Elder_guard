from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.auth.routes import router as auth_router
from app.profiles.elder import router as elder_profile_router
from app.profiles.caregiver import router as caregiver_profile_router
from app.profiles.doctor import router as doctor_profile_router
from app.profiles.hospital import router as hospital_profile_router
from app.profiles.pharmacy import router as pharmacy_profile_router
from app.profiles.links import router as profile_links_router
from app.ocr.routes import router as ocr_router
from app.medicines.routes import medicines_router, reminders_router
from app.notifications.routes import router as notifications_router
from app.emergency.routes import router as emergency_router
from app.appointments.router import router as appointments_router
from app.vitals.routes import router as vitals_router
from app.ai_companion.routes import router as ai_companion_router
from app.reports.routes import router as reports_router
from app.analytics.routes import router as analytics_router
from app.events.routes import router as events_router
from app.hospital.routes import router as hospital_ops_router, ensure_local_schema as ensure_hospital_schema
from app.doctor_records.routes import router as doctor_records_router, ensure_local_schema as ensure_doctor_records_schema
from app.connected.routes import router as connected_router, ws_router as connected_ws_router
from app.connected.storage import initialize_connected_schema
from app.medicines.scheduler import start_scheduler, shutdown_scheduler
from app.emergency.scheduler import start_emergency_scheduler, shutdown_emergency_scheduler
from app.appointments.scheduler import start_appointments_scheduler, shutdown_appointments_scheduler
from app.vitals.scheduler import start_vitals_scheduler, shutdown_vitals_scheduler

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_connected_schema()
    ensure_hospital_schema()
    ensure_doctor_records_schema()
    # Startup: start background schedulers
    start_scheduler()
    start_emergency_scheduler()
    start_appointments_scheduler()
    start_vitals_scheduler()
    yield
    # Shutdown: stop background schedulers
    shutdown_scheduler()
    shutdown_emergency_scheduler()
    shutdown_appointments_scheduler()
    shutdown_vitals_scheduler()


app = FastAPI(
    title="ElderGuard AI Backend API",
    description="FastAPI Backend for ElderGuard AI - Healthcare Platform for Elders, Caregivers, Doctors, Hospitals, and Pharmacies",
    version="1.0.0",
    lifespan=lifespan
)

# Configure CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins for local dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Routers
app.include_router(auth_router)
app.include_router(elder_profile_router)
app.include_router(caregiver_profile_router)
app.include_router(doctor_profile_router)
app.include_router(hospital_profile_router)
app.include_router(pharmacy_profile_router)
app.include_router(profile_links_router)
app.include_router(ocr_router)
app.include_router(medicines_router)
app.include_router(reminders_router)
app.include_router(notifications_router)
app.include_router(emergency_router)
app.include_router(appointments_router)
app.include_router(vitals_router)
app.include_router(ai_companion_router)
app.include_router(reports_router)
app.include_router(analytics_router)
app.include_router(events_router)
app.include_router(hospital_ops_router)
app.include_router(doctor_records_router)
app.include_router(connected_router)
app.include_router(connected_ws_router)









@app.get("/")
def health_check(request: Request):
    """
    Health check route returning app status.
    Browsers get the built frontend instead when it exists.
    """
    if FRONTEND_DIST.is_dir() and "text/html" in request.headers.get("accept", ""):
        return FileResponse(FRONTEND_DIST / "index.html")
    return {
        "status": "ok",
        "app": "ElderGuard AI Backend API",
        "version": "1.0.0"
    }


# Serve the built frontend (frontend/dist) from this service when present.
# Mounted last so every API route above takes priority.
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
