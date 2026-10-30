"""SOS actions shared by the REST API, the Telegram bot and the escalation sweep."""
from typing import Any, Dict, Optional

from app.connected.realtime import elder_room_manager
from app.connected.storage import (
    audit,
    display_name,
    execute,
    fetch_all,
    fetch_one,
    get_link,
    linked_caregiver_ids,
    linked_hospital_ids,
    loads,
    notify,
    now_iso,
)


class SosActionError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def can_act_on_elder(user_id: str, role: Optional[str], elder_id: str) -> bool:
    if role == "caregiver":
        return get_link(elder_id, user_id, active_only=True) is not None
    if role == "hospital":
        return user_id in linked_hospital_ids(elder_id)
    return False


def acknowledge_sos(event_id: str, user_id: str, role: Optional[str]) -> Dict[str, Any]:
    """Marks an active SOS as acknowledged ("I'm on my way") and tells the elder and the other responders."""
    sos = fetch_one("SELECT * FROM connected_sos_events WHERE id = :id", {"id": event_id})
    if not sos:
        raise SosActionError("SOS_NOT_FOUND", "SOS event not found.")
    elder_id = sos["elder_id"]
    if not can_act_on_elder(user_id, role, elder_id):
        raise SosActionError("ELDER_ACCESS_DENIED", "You do not have permission for this elder's SOS.")
    if sos["status"] != "active":
        sos["location"] = loads(sos.get("location"), None)
        sos["already"] = True
        return sos

    now = now_iso()
    execute(
        """
        UPDATE connected_sos_events
        SET status = 'acknowledged', acknowledged_by = :by, acknowledged_at = :now, updated_at = :now
        WHERE id = :id AND status = 'active'
        """,
        {"id": event_id, "by": user_id, "now": now},
    )
    sos = fetch_one("SELECT * FROM connected_sos_events WHERE id = :id", {"id": event_id}) or sos
    sos["location"] = loads(sos.get("location"), None)
    by_name = display_name(user_id)
    audit(elder_id, user_id, "sos.acknowledged", "sos", event_id, {})
    others = [u for u in set(linked_caregiver_ids(elder_id)) if u != user_id]
    notify(
        [elder_id] + others,
        "sos_acknowledged",
        {"sos_event_id": event_id, "elder_id": elder_id, "acknowledged_by": user_id, "by_name": by_name},
    )
    elder_room_manager.emit_background(elder_id, "sos:acknowledged", sos)
    return sos


# Minutes an unacknowledged SOS may sit before each escalation re-alert, matching the default 0/2/5/10 tiers.
ESCALATION_MINUTES = (2, 5, 10)
ESCALATION_LABELS = {1: "caregiver follow-up", 2: "hospital desk", 3: "emergency services"}


def escalate_unacknowledged_sos() -> int:
    """Re-alerts everyone for SOS events nobody has acknowledged. Returns how many alerts were sent."""
    from datetime import datetime, timedelta, timezone

    sent = 0
    now = datetime.now(timezone.utc)
    rows = fetch_all("SELECT * FROM connected_sos_events WHERE status = 'active'")
    for sos in rows:
        level = int(sos.get("escalation_level") or 0)
        if level >= len(ESCALATION_MINUTES):
            continue
        try:
            triggered = datetime.fromisoformat(str(sos["triggered_at"]).replace("Z", "+00:00"))
        except ValueError:
            continue
        if triggered.tzinfo is None:
            triggered = triggered.replace(tzinfo=timezone.utc)
        if now < triggered + timedelta(minutes=ESCALATION_MINUTES[level]):
            continue

        elder_id = sos["elder_id"]
        next_level = level + 1
        execute(
            "UPDATE connected_sos_events SET escalation_level = :lvl, updated_at = :now WHERE id = :id AND status = 'active'",
            {"id": sos["id"], "lvl": next_level, "now": now_iso()},
        )
        recipients = list(set(linked_caregiver_ids(elder_id) + linked_hospital_ids(elder_id)))
        notify(
            recipients,
            "sos_escalated",
            {
                "sos_event_id": sos["id"],
                "elder_id": elder_id,
                "location": loads(sos.get("location"), None),
                "level": next_level,
                "minutes": ESCALATION_MINUTES[level],
                "stage": ESCALATION_LABELS.get(next_level, "escalation"),
            },
        )
        elder_room_manager.emit_background(elder_id, "sos:escalated", {"id": sos["id"], "level": next_level})
        sent += 1
    return sent
