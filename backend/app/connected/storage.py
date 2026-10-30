import json
import logging
import threading
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Iterable, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import text

from app.core.database import local_engine


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def dumps(value: Any) -> str:
    return json.dumps(value)


def loads(value: Any, fallback: Any = None) -> Any:
    if value is None:
        return fallback
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return fallback


def row_to_dict(row: Any) -> Dict[str, Any]:
    return dict(row._mapping)


def execute(statement: str, params: Optional[Dict[str, Any]] = None) -> None:
    if local_engine is None:
        raise RuntimeError("Local database is not configured.")
    with local_engine.begin() as conn:
        conn.execute(text(statement), params or {})


def fetch_one(statement: str, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    if local_engine is None:
        return None
    with local_engine.connect() as conn:
        row = conn.execute(text(statement), params or {}).fetchone()
        return row_to_dict(row) if row else None


def fetch_all(statement: str, params: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    if local_engine is None:
        return []
    with local_engine.connect() as conn:
        return [row_to_dict(row) for row in conn.execute(text(statement), params or {}).fetchall()]


def _table_columns(table: str) -> set[str]:
    if local_engine is None:
        return set()
    with local_engine.connect() as conn:
        if str(local_engine.url).startswith("sqlite"):
            return {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})")).fetchall()}
        rows = conn.execute(
            text(
                """
                SELECT column_name FROM information_schema.columns
                WHERE table_name = :table_name
                """
            ),
            {"table_name": table},
        ).fetchall()
        return {row[0] for row in rows}


def initialize_connected_schema() -> None:
    if local_engine is None:
        return

    is_sqlite = str(local_engine.url).startswith("sqlite")
    bool_default = "INTEGER NOT NULL DEFAULT 0" if is_sqlite else "BOOLEAN NOT NULL DEFAULT FALSE"
    with local_engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS elder_caregiver_links (
                id TEXT PRIMARY KEY,
                elder_id TEXT NOT NULL,
                caregiver_id TEXT NOT NULL,
                permission_level TEXT NOT NULL DEFAULT 'full_access',
                status TEXT NOT NULL DEFAULT 'pending',
                invited_by TEXT,
                invited_at TEXT NOT NULL,
                accepted_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """))

        link_columns = _table_columns("elder_caregiver_links")
        for column, definition in {
            "id": "TEXT",
            "permission_level": "TEXT NOT NULL DEFAULT 'full_access'",
            "status": "TEXT NOT NULL DEFAULT 'active'",
            "invited_by": "TEXT",
            "invited_at": "TEXT",
            "accepted_at": "TEXT",
            "updated_at": "TEXT",
        }.items():
            if column not in link_columns:
                conn.execute(text(f"ALTER TABLE elder_caregiver_links ADD COLUMN {column} {definition}"))

        now = now_iso()
        rows = conn.execute(text("SELECT elder_id, caregiver_id FROM elder_caregiver_links WHERE id IS NULL OR id = ''")).fetchall()
        for row in rows:
            conn.execute(
                text("""
                    UPDATE elder_caregiver_links
                    SET id = :id, invited_at = COALESCE(invited_at, :now), updated_at = COALESCE(updated_at, :now)
                    WHERE elder_id = :elder_id AND caregiver_id = :caregiver_id
                """),
                {"id": new_id(), "now": now, "elder_id": row[0], "caregiver_id": row[1]},
            )

        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_links_caregiver_status ON elder_caregiver_links(caregiver_id, status)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_links_elder_status ON elder_caregiver_links(elder_id, status)"))

        conn.execute(text(f"""
            CREATE TABLE IF NOT EXISTS connected_medicines (
                id TEXT PRIMARY KEY,
                elder_id TEXT NOT NULL,
                name TEXT NOT NULL,
                dosage TEXT NOT NULL,
                frequency TEXT,
                scheduled_times TEXT NOT NULL,
                instructions TEXT,
                stock_count INTEGER NOT NULL DEFAULT 0,
                low_stock_threshold INTEGER NOT NULL DEFAULT 7,
                is_active {bool_default},
                added_by TEXT NOT NULL,
                performed_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_connected_medicines_elder ON connected_medicines(elder_id)"))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS medicine_logs (
                id TEXT PRIMARY KEY,
                medicine_id TEXT NOT NULL,
                elder_id TEXT NOT NULL,
                scheduled_time TEXT NOT NULL,
                status TEXT NOT NULL,
                taken_at TEXT,
                logged_by TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_medicine_logs_elder ON medicine_logs(elder_id, scheduled_time)"))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS connected_vitals (
                id TEXT PRIMARY KEY,
                elder_id TEXT NOT NULL,
                type TEXT NOT NULL,
                value TEXT NOT NULL,
                unit TEXT,
                recorded_at TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'manual',
                flagged INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_connected_vitals_elder ON connected_vitals(elder_id, recorded_at)"))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS vital_target_ranges (
                id TEXT PRIMARY KEY,
                elder_id TEXT NOT NULL,
                vital_type TEXT NOT NULL,
                min_value REAL,
                max_value REAL,
                set_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS connected_appointments (
                id TEXT PRIMARY KEY,
                elder_id TEXT NOT NULL,
                doctor_id TEXT,
                hospital_id TEXT,
                scheduled_at TEXT NOT NULL,
                mode TEXT NOT NULL,
                status TEXT NOT NULL,
                notes TEXT,
                performed_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_connected_appointments_elder ON connected_appointments(elder_id, scheduled_at)"))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS connected_sos_events (
                id TEXT PRIMARY KEY,
                elder_id TEXT NOT NULL,
                triggered_at TEXT NOT NULL,
                location TEXT,
                status TEXT NOT NULL,
                caregiver_notified_at TEXT,
                resolved_by TEXT,
                resolution_notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_connected_sos_elder ON connected_sos_events(elder_id, triggered_at)"))
        sos_columns = _table_columns("connected_sos_events")
        for column, definition in {
            "acknowledged_by": "TEXT",
            "acknowledged_at": "TEXT",
            "escalation_level": "INTEGER NOT NULL DEFAULT 0",
        }.items():
            if column not in sos_columns:
                conn.execute(text(f"ALTER TABLE connected_sos_events ADD COLUMN {column} {definition}"))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS checkins (
                id TEXT PRIMARY KEY,
                elder_id TEXT NOT NULL,
                date TEXT NOT NULL,
                mood TEXT NOT NULL,
                ok_status INTEGER NOT NULL,
                timestamp TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_checkins_elder_date ON checkins(elder_id, date)"))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS connected_reminders (
                id TEXT PRIMARY KEY,
                elder_id TEXT NOT NULL,
                type TEXT NOT NULL,
                scheduled_time TEXT NOT NULL,
                status TEXT NOT NULL,
                created_by TEXT NOT NULL,
                payload TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS connected_messages (
                id TEXT PRIMARY KEY,
                sender_id TEXT NOT NULL,
                receiver_id TEXT NOT NULL,
                elder_context_id TEXT NOT NULL,
                content TEXT NOT NULL,
                attachment_url TEXT,
                sent_at TEXT NOT NULL,
                read_at TEXT
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_messages_elder ON connected_messages(elder_context_id, sent_at)"))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS connected_notifications (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                type TEXT NOT NULL,
                payload TEXT NOT NULL,
                read INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS caregiver_audit_logs (
                id TEXT PRIMARY KEY,
                elder_id TEXT NOT NULL,
                performed_by TEXT NOT NULL,
                action TEXT NOT NULL,
                resource_type TEXT NOT NULL,
                resource_id TEXT,
                payload TEXT,
                created_at TEXT NOT NULL
            )
        """))

        # Reminder session tables (used by medicine scheduler sweep jobs)
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS reminder_sessions (
                id TEXT PRIMARY KEY,
                elder_id TEXT NOT NULL,
                scheduled_time TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'PENDING',
                attempt_count INTEGER NOT NULL DEFAULT 0,
                max_attempts INTEGER NOT NULL DEFAULT 3,
                current_ring_started_at TEXT,
                next_retry_at TEXT,
                resolved_at TEXT,
                resolution TEXT,
                created_at TEXT NOT NULL
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_reminder_sessions_status ON reminder_sessions(status, scheduled_time)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_reminder_sessions_elder ON reminder_sessions(elder_id, status)"))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS reminder_session_items (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                medicine_id TEXT NOT NULL,
                medicine_name TEXT NOT NULL,
                dosage TEXT NOT NULL,
                marked_taken INTEGER NOT NULL DEFAULT 0,
                marked_taken_at TEXT
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_reminder_session_items_session ON reminder_session_items(session_id)"))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS medicines (
                id TEXT PRIMARY KEY,
                elder_id TEXT NOT NULL,
                name TEXT NOT NULL,
                dosage TEXT NOT NULL,
                frequency TEXT,
                times_of_day TEXT,
                instructions TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS sos_events (
                id TEXT PRIMARY KEY,
                elder_id TEXT NOT NULL,
                triggered_at TEXT NOT NULL,
                location TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                caregiver_notified_at TEXT,
                resolved_by TEXT,
                resolution_notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """))


def display_name(user_id: Optional[str]) -> str:
    """Best human-readable name for any account type."""
    if not user_id:
        return "Someone"
    for table, column in (("caregiver_profiles", "name"), ("elder_profiles", "name"), ("hospital_profiles", "office_name")):
        row = fetch_one(f"SELECT {column} AS n FROM {table} WHERE user_id = :id", {"id": user_id})
        if row and row.get("n"):
            return row["n"]
    user = fetch_one("SELECT email FROM users WHERE id = :id", {"id": user_id})
    return (user or {}).get("email") or "Someone"


def get_user(user_id: str) -> Optional[Dict[str, Any]]:
    return fetch_one("SELECT * FROM users WHERE id = :id LIMIT 1", {"id": user_id})


def find_elder(identifier: str) -> Optional[Dict[str, Any]]:
    raw_identifier = identifier.strip()
    public_identifier = raw_identifier.upper()
    email_identifier = raw_identifier.lower()
    return fetch_one(
        """
        SELECT u.id, u.email, u.phone_no, ep.name, ep.elder_id, ep.profile_pic_url, ep.age_or_dob
        FROM users u
        LEFT JOIN elder_profiles ep ON ep.user_id = u.id
        WHERE u.role = 'elder'
          AND (
            u.id = :identifier
            OR lower(u.email) = :email_identifier
            OR u.phone_no = :identifier
            OR upper(ep.elder_id) = :public_identifier
            OR ep.phone_no = :identifier
            OR lower(ep.email) = :email_identifier
          )
        LIMIT 1
        """,
        {
            "identifier": raw_identifier,
            "public_identifier": public_identifier,
            "email_identifier": email_identifier,
        },
    )


def get_elder_profile(elder_id: str) -> Dict[str, Any]:
    profile = fetch_one(
        """
        SELECT ep.*, u.email AS user_email, u.phone_no AS user_phone
        FROM elder_profiles ep
        LEFT JOIN users u ON u.id = ep.user_id
        WHERE ep.user_id = :elder_id
        LIMIT 1
        """,
        {"elder_id": elder_id},
    )
    if profile:
        return profile
    user = get_user(elder_id) or {}
    return {
        "user_id": elder_id,
        "elder_id": elder_id,
        "name": user.get("email") or f"Elder {elder_id[:6]}",
        "profile_pic_url": None,
        "age_or_dob": None,
        "primary_language": None,
        "home_address": None,
    }


def normalize_link(row: Dict[str, Any]) -> Dict[str, Any]:
    row["permission_level"] = row.get("permission_level") or "full_access"
    row["status"] = row.get("status") or "active"
    return row


def get_link(elder_id: str, caregiver_id: str, active_only: bool = True) -> Optional[Dict[str, Any]]:
    status_sql = "AND status = 'active'" if active_only else ""
    row = fetch_one(
        f"""
        SELECT * FROM elder_caregiver_links
        WHERE elder_id = :elder_id AND caregiver_id = :caregiver_id {status_sql}
        LIMIT 1
        """,
        {"elder_id": elder_id, "caregiver_id": caregiver_id},
    )
    return normalize_link(row) if row else None


def ensure_elder_access(current_user: Dict[str, Any], elder_id: str, write: bool = False) -> Optional[Dict[str, Any]]:
    user_id = current_user.get("user_id")
    role = current_user.get("role")
    if role == "elder" and user_id == elder_id:
        return None
    if role == "caregiver":
        link = get_link(elder_id, user_id, active_only=True)
        if link and (not write or link["permission_level"] == "full_access"):
            return link
    if role == "doctor" and not write:
        return None
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={"error": {"code": "ELDER_ACCESS_DENIED", "message": "You do not have permission for this elder's data."}},
    )


def require_role(current_user: Dict[str, Any], roles: Iterable[str]) -> None:
    if current_user.get("role") not in set(roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": {"code": "ROLE_DENIED", "message": "Your account role cannot perform this action."}},
        )


def audit(elder_id: str, performed_by: str, action: str, resource_type: str, resource_id: Optional[str], payload: Any) -> None:
    execute(
        """
        INSERT INTO caregiver_audit_logs (id, elder_id, performed_by, action, resource_type, resource_id, payload, created_at)
        VALUES (:id, :elder_id, :performed_by, :action, :resource_type, :resource_id, :payload, :created_at)
        """,
        {
            "id": new_id(),
            "elder_id": elder_id,
            "performed_by": performed_by,
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "payload": dumps(payload),
            "created_at": now_iso(),
        },
    )


logger = logging.getLogger("elderguard.connected")

def _telegram_alert_types() -> set:
    from app.connected.telegram_bot import ALERT_TYPES
    return ALERT_TYPES


def _push_telegram(user_ids: List[str], type_: str, payload: Dict[str, Any]) -> None:
    # Imported here so the connected module never fails to load if the Telegram side changes.
    from app.connected.telegram_bot import push_alert
    push_alert(user_ids, type_, payload)


def notify(user_ids: Iterable[str], type_: str, payload: Dict[str, Any]) -> None:
    created_at = now_iso()
    recipients = list(set(user_ids))
    for user_id in recipients:
        execute(
            """
            INSERT INTO connected_notifications (id, user_id, type, payload, read, created_at)
            VALUES (:id, :user_id, :type, :payload, 0, :created_at)
            """,
            {"id": new_id(), "user_id": user_id, "type": type_, "payload": dumps(payload), "created_at": created_at},
        )
    if recipients and type_ in _telegram_alert_types():
        # Network call to Telegram must never slow down or fail the API request.
        threading.Thread(target=_push_telegram, args=(recipients, type_, payload), daemon=True).start()


def linked_caregiver_ids(elder_id: str) -> List[str]:
    rows = fetch_all(
        "SELECT caregiver_id FROM elder_caregiver_links WHERE elder_id = :elder_id AND status = 'active'",
        {"elder_id": elder_id},
    )
    return [row["caregiver_id"] for row in rows]


def linked_hospital_ids(elder_id: str) -> List[str]:
    hospitals = []
    profile = fetch_one("SELECT primary_hospital_id FROM elder_profiles WHERE user_id = :elder_id", {"elder_id": elder_id})
    if profile and profile.get("primary_hospital_id"):
        hospitals.append(profile["primary_hospital_id"])
    rows = fetch_all("SELECT user_id FROM hospital_profiles")
    if rows:
        hospitals.extend([r["user_id"] for r in rows if r.get("user_id")])
    if not hospitals:
        hospitals.append("demo_hospital")
    return list(set(hospitals))


def parse_medicine(row: Dict[str, Any]) -> Dict[str, Any]:
    row["scheduled_times"] = loads(row.get("scheduled_times"), [])
    row["times_of_day"] = row["scheduled_times"]
    row["is_active"] = bool(row.get("is_active"))
    return row


def parse_vital(row: Dict[str, Any]) -> Dict[str, Any]:
    row["value"] = loads(row.get("value"), {})
    row["flagged"] = bool(row.get("flagged"))
    return row


def parse_notification(row: Dict[str, Any]) -> Dict[str, Any]:
    row["payload"] = loads(row.get("payload"), {})
    row["read"] = bool(row.get("read"))
    return row


def range_start(range_name: str) -> str:
    days = {"7d": 7, "30d": 30, "90d": 90}.get(range_name.lower(), 7)
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
