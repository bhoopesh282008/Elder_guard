import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional
import httpx
from sqlalchemy import text as sql

from app.core.config import TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET
from app.core import database as _database
from app.core.database import supabase

logger = logging.getLogger("elderguard.notifications.telegram")

_mock_telegram_links_db: Dict[str, Dict[str, Any]] = {}
_mock_link_codes: Dict[str, Dict[str, Any]] = {}

LINK_CODE_TTL_MINUTES = 15
_tables_ready = False


def _engine():
    return _database.local_engine


def _ensure_tables() -> bool:
    """Creates the local link tables once. Returns False when no local database is configured."""
    global _tables_ready
    engine = _engine()
    if engine is None:
        return False
    if _tables_ready:
        return True
    with engine.begin() as conn:
        conn.execute(sql("""
            CREATE TABLE IF NOT EXISTS telegram_link_codes (
                code TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                expires_at TEXT NOT NULL
            )
        """))
        conn.execute(sql("""
            CREATE TABLE IF NOT EXISTS telegram_chat_links (
                telegram_chat_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                telegram_username TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                linked_at TEXT NOT NULL
            )
        """))
    _tables_ready = True
    return True


def create_link_code(user_id: str) -> str:
    """One-time code for the t.me deep link. Replaces any earlier unused code for the same user."""
    code = secrets.token_urlsafe(12)
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=LINK_CODE_TTL_MINUTES)).isoformat()
    if _ensure_tables():
        with _engine().begin() as conn:
            conn.execute(sql("DELETE FROM telegram_link_codes WHERE user_id = :u"), {"u": user_id})
            conn.execute(
                sql("INSERT INTO telegram_link_codes (code, user_id, expires_at) VALUES (:c, :u, :e)"),
                {"c": code, "u": user_id, "e": expires_at},
            )
    else:
        _mock_link_codes[code] = {"user_id": user_id, "expires_at": expires_at}
    return code



def consume_link_code(code: str) -> Optional[str]:
    """Returns the user id the code was issued for and deletes it, or None if unknown/expired."""
    code = (code or "").strip()
    if not code:
        return None
    now = datetime.now(timezone.utc).isoformat()
    if _ensure_tables():
        with _engine().begin() as conn:
            row = conn.execute(
                sql("SELECT user_id, expires_at FROM telegram_link_codes WHERE code = :c"), {"c": code}
            ).fetchone()
            if not row:
                return None
            conn.execute(sql("DELETE FROM telegram_link_codes WHERE code = :c"), {"c": code})
            return row[0] if row[1] > now else None
    entry = _mock_link_codes.pop(code, None)
    if entry and entry["expires_at"] > now:
        return entry["user_id"]
    return None


def save_telegram_link(user_id: str, chat_id: str, username: Optional[str]) -> Dict[str, Any]:
    link = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "telegram_chat_id": chat_id,
        "telegram_username": username,
        "is_active": True,
        "linked_at": datetime.now(timezone.utc).isoformat(),
    }
    if supabase is not None:
        try:
            supabase.table("telegram_links").upsert(link, on_conflict="telegram_chat_id").execute()
        except Exception:
            _mock_telegram_links_db[chat_id] = link
    elif _ensure_tables():
        with _engine().begin() as conn:
            conn.execute(
                sql("""
                    INSERT INTO telegram_chat_links (telegram_chat_id, user_id, telegram_username, is_active, linked_at)
                    VALUES (:chat, :u, :name, 1, :at)
                    ON CONFLICT(telegram_chat_id) DO UPDATE SET
                        user_id = excluded.user_id, telegram_username = excluded.telegram_username,
                        is_active = 1, linked_at = excluded.linked_at
                """),
                {"chat": chat_id, "u": user_id, "name": username, "at": link["linked_at"]},
            )
    else:
        _mock_telegram_links_db[chat_id] = link
    return link


def get_active_telegram_link(user_id: str) -> Optional[Dict[str, Any]]:
    if supabase is not None:
        try:
            res = supabase.table("telegram_links").select("*").eq("user_id", user_id).eq("is_active", True).execute()
            if res.data:
                return res.data[0]
        except Exception:
            pass
    if _ensure_tables():
        with _engine().connect() as conn:
            row = conn.execute(
                sql("""
                    SELECT telegram_chat_id, user_id, telegram_username FROM telegram_chat_links
                    WHERE user_id = :u AND is_active = 1 ORDER BY linked_at DESC LIMIT 1
                """),
                {"u": user_id},
            ).fetchone()
        if row:
            return {"telegram_chat_id": row[0], "user_id": row[1], "telegram_username": row[2], "is_active": True}
    for link in _mock_telegram_links_db.values():
        if link.get("user_id") == user_id and link.get("is_active", True):
            return link
    return None


def deactivate_telegram_link(chat_id: str):
    if supabase is not None:
        try:
            supabase.table("telegram_links").update({"is_active": False}).eq("telegram_chat_id", chat_id).execute()
        except Exception:
            pass
    if _ensure_tables():
        with _engine().begin() as conn:
            conn.execute(sql("UPDATE telegram_chat_links SET is_active = 0 WHERE telegram_chat_id = :c"), {"c": chat_id})
    for link in _mock_telegram_links_db.values():
        if link.get("telegram_chat_id") == chat_id:
            link["is_active"] = False


def send_telegram_message(user_id: str, text: str, parse_mode: Optional[str] = "Markdown") -> Dict[str, Any]:
    """
    Sends Telegram message to user via Telegram Bot API HTTP request.
    Pass parse_mode=None for text that may contain Markdown control characters (names, medicines).
    """
    link = get_active_telegram_link(user_id)
    if not link:
        return {"success": False, "reason": "not_linked"}

    chat_id = link["telegram_chat_id"]

    if not TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN.startswith("123456789"):
        logger.info(f"[MOCK TELEGRAM MSG] Sent to User {user_id} (Chat ID: {chat_id}): '{text}'")
        return {"success": True}

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload: Dict[str, Any] = {"chat_id": chat_id, "text": text}
    if parse_mode:
        payload["parse_mode"] = parse_mode

    try:
        response = httpx.post(url, json=payload, timeout=5.0)
        res_data = response.json()
        if response.status_code == 200 and res_data.get("ok"):
            return {"success": True}
        else:
            logger.warning(f"Telegram API call failed: {res_data}")
            # If bot was blocked or chat not found, deactivate link
            err_desc = res_data.get("description", "").lower()
            if "forbidden" in err_desc or "blocked" in err_desc or "not found" in err_desc:
                deactivate_telegram_link(chat_id)
            return {"success": False, "reason": res_data.get("description", "telegram_api_error")}
    except Exception as e:
        logger.error(f"Failed to post to Telegram API: {e}")
        return {"success": False, "reason": str(e)}


def register_webhook(base_url: str) -> Dict[str, Any]:
    """Points the bot at <base_url>/notifications/telegram/webhook via Telegram's setWebhook."""
    if not TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN.startswith("123456789"):
        return {"success": False, "reason": "no_token"}
    body: Dict[str, Any] = {
        "url": f"{base_url.rstrip('/')}/notifications/telegram/webhook",
        "allowed_updates": ["message"],
    }
    if TELEGRAM_WEBHOOK_SECRET:
        body["secret_token"] = TELEGRAM_WEBHOOK_SECRET
    try:
        res = httpx.post(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/setWebhook", json=body, timeout=10.0).json()
        if res.get("ok"):
            return {"success": True, "url": body["url"]}
        return {"success": False, "reason": res.get("description", "telegram_api_error")}
    except Exception as e:
        return {"success": False, "reason": str(e)}
