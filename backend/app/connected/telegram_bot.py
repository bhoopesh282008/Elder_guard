"""Telegram side of the connected portals: alert formatting, button replies, /status and the daily summary."""
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.connected.sos_actions import SosActionError, acknowledge_sos
from app.connected.storage import (
    display_name,
    fetch_all,
    fetch_one,
    get_user,
    loads,
)
from app.notifications.channels.telegram import (
    answer_callback,
    edit_message_markup,
    get_active_telegram_link,
    get_user_id_for_chat,
    linked_user_ids,
    send_telegram_contact,
    send_telegram_location,
    send_telegram_message,
    send_to_chat,
)

logger = logging.getLogger("elderguard.telegram_bot")

# Alert types worth a phone buzz; the rest stay in-app only.
ALERT_TYPES = {
    "sos_triggered",
    "sos_acknowledged",
    "sos_escalated",
    "medicine_taken",
    "medicine_reminder",
    "caregiver_invite_accepted",
}

HELP_TEXT = (
    "ElderGuard AI bot\n\n"
    "/status - latest vitals, medicines and SOS for your elder\n"
    "/summary - today's care summary\n"
    "/help - this message\n\n"
    "SOS alerts arrive here automatically. Tap \"I'm on my way\" to let the family know."
)


# ---------- formatting ----------

def fmt_vital(vital: Dict[str, Any]) -> str:
    value = vital.get("value") or {}
    unit = vital.get("unit") or ""
    if isinstance(value, dict):
        if "systolic" in value and "diastolic" in value:
            text = f"{value['systolic']}/{value['diastolic']}"
        else:
            nums = [v for v in value.values() if isinstance(v, (int, float))]
            text = str(nums[0]) if nums else "-"
    else:
        text = str(value)
    label = str(vital.get("type", "vital")).replace("_", " ")
    flag = " ⚠" if vital.get("flagged") else ""
    return f"{label}: {text} {unit}".strip() + flag


def maps_url(location: Optional[Dict[str, Any]]) -> Optional[str]:
    if isinstance(location, dict) and location.get("lat") is not None and location.get("lng") is not None:
        return f"https://maps.google.com/?q={location['lat']},{location['lng']}"
    return None


def alert_text(type_: str, payload: Dict[str, Any]) -> Optional[str]:
    name = display_name(payload.get("elder_id"))
    if type_ == "sos_triggered":
        text = f"🚨 SOS from {name}. They pressed the emergency button."
        url = maps_url(payload.get("location"))
        return text + (f"\nLocation: {url}" if url else "")
    if type_ == "sos_acknowledged":
        return f"✅ {payload.get('by_name') or 'A caregiver'} is on the way to {name}."
    if type_ == "sos_escalated":
        text = f"🚨 STILL UNANSWERED after {payload.get('minutes')} min: SOS from {name}. Nobody has acknowledged it yet."
        url = maps_url(payload.get("location"))
        return text + (f"\nLocation: {url}" if url else "")
    if type_ == "medicine_taken":
        return f"💊 {name} marked a medicine as taken."
    if type_ == "medicine_reminder":
        return f"⏰ Medicine reminder for {name}."
    if type_ == "caregiver_invite_accepted":
        return f"🤝 {name} accepted your invite. You can now see their care dashboard."
    return None


def sos_buttons(event_id: str, location: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    row: List[Dict[str, Any]] = [{"text": "✅ I'm on my way", "callback_data": f"ack:{event_id}"}]
    url = maps_url(location)
    if url:
        row.append({"text": "📍 Open map", "url": url})
    return {"inline_keyboard": [row]}


# ---------- pushing alerts ----------

def push_alert(user_ids: List[str], type_: str, payload: Dict[str, Any]) -> None:
    """Sends one connected notification to every recipient that linked Telegram. Never raises."""
    try:
        text = alert_text(type_, payload)
        if not text:
            return
        for user_id in user_ids:
            if not get_active_telegram_link(user_id):
                continue
            user = get_user(user_id) or {}
            markup = None
            if type_ in ("sos_triggered", "sos_escalated") and user.get("role") in ("caregiver", "hospital"):
                markup = sos_buttons(payload.get("sos_event_id", ""), payload.get("location"))
            send_telegram_message(user_id, text, parse_mode=None, reply_markup=markup)
            if type_ == "sos_triggered":
                _send_location_and_contact(user_id, payload)
    except Exception:
        logger.exception("Telegram alert failed for %s", type_)


def _send_location_and_contact(user_id: str, payload: Dict[str, Any]) -> None:
    loc = payload.get("location")
    if isinstance(loc, dict) and loc.get("lat") is not None and loc.get("lng") is not None:
        try:
            send_telegram_location(user_id, float(loc["lat"]), float(loc["lng"]))
        except (TypeError, ValueError):
            pass
    elder = fetch_one(
        "SELECT ep.name, COALESCE(ep.phone_no, u.phone_no) AS phone FROM elder_profiles ep LEFT JOIN users u ON u.id = ep.user_id WHERE ep.user_id = :id",
        {"id": payload.get("elder_id")},
    )
    if elder and elder.get("phone"):
        send_telegram_contact(user_id, str(elder["phone"]), elder.get("name") or "Elder")


# ---------- incoming commands and button presses ----------

def _elders_for(user_id: str) -> List[str]:
    user = get_user(user_id) or {}
    if user.get("role") == "elder":
        return [user_id]
    rows = fetch_all("SELECT elder_id FROM elder_caregiver_links WHERE caregiver_id = :id AND status = 'active'", {"id": user_id})
    return [r["elder_id"] for r in rows]


def build_status(user_id: str) -> str:
    from app.connected.routes import _dashboard  # lazy: routes imports storage, which lazily imports this module

    elders = _elders_for(user_id)
    if not elders:
        return "No linked elder yet. Ask the elder to accept your invite in ElderGuard AI."
    blocks = []
    for elder_id in elders:
        dash = _dashboard(elder_id)
        meds = dash["today_medicines"]
        taken = sum(1 for m in meds if m.get("status") == "taken")
        vitals = ", ".join(fmt_vital(v) for v in dash["latest_vitals"][:3]) or "none logged yet"
        sos = dash["active_sos"]
        checkin = dash["today_checkin"]
        lines = [
            f"👤 {display_name(elder_id)}",
            f"💊 Medicines today: {taken}/{len(meds)} taken",
            f"❤️ Latest vitals: {vitals}",
            f"🙂 Check-in: {checkin['mood'] if checkin else 'not yet today'}",
            f"🚨 SOS: {('ACTIVE (' + sos['status'] + ')') if sos else 'none'}",
        ]
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def build_summary(user_id: str) -> str:
    from app.connected.routes import _dashboard

    elders = _elders_for(user_id)
    if not elders:
        return "No linked elder yet."
    day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    blocks = []
    for elder_id in elders:
        dash = _dashboard(elder_id)
        meds = dash["today_medicines"]
        taken = sum(1 for m in meds if m.get("status") == "taken")
        missed = [m["name"] for m in meds if m.get("status") != "taken"]
        todays_vitals = fetch_all(
            "SELECT * FROM connected_vitals WHERE elder_id = :id AND recorded_at >= :d ORDER BY recorded_at DESC",
            {"id": elder_id, "d": day_start},
        )
        flagged = [v for v in todays_vitals if v.get("flagged")]
        sos_today = fetch_all(
            "SELECT id FROM connected_sos_events WHERE elder_id = :id AND triggered_at >= :d", {"id": elder_id, "d": day_start}
        )
        checkin = dash["today_checkin"]
        lines = [
            f"📋 Daily summary for {display_name(elder_id)}",
            f"💊 Medicines: {taken}/{len(meds)} taken" + (f" (still pending: {', '.join(missed)})" if missed else ""),
            f"❤️ Vitals logged: {len(todays_vitals)}" + (f", {len(flagged)} flagged ⚠" if flagged else ""),
            f"🙂 Check-in: {checkin['mood'] if checkin else 'not done today'}",
            f"🚨 SOS events today: {len(sos_today)}",
        ]
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def handle_message(chat_id: str, text: str) -> None:
    """Handles /status, /summary and /help from a linked chat."""
    command = text.strip().split()[0].split("@")[0].lower() if text.strip() else ""
    user_id = get_user_id_for_chat(chat_id)
    if command == "/help":
        send_to_chat(chat_id, HELP_TEXT)
        return
    if not user_id:
        send_to_chat(chat_id, "This chat is not linked yet. Open ElderGuard AI and tap Connect Telegram.")
        return
    if command == "/status":
        send_to_chat(chat_id, build_status(user_id))
    elif command == "/summary":
        send_to_chat(chat_id, build_summary(user_id))
    else:
        send_to_chat(chat_id, HELP_TEXT)


def handle_callback(callback: Dict[str, Any]) -> None:
    """Handles the 'I'm on my way' button on an SOS alert."""
    callback_id = callback.get("id", "")
    data = callback.get("data", "")
    message = callback.get("message") or {}
    chat_id = str((message.get("chat") or {}).get("id") or "")
    user_id = get_user_id_for_chat(chat_id) if chat_id else None
    if not data.startswith("ack:"):
        answer_callback(callback_id, "Unknown action.")
        return
    if not user_id:
        answer_callback(callback_id, "This chat is not linked to an ElderGuard account.")
        return
    role = (get_user(user_id) or {}).get("role")
    try:
        result = acknowledge_sos(data[4:], user_id, role)
    except SosActionError as e:
        answer_callback(callback_id, e.message)
        return
    answer_callback(callback_id, "Already acknowledged." if result.get("already") else "Thanks! The family has been told you're on the way.")
    if message.get("message_id"):
        edit_message_markup(chat_id, message["message_id"])  # remove the button so it cannot be pressed twice


# ---------- scheduled jobs ----------

def send_daily_summaries() -> int:
    """Pushes the daily summary to every user with a linked Telegram chat. Returns the number sent."""
    sent = 0
    for user_id in linked_user_ids():
        try:
            if send_telegram_message(user_id, build_summary(user_id), parse_mode=None).get("success"):
                sent += 1
        except Exception:
            logger.exception("Daily summary failed for %s", user_id)
    return sent
