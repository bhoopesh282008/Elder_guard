import logging
import uuid
from pathlib import Path
from typing import Optional, Generator, Dict, Any
from supabase import create_client, Client
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from app.core.config import (
    SUPABASE_URL,
    SUPABASE_KEY,
    LOCAL_POSTGRES_URL,
    DB_PROVIDER,
)

logger = logging.getLogger("elderguard.database")

# 1. Cloud Supabase Client Initialization
supabase: Optional[Client] = None

if SUPABASE_URL and SUPABASE_KEY and not SUPABASE_URL.startswith("https://your-supabase"):
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        logger.info("Cloud Supabase client successfully initialized.")
    except Exception as e:
        logger.warning(f"Failed to initialize Cloud Supabase client: {e}")
        supabase = None
else:
    logger.warning("Cloud Supabase credentials not configured or set to placeholders.")
    supabase = None


def get_db_client() -> Client:
    """
    Returns initialized Cloud Supabase client instance or raises RuntimeError if unconfigured.
    """
    if supabase is None:
        raise RuntimeError("Cloud Supabase client is not configured. Please set SUPABASE_URL and SUPABASE_KEY in .env.")
    return supabase


# 2. Local PostgreSQL Engine & Session Initialization
local_engine = None
LocalSessionLocal = None

if LOCAL_POSTGRES_URL:
    try:
        engine_options = {"pool_pre_ping": True}
        if LOCAL_POSTGRES_URL.startswith("sqlite"):
            engine_options["connect_args"] = {"check_same_thread": False}
        else:
            engine_options.update({"pool_size": 10, "max_overflow": 20})
        local_engine = create_engine(LOCAL_POSTGRES_URL, **engine_options)

        # Creating a SQLAlchemy engine does not open a connection. Confirm the
        # configured database is actually reachable and use the durable local
        # database when a developer machine has no working PostgreSQL server.
        if not LOCAL_POSTGRES_URL.startswith("sqlite"):
            try:
                with local_engine.connect() as conn:
                    conn.execute(text("SELECT 1"))
            except Exception as connection_error:
                sqlite_path = Path(__file__).resolve().parents[2] / "elderguard.db"
                logger.warning(
                    "Configured PostgreSQL is unavailable (%s); using local SQLite at %s.",
                    connection_error.__class__.__name__,
                    sqlite_path,
                )
                local_engine.dispose()
                local_engine = create_engine(
                    f"sqlite:///{sqlite_path.as_posix()}",
                    connect_args={"check_same_thread": False},
                )

        LocalSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=local_engine)
        # Keep local development functional without requiring Docker. These
        # tables cover account and profile flows; production can point the
        # same URL setting at PostgreSQL/Supabase instead.
        if str(local_engine.url).startswith("sqlite"):
            with local_engine.begin() as conn:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS users (
                        id TEXT PRIMARY KEY, email TEXT UNIQUE, phone_no TEXT UNIQUE,
                        password_hash TEXT, auth_provider TEXT NOT NULL, google_id TEXT,
                        role TEXT NOT NULL, is_verified BOOLEAN NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                    )
                """))
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS elder_profiles (
                        user_id TEXT PRIMARY KEY, elder_id TEXT UNIQUE, profile_pic_url TEXT, name TEXT NOT NULL,
                        nickname TEXT, age_or_dob TEXT, gender TEXT, blood_group TEXT,
                        primary_language TEXT, phone_no TEXT, whatsapp_no TEXT, email TEXT,
                        home_address TEXT, height_cm REAL, weight_kg REAL, bed_gap TEXT,
                        caregiver_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                    )
                """))
                elder_columns = {row[1] for row in conn.execute(text("PRAGMA table_info(elder_profiles)"))}
                if "elder_id" not in elder_columns:
                    conn.execute(text("ALTER TABLE elder_profiles ADD COLUMN elder_id TEXT"))
                if "primary_hospital_id" not in elder_columns:
                    conn.execute(text("ALTER TABLE elder_profiles ADD COLUMN primary_hospital_id TEXT"))
                for (user_id,) in conn.execute(text("SELECT user_id FROM elder_profiles WHERE elder_id IS NULL")):
                    conn.execute(
                        text("UPDATE elder_profiles SET elder_id = :elder_id WHERE user_id = :user_id"),
                        {"elder_id": f"EG-{uuid.uuid4().hex[:8].upper()}", "user_id": user_id},
                    )
                conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS idx_elder_profiles_elder_id ON elder_profiles(elder_id)"))
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS caregiver_profiles (
                        user_id TEXT PRIMARY KEY, name TEXT, phone_no TEXT, email TEXT,
                        relationship_to_elder TEXT, linked_elder_id TEXT, profile_pic_url TEXT,
                        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                    )
                """))
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS doctor_profiles (
                        user_id TEXT PRIMARY KEY, name TEXT NOT NULL, professional_title TEXT,
                        gender TEXT, profile_pic_url TEXT, license_number TEXT,
                        medical_council_board TEXT, years_of_experience INTEGER DEFAULT 0,
                        specialization TEXT, qualification TEXT, working_hours TEXT,
                        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                    )
                """))
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS hospital_profiles (
                        user_id TEXT PRIMARY KEY, office_name TEXT, license_id TEXT,
                        address TEXT, gps_lat REAL, gps_lng REAL, phone_no TEXT,
                        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                    )
                """))
                hospital_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(hospital_profiles)"))}
                for col_name, col_def in [
                    ("office_name", "TEXT"),
                    ("license_id", "TEXT"),
                    ("address", "TEXT"),
                    ("gps_lat", "REAL"),
                    ("gps_lng", "REAL"),
                    ("phone_no", "TEXT"),
                ]:
                    if col_name not in hospital_cols:
                        conn.execute(text(f"ALTER TABLE hospital_profiles ADD COLUMN {col_name} {col_def}"))
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS pharmacy_profiles (
                        user_id TEXT PRIMARY KEY, pharmacy_name TEXT, license_id TEXT,
                        address TEXT, gps_lat REAL, gps_lng REAL, phone_no TEXT,
                        home_delivery_available INTEGER DEFAULT 1,
                        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                    )
                """))
                pharmacy_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(pharmacy_profiles)"))}
                for col_name, col_def in [
                    ("pharmacy_name", "TEXT"),
                    ("license_id", "TEXT"),
                    ("address", "TEXT"),
                    ("gps_lat", "REAL"),
                    ("gps_lng", "REAL"),
                    ("phone_no", "TEXT"),
                    ("home_delivery_available", "INTEGER DEFAULT 1"),
                ]:
                    if col_name not in pharmacy_cols:
                        conn.execute(text(f"ALTER TABLE pharmacy_profiles ADD COLUMN {col_name} {col_def}"))
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS appointments (
                        id TEXT PRIMARY KEY, elder_id TEXT NOT NULL, doctor_id TEXT NOT NULL,
                        hospital_id TEXT, appointment_date TEXT NOT NULL, start_time TEXT NOT NULL,
                        end_time TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'telemedicine',
                        status TEXT NOT NULL DEFAULT 'scheduled', reschedule_from_id TEXT,
                        queue_token TEXT, cancelled_by TEXT, cancellation_reason TEXT,
                        idempotency_key TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                    )
                """))
                appt_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(appointments)"))}
                for col_name, col_def in [
                    ("mode", "TEXT NOT NULL DEFAULT 'telemedicine'"),
                    ("reschedule_from_id", "TEXT"),
                    ("queue_token", "TEXT"),
                    ("cancelled_by", "TEXT"),
                    ("cancellation_reason", "TEXT")
                ]:
                    if col_name not in appt_cols:
                        conn.execute(text(f"ALTER TABLE appointments ADD COLUMN {col_name} {col_def}"))

                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS doctor_availability (
                        id TEXT PRIMARY KEY, doctor_id TEXT NOT NULL, day_of_week INTEGER,
                        specific_date TEXT, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
                        slot_duration_minutes INTEGER DEFAULT 30, max_patients INTEGER DEFAULT 1,
                        is_recurring INTEGER DEFAULT 1, is_blocked INTEGER DEFAULT 0,
                        created_at TEXT NOT NULL
                    )
                """))
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS telemed_sessions (
                        id TEXT PRIMARY KEY, appointment_id TEXT UNIQUE NOT NULL,
                        room_url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled',
                        started_at TEXT, ended_at TEXT, expires_at TEXT, created_at TEXT NOT NULL
                    )
                """))
                telemed_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(telemed_sessions)"))}
                if "expires_at" not in telemed_cols:
                    conn.execute(text("ALTER TABLE telemed_sessions ADD COLUMN expires_at TEXT"))
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS appointment_audit_log (
                        id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL, action TEXT NOT NULL,
                        from_status TEXT, to_status TEXT, actor_id TEXT, actor_user_id TEXT, note TEXT, created_at TEXT NOT NULL
                    )
                """))
                audit_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(appointment_audit_log)"))}
                for col_name, col_def in [
                    ("from_status", "TEXT"),
                    ("to_status", "TEXT"),
                    ("actor_id", "TEXT"),
                    ("note", "TEXT")
                ]:
                    if col_name not in audit_cols:
                        conn.execute(text(f"ALTER TABLE appointment_audit_log ADD COLUMN {col_name} {col_def}"))

                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS elder_caregiver_links (
                        elder_id TEXT NOT NULL, caregiver_id TEXT NOT NULL,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        PRIMARY KEY (elder_id, caregiver_id)
                    )
                """))
        logger.info("Local PostgreSQL engine successfully initialized.")
    except Exception as e:
        logger.warning(f"Failed to initialize Local PostgreSQL engine: {e}")
        local_engine = None
        LocalSessionLocal = None


def get_local_db() -> Generator[Session, None, None]:
    """
    FastAPI dependency yielding a Local PostgreSQL Session.
    """
    if LocalSessionLocal is None:
        raise RuntimeError("Local PostgreSQL is not configured. Please set LOCAL_POSTGRES_URL in .env.")
    db = LocalSessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_dual_db_health() -> Dict[str, Any]:
    """
    Inspects connectivity status for both Cloud Supabase and Local PostgreSQL databases concurrently.
    """
    health = {
        "cloud_supabase": {"status": "unconfigured", "details": None},
        "local_postgres": {"status": "unconfigured", "details": None},
        "active_mode": DB_PROVIDER,
    }

    # Test Cloud Supabase
    if supabase is not None:
        try:
            res = supabase.table("users").select("id").limit(1).execute()
            health["cloud_supabase"] = {
                "status": "connected",
                "details": f"Successfully connected to Cloud Supabase. (Rows accessible: {len(res.data) if res.data is not None else 0})"
            }
        except Exception as e:
            health["cloud_supabase"] = {
                "status": "error",
                "details": str(e)
            }

    # Test Local PostgreSQL
    if local_engine is not None:
        try:
            with local_engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            health["local_postgres"] = {
                "status": "connected",
                "details": "Successfully connected to Local PostgreSQL."
            }
        except Exception as e:
            health["local_postgres"] = {
                "status": "error",
                "details": str(e)
            }

    return health
