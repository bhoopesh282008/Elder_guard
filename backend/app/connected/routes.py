from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status

from app.connected.realtime import elder_room_manager
from app.connected.sos_actions import SosActionError, acknowledge_sos
from app.connected.schemas import (
    AppointmentCreateRequest,
    CheckInRequest,
    InviteAcceptRequest,
    InviteRequest,
    MedicineCreateRequest,
    MedicineTakenRequest,
    MessageCreateRequest,
    ReminderCreateRequest,
    SOSResolveRequest,
    SOSTriggerRequest,
    VitalCreateRequest,
)
from app.connected.storage import (
    audit,
    dumps,
    ensure_elder_access,
    execute,
    fetch_all,
    fetch_one,
    find_elder,
    get_elder_profile,
    get_user,
    linked_caregiver_ids,
    linked_hospital_ids,
    loads,
    new_id,
    normalize_link,
    notify,
    now_iso,
    parse_medicine,
    parse_notification,
    parse_vital,
    range_start,
    require_role,
    initialize_connected_schema,
)
from app.core.security import get_current_user, verify_jwt_token

router = APIRouter(prefix="/api", tags=["Connected Portals"])
ws_router = APIRouter(tags=["Connected Realtime"])

initialize_connected_schema()


def _flag_vital(vital_type: str, value: Dict[str, Any], elder_id: str) -> bool:
    target = fetch_one(
        """
        SELECT min_value, max_value FROM vital_target_ranges
        WHERE elder_id = :elder_id AND vital_type = :vital_type
        ORDER BY created_at DESC LIMIT 1
        """,
        {"elder_id": elder_id, "vital_type": vital_type},
    )
    if target:
        number = value.get("value")
        if number is None and vital_type == "bp":
            number = value.get("systolic")
        try:
            numeric = float(number)
            if target.get("min_value") is not None and numeric < float(target["min_value"]):
                return True
            if target.get("max_value") is not None and numeric > float(target["max_value"]):
                return True
        except Exception:
            return False
    if vital_type == "bp":
        return float(value.get("systolic", 0) or 0) > 140 or float(value.get("diastolic", 0) or 0) > 90
    if vital_type == "heart_rate":
        return float(value.get("value", 0) or 0) < 50 or float(value.get("value", 0) or 0) > 100
    if vital_type == "spo2":
        return float(value.get("value", 100) or 100) < 95
    if vital_type == "sugar":
        return float(value.get("value", 0) or 0) < 70 or float(value.get("value", 0) or 0) > 180
    return False


def _medicine_rows(elder_id: str) -> List[Dict[str, Any]]:
    rows = fetch_all(
        "SELECT * FROM connected_medicines WHERE elder_id = :elder_id AND is_active = 1 ORDER BY created_at DESC",
        {"elder_id": elder_id},
    )
    meds = [parse_medicine(row) for row in rows]
    day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    taken_counts: Dict[str, int] = {}
    for log in fetch_all(
        "SELECT medicine_id FROM medicine_logs WHERE elder_id = :elder_id AND status = 'taken' AND taken_at >= :day_start",
        {"elder_id": elder_id, "day_start": day_start},
    ):
        taken_counts[log["medicine_id"]] = taken_counts.get(log["medicine_id"], 0) + 1
    for med in meds:
        doses_today = max(1, len(med.get("scheduled_times") or []))
        med["status"] = "taken" if taken_counts.get(med["id"], 0) >= doses_today else "pending"
    return meds


def _latest_vitals(elder_id: str) -> List[Dict[str, Any]]:
    rows = fetch_all(
        """
        SELECT * FROM connected_vitals
        WHERE elder_id = :elder_id
        ORDER BY recorded_at DESC LIMIT 12
        """,
        {"elder_id": elder_id},
    )
    return [parse_vital(row) for row in rows]


def _upcoming_appointments(elder_id: str) -> List[Dict[str, Any]]:
    rows = fetch_all(
        """
        SELECT * FROM connected_appointments
        WHERE elder_id = :elder_id AND status = 'upcoming'
        ORDER BY scheduled_at ASC LIMIT 5
        """,
        {"elder_id": elder_id},
    )
    if not rows:
        try:
            from app.appointments.service import list_appointments_for_user
            core_appts = list_appointments_for_user({"user_id": elder_id, "role": "elder"}, elder_id=elder_id)
            for ca in core_appts:
                rows.append({
                    "id": ca.id,
                    "elder_id": ca.elder_id,
                    "scheduled_at": f"{ca.appointment_date} at {ca.start_time}",
                    "status": ca.status.value,
                    "doctor_id": ca.doctor_id,
                    "mode": ca.mode.value
                })
        except Exception:
            pass
    return rows


def _dashboard(elder_id: str) -> Dict[str, Any]:
    today = datetime.now(timezone.utc).date().isoformat()
    checkin = fetch_one(
        "SELECT * FROM checkins WHERE elder_id = :elder_id AND date = :today ORDER BY timestamp DESC LIMIT 1",
        {"elder_id": elder_id, "today": today},
    )
    reminders = fetch_all(
        """
        SELECT * FROM connected_reminders
        WHERE elder_id = :elder_id AND status IN ('pending', 'sent')
        ORDER BY scheduled_time ASC LIMIT 10
        """,
        {"elder_id": elder_id},
    )
    active_sos = fetch_one(
        "SELECT * FROM connected_sos_events WHERE elder_id = :elder_id AND status IN ('active', 'acknowledged') ORDER BY triggered_at DESC LIMIT 1",
        {"elder_id": elder_id},
    )
    return {
        "elder": get_elder_profile(elder_id),
        "today_medicines": _medicine_rows(elder_id),
        "latest_vitals": _latest_vitals(elder_id),
        "upcoming_appointments": _upcoming_appointments(elder_id),
        "unread_reminders": reminders,
        "today_checkin": checkin,
        "active_sos": {**active_sos, "location": loads(active_sos.get("location"), None)} if active_sos else None,
    }


@router.post("/caregiver/invite", status_code=status.HTTP_201_CREATED)
def invite_elder(payload: InviteRequest, current_user: dict = Depends(get_current_user)):
    require_role(current_user, ["caregiver"])
    elder = find_elder(payload.elder_identifier)
    if not elder:
        raise HTTPException(status_code=404, detail={"error": {"code": "ELDER_NOT_FOUND", "message": "No elder account matches that identifier."}})

    caregiver_id = current_user["user_id"]
    link_id = new_id()
    created = now_iso()
    existing = fetch_one(
        "SELECT * FROM elder_caregiver_links WHERE elder_id = :elder_id AND caregiver_id = :caregiver_id LIMIT 1",
        {"elder_id": elder["id"], "caregiver_id": caregiver_id},
    )
    if existing:
        if existing.get("status") == "active":
            return normalize_link(existing)
        # Pending, declined or revoked: ask the elder again. Access is only granted by their acceptance.
        execute(
            """
            UPDATE elder_caregiver_links
            SET status = 'pending', permission_level = :permission_level, invited_by = :invited_by, invited_at = :now, updated_at = :now
            WHERE id = :id
            """,
            {"id": existing["id"], "permission_level": payload.permission_level, "invited_by": caregiver_id, "now": created},
        )
        link_id = existing["id"]
    else:
        execute(
            """
            INSERT INTO elder_caregiver_links
            (id, elder_id, caregiver_id, permission_level, status, invited_by, invited_at, accepted_at, created_at, updated_at)
            VALUES (:id, :elder_id, :caregiver_id, :permission_level, 'pending', :invited_by, :invited_at, NULL, :created_at, :updated_at)
            """,
            {
                "id": link_id,
                "elder_id": elder["id"],
                "caregiver_id": caregiver_id,
                "permission_level": payload.permission_level,
                "invited_by": caregiver_id,
                "invited_at": created,
                "created_at": created,
                "updated_at": created,
            },
        )
    caregiver_profile = fetch_one("SELECT name FROM caregiver_profiles WHERE user_id = :id", {"id": caregiver_id}) or {}
    caregiver_name = caregiver_profile.get("name") or (get_user(caregiver_id) or {}).get("email") or "A caregiver"
    audit(elder["id"], caregiver_id, "elder.invited", "elder_caregiver_link", link_id, {"permission_level": payload.permission_level})
    notify([elder["id"]], "caregiver_invite", {"link_id": link_id, "caregiver_id": caregiver_id, "caregiver_name": caregiver_name, "permission_level": payload.permission_level})
    elder_room_manager.emit_background(elder["id"], "link:invited", {"link_id": link_id, "caregiver_name": caregiver_name})
    return normalize_link(fetch_one("SELECT * FROM elder_caregiver_links WHERE id = :id", {"id": link_id}) or {})


@router.get("/elder/invites")
def list_pending_invites(current_user: dict = Depends(get_current_user)):
    require_role(current_user, ["elder"])
    rows = fetch_all(
        """
        SELECT l.id, l.caregiver_id, l.permission_level, l.invited_at, cp.name AS caregiver_name, cp.relationship_to_elder, u.email AS caregiver_email
        FROM elder_caregiver_links l
        LEFT JOIN caregiver_profiles cp ON cp.user_id = l.caregiver_id
        LEFT JOIN users u ON u.id = l.caregiver_id
        WHERE l.elder_id = :elder_id AND l.status = 'pending'
        ORDER BY l.invited_at DESC
        """,
        {"elder_id": current_user["user_id"]},
    )
    return rows


@router.post("/elder/invites/{link_id}/decline")
def decline_invite(link_id: str, current_user: dict = Depends(get_current_user)):
    require_role(current_user, ["elder"])
    link = fetch_one("SELECT * FROM elder_caregiver_links WHERE id = :id LIMIT 1", {"id": link_id})
    if not link or link["elder_id"] != current_user["user_id"]:
        raise HTTPException(status_code=404, detail={"error": {"code": "INVITE_NOT_FOUND", "message": "Invite not found for this elder."}})
    if link.get("status") != "pending":
        raise HTTPException(status_code=409, detail={"error": {"code": "INVITE_NOT_PENDING", "message": "This invite is no longer pending."}})
    execute("UPDATE elder_caregiver_links SET status = 'declined', updated_at = :now WHERE id = :id", {"id": link_id, "now": now_iso()})
    execute(
        "UPDATE connected_notifications SET read = 1 WHERE user_id = :elder_id AND type = 'caregiver_invite' AND payload LIKE :m",
        {"elder_id": link["elder_id"], "m": f"%{link_id}%"},
    )
    audit(link["elder_id"], link["elder_id"], "elder.invite_declined", "elder_caregiver_link", link_id, {})
    return {"id": link_id, "status": "declined"}


@router.post("/elder/invites/{link_id}/accept")
def accept_invite(link_id: str, payload: InviteAcceptRequest, current_user: dict = Depends(get_current_user)):
    require_role(current_user, ["elder"])
    link = fetch_one("SELECT * FROM elder_caregiver_links WHERE id = :id LIMIT 1", {"id": link_id})
    if not link or link["elder_id"] != current_user["user_id"]:
        raise HTTPException(status_code=404, detail={"error": {"code": "INVITE_NOT_FOUND", "message": "Invite not found for this elder."}})
    if link.get("status") == "active":
        return normalize_link(link)
    accepted_at = now_iso()
    permission = payload.permission_level or link.get("permission_level") or "full_access"
    execute(
        """
        UPDATE elder_caregiver_links
        SET status = 'active', permission_level = :permission, accepted_at = :accepted_at, updated_at = :accepted_at
        WHERE id = :id
        """,
        {"id": link_id, "permission": permission, "accepted_at": accepted_at},
    )
    execute(
        """
        UPDATE connected_notifications
        SET read = 1
        WHERE user_id = :elder_id AND type = 'caregiver_invite' AND payload LIKE :link_match
        """,
        {"elder_id": link["elder_id"], "link_match": f"%{link_id}%"},
    )
    notify([link["caregiver_id"]], "caregiver_invite_accepted", {"elder_id": link["elder_id"], "permission_level": permission})
    elder_room_manager.emit_background(link["elder_id"], "link:accepted", {"caregiver_id": link["caregiver_id"], "permission_level": permission})
    return normalize_link(fetch_one("SELECT * FROM elder_caregiver_links WHERE id = :id", {"id": link_id}) or {})


@router.get("/caregiver/elders")
def caregiver_elders(current_user: dict = Depends(get_current_user)):
    require_role(current_user, ["caregiver"])
    rows = fetch_all(
        """
        SELECT l.*, ep.name, ep.profile_pic_url, ep.elder_id AS public_elder_id, ep.age_or_dob
        FROM elder_caregiver_links l
        LEFT JOIN elder_profiles ep ON ep.user_id = l.elder_id
        WHERE l.caregiver_id = :caregiver_id AND l.status = 'active'
        ORDER BY l.accepted_at DESC, l.created_at DESC
        """,
        {"caregiver_id": current_user["user_id"]},
    )
    elders = []
    for row in rows:
        dashboard = _dashboard(row["elder_id"])
        latest_vitals = dashboard["latest_vitals"]
        elders.append(
            {
                "id": row["elder_id"],
                "user_id": row["elder_id"],
                "elder_id": row.get("public_elder_id") or row["elder_id"],
                "name": row.get("name") or f"Elder {row['elder_id'][:6]}",
                "profile_pic_url": row.get("profile_pic_url"),
                "permission_level": row.get("permission_level"),
                "status": "Connected",
                "latest_vitals": latest_vitals,
                "active_sos": dashboard["active_sos"],
                "today_checkin": dashboard["today_checkin"],
            }
        )
    return elders


@router.get("/elder/dashboard")
def elder_dashboard(current_user: dict = Depends(get_current_user)):
    require_role(current_user, ["elder"])
    return _dashboard(current_user["user_id"])


@router.get("/caregiver/elders/{elder_id}/dashboard")
def caregiver_dashboard(elder_id: str, current_user: dict = Depends(get_current_user)):
    ensure_elder_access(current_user, elder_id, write=False)
    return _dashboard(elder_id)


@router.get("/elder/medicines")
def elder_medicines(current_user: dict = Depends(get_current_user)):
    require_role(current_user, ["elder"])
    return _medicine_rows(current_user["user_id"])


@router.get("/elder/vitals")
def elder_vitals(range: str = Query("7d"), current_user: dict = Depends(get_current_user)):
    require_role(current_user, ["elder"])
    rows = fetch_all(
        """
        SELECT * FROM connected_vitals
        WHERE elder_id = :elder_id AND recorded_at >= :start
        ORDER BY recorded_at DESC
        """,
        {"elder_id": current_user["user_id"], "start": range_start(range)},
    )
    return [parse_vital(row) for row in rows]


@router.get("/elder/appointments")
def elder_appointments(current_user: dict = Depends(get_current_user)):
    require_role(current_user, ["elder"])
    return fetch_all(
        "SELECT * FROM connected_appointments WHERE elder_id = :elder_id ORDER BY scheduled_at ASC",
        {"elder_id": current_user["user_id"]},
    )


@router.post("/elder/appointments", status_code=status.HTTP_201_CREATED)
def elder_book_appointment(payload: AppointmentCreateRequest, current_user: dict = Depends(get_current_user)):
    require_role(current_user, ["elder"])
    return _book_connected_appointment(current_user["user_id"], payload, current_user)


@router.post("/caregiver/elders/{elder_id}/medicines", status_code=status.HTTP_201_CREATED)
def caregiver_create_medicine(elder_id: str, payload: MedicineCreateRequest, current_user: dict = Depends(get_current_user)):
    ensure_elder_access(current_user, elder_id, write=True)
    med_id = new_id()
    created = now_iso()
    scheduled = payload.scheduled_times or ["08:00"]
    execute(
        """
        INSERT INTO connected_medicines
        (id, elder_id, name, dosage, frequency, scheduled_times, instructions, stock_count, low_stock_threshold, is_active, added_by, performed_by, created_at, updated_at)
        VALUES (:id, :elder_id, :name, :dosage, :frequency, :scheduled_times, :instructions, :stock_count, :low_stock_threshold, 1, :added_by, :performed_by, :created_at, :updated_at)
        """,
        {
            "id": med_id,
            "elder_id": elder_id,
            "name": payload.name,
            "dosage": payload.dosage,
            "frequency": payload.frequency,
            "scheduled_times": dumps(scheduled),
            "instructions": payload.instructions,
            "stock_count": payload.stock_count,
            "low_stock_threshold": payload.low_stock_threshold,
            "added_by": current_user["user_id"],
            "performed_by": current_user["user_id"],
            "created_at": created,
            "updated_at": created,
        },
    )
    medicine = parse_medicine(fetch_one("SELECT * FROM connected_medicines WHERE id = :id", {"id": med_id}) or {})
    audit(elder_id, current_user["user_id"], "medicine.added", "medicine", med_id, medicine)
    notify([elder_id], "medicine_added", {"medicine_id": med_id, "name": payload.name})
    elder_room_manager.emit_background(elder_id, "medicine:added", medicine)
    return medicine


@router.post("/elder/medicines/{medicine_id}/mark-taken", status_code=status.HTTP_201_CREATED)
def elder_mark_taken(medicine_id: str, payload: MedicineTakenRequest, current_user: dict = Depends(get_current_user)):
    require_role(current_user, ["elder"])
    med = fetch_one("SELECT * FROM connected_medicines WHERE id = :id AND elder_id = :elder_id", {"id": medicine_id, "elder_id": current_user["user_id"]})
    if not med:
        raise HTTPException(status_code=404, detail={"error": {"code": "MEDICINE_NOT_FOUND", "message": "Medicine not found."}})
    taken_at = now_iso()
    # A double-click or retry within a minute is the same dose: return it without logging or notifying again.
    recent = fetch_one(
        "SELECT * FROM medicine_logs WHERE medicine_id = :id AND status = 'taken' AND taken_at >= :since ORDER BY taken_at DESC LIMIT 1",
        {"id": medicine_id, "since": (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()},
    )
    if recent:
        return {"id": recent["id"], "medicine_id": medicine_id, "elder_id": current_user["user_id"], "scheduled_time": recent["scheduled_time"], "status": "taken", "taken_at": recent["taken_at"]}
    log_id = new_id()
    scheduled_time = payload.scheduled_time or taken_at
    execute(
        """
        INSERT INTO medicine_logs (id, medicine_id, elder_id, scheduled_time, status, taken_at, logged_by, created_at)
        VALUES (:id, :medicine_id, :elder_id, :scheduled_time, 'taken', :taken_at, :logged_by, :created_at)
        """,
        {"id": log_id, "medicine_id": medicine_id, "elder_id": current_user["user_id"], "scheduled_time": scheduled_time, "taken_at": taken_at, "logged_by": current_user["user_id"], "created_at": taken_at},
    )
    event_payload = {"id": log_id, "medicine_id": medicine_id, "elder_id": current_user["user_id"], "scheduled_time": scheduled_time, "status": "taken", "taken_at": taken_at}
    notify(linked_caregiver_ids(current_user["user_id"]), "medicine_taken", event_payload)
    elder_room_manager.emit_background(current_user["user_id"], "medicine:taken", event_payload)
    return event_payload


@router.post("/caregiver/elders/{elder_id}/medicines/{medicine_id}/send-reminder", status_code=status.HTTP_201_CREATED)
def send_medicine_reminder(elder_id: str, medicine_id: str, current_user: dict = Depends(get_current_user)):
    ensure_elder_access(current_user, elder_id, write=True)
    med = fetch_one("SELECT * FROM connected_medicines WHERE id = :id AND elder_id = :elder_id", {"id": medicine_id, "elder_id": elder_id})
    if not med:
        raise HTTPException(status_code=404, detail={"error": {"code": "MEDICINE_NOT_FOUND", "message": "Medicine not found."}})
    reminder_id = new_id()
    created = now_iso()
    payload = {"medicine_id": medicine_id, "medicine_name": med["name"], "sent_by": current_user["user_id"]}
    execute(
        """
        INSERT INTO connected_reminders (id, elder_id, type, scheduled_time, status, created_by, payload, created_at, updated_at)
        VALUES (:id, :elder_id, 'medicine', :scheduled_time, 'sent', :created_by, :payload, :created_at, :updated_at)
        """,
        {"id": reminder_id, "elder_id": elder_id, "scheduled_time": created, "created_by": current_user["user_id"], "payload": dumps(payload), "created_at": created, "updated_at": created},
    )
    notify([elder_id], "medicine_reminder", payload)
    audit(elder_id, current_user["user_id"], "medicine.reminder_sent", "medicine", medicine_id, payload)
    elder_room_manager.emit_background(elder_id, "reminder:sent", {"id": reminder_id, **payload})
    return {"id": reminder_id, **payload}


@router.get("/caregiver/elders/{elder_id}/vitals")
def caregiver_vitals(elder_id: str, range: str = Query("7d"), current_user: dict = Depends(get_current_user)):
    ensure_elder_access(current_user, elder_id, write=False)
    rows = fetch_all(
        """
        SELECT * FROM connected_vitals
        WHERE elder_id = :elder_id AND recorded_at >= :start
        ORDER BY recorded_at ASC
        """,
        {"elder_id": elder_id, "start": range_start(range)},
    )
    vitals = [parse_vital(row) for row in rows]
    numeric_values: Dict[str, List[float]] = {}
    for row in vitals:
        value = row["value"].get("value")
        if value is None and row["type"] == "bp":
            value = row["value"].get("systolic")
        try:
            numeric_values.setdefault(row["type"], []).append(float(value))
        except Exception:
            pass
    aggregates = {
        key: {"avg": sum(values) / len(values), "min": min(values), "max": max(values)}
        for key, values in numeric_values.items()
        if values
    }
    return {"items": vitals, "aggregates": aggregates}


@router.post("/elder/vitals", status_code=status.HTTP_201_CREATED)
def elder_log_vital(payload: VitalCreateRequest, current_user: dict = Depends(get_current_user)):
    require_role(current_user, ["elder"])
    return _create_vital(current_user["user_id"], payload, current_user)


def _create_vital(elder_id: str, payload: VitalCreateRequest, current_user: dict) -> Dict[str, Any]:
    ensure_elder_access(current_user, elder_id, write=True)
    vital_id = new_id()
    recorded_at = payload.recorded_at or now_iso()
    flagged = _flag_vital(payload.type, payload.value, elder_id)
    execute(
        """
        INSERT INTO connected_vitals (id, elder_id, type, value, unit, recorded_at, source, flagged, created_at)
        VALUES (:id, :elder_id, :type, :value, :unit, :recorded_at, :source, :flagged, :created_at)
        """,
        {"id": vital_id, "elder_id": elder_id, "type": payload.type, "value": dumps(payload.value), "unit": payload.unit, "recorded_at": recorded_at, "source": payload.source, "flagged": 1 if flagged else 0, "created_at": now_iso()},
    )
    vital = parse_vital(fetch_one("SELECT * FROM connected_vitals WHERE id = :id", {"id": vital_id}) or {})
    recipients = linked_caregiver_ids(elder_id)
    notify(recipients, "vital_logged", {"vital_id": vital_id, "flagged": flagged, "type": payload.type})
    elder_room_manager.emit_background(elder_id, "vital:logged", vital)
    return vital


@router.post("/elder/sos", status_code=status.HTTP_201_CREATED)
def elder_trigger_sos(payload: SOSTriggerRequest, current_user: dict = Depends(get_current_user)):
    require_role(current_user, ["elder"])
    elder_id = current_user["user_id"]
    active = fetch_one(
        "SELECT * FROM connected_sos_events WHERE elder_id = :elder_id AND status IN ('active', 'acknowledged') ORDER BY triggered_at DESC LIMIT 1",
        {"elder_id": elder_id},
    )
    if active:
        active["location"] = loads(active.get("location"), None)
        return active
    event_id = new_id()
    created = now_iso()
    caregivers = linked_caregiver_ids(elder_id)
    hospitals = linked_hospital_ids(elder_id)
    recipients = list(set(caregivers + hospitals))
    execute(
        """
        INSERT INTO connected_sos_events
        (id, elder_id, triggered_at, location, status, caregiver_notified_at, resolved_by, resolution_notes, created_at, updated_at)
        VALUES (:id, :elder_id, :triggered_at, :location, 'active', :caregiver_notified_at, NULL, NULL, :created_at, :updated_at)
        """,
        {"id": event_id, "elder_id": elder_id, "triggered_at": created, "location": dumps(payload.location), "caregiver_notified_at": created if recipients else None, "created_at": created, "updated_at": created},
    )
    sos = fetch_one("SELECT * FROM connected_sos_events WHERE id = :id", {"id": event_id}) or {}
    sos["location"] = loads(sos.get("location"), None)
    notify(recipients, "sos_triggered", {"sos_event_id": event_id, "elder_id": elder_id, "location": sos["location"]})
    elder_room_manager.emit_background(elder_id, "sos:triggered", sos)
    return sos


@router.post("/caregiver/elders/{elder_id}/sos/{event_id}/acknowledge")
def caregiver_acknowledge_sos(elder_id: str, event_id: str, current_user: dict = Depends(get_current_user)):
    require_role(current_user, ["caregiver", "hospital"])
    event = fetch_one("SELECT elder_id FROM connected_sos_events WHERE id = :id", {"id": event_id})
    if not event or event["elder_id"] != elder_id:
        raise HTTPException(status_code=404, detail={"error": {"code": "SOS_NOT_FOUND", "message": "SOS event not found."}})
    try:
        sos = acknowledge_sos(event_id, current_user["user_id"], current_user.get("role"))
    except SosActionError as e:
        code = status.HTTP_404_NOT_FOUND if e.code == "SOS_NOT_FOUND" else status.HTTP_403_FORBIDDEN
        raise HTTPException(status_code=code, detail={"error": {"code": e.code, "message": e.message}})
    return sos


@router.post("/caregiver/elders/{elder_id}/sos/{event_id}/resolve")
def caregiver_resolve_sos(elder_id: str, event_id: str, payload: SOSResolveRequest, current_user: dict = Depends(get_current_user)):
    ensure_elder_access(current_user, elder_id, write=True)
    updated = now_iso()
    execute(
        """
        UPDATE connected_sos_events
        SET status = 'resolved', resolved_by = :resolved_by, resolution_notes = :resolution_notes, updated_at = :updated_at
        WHERE id = :id AND elder_id = :elder_id
        """,
        {"id": event_id, "elder_id": elder_id, "resolved_by": current_user["user_id"], "resolution_notes": payload.resolution_notes, "updated_at": updated},
    )
    sos = fetch_one("SELECT * FROM connected_sos_events WHERE id = :id", {"id": event_id})
    if not sos:
        raise HTTPException(status_code=404, detail={"error": {"code": "SOS_NOT_FOUND", "message": "SOS event not found."}})
    sos["location"] = loads(sos.get("location"), None)
    audit(elder_id, current_user["user_id"], "sos.resolved", "sos", event_id, payload.model_dump())
    elder_room_manager.emit_background(elder_id, "sos:resolved", sos)
    return sos


@router.post("/elder/checkin", status_code=status.HTTP_201_CREATED)
def elder_checkin(payload: CheckInRequest, current_user: dict = Depends(get_current_user)):
    require_role(current_user, ["elder"])
    checkin_id = new_id()
    timestamp = now_iso()
    date = datetime.now(timezone.utc).date().isoformat()
    execute(
        """
        INSERT INTO checkins (id, elder_id, date, mood, ok_status, timestamp, created_at)
        VALUES (:id, :elder_id, :date, :mood, :ok_status, :timestamp, :created_at)
        """,
        {"id": checkin_id, "elder_id": current_user["user_id"], "date": date, "mood": payload.mood, "ok_status": 1 if payload.ok_status else 0, "timestamp": timestamp, "created_at": timestamp},
    )
    checkin = fetch_one("SELECT * FROM checkins WHERE id = :id", {"id": checkin_id}) or {}
    notify(linked_caregiver_ids(current_user["user_id"]), "checkin_submitted", checkin)
    elder_room_manager.emit_background(current_user["user_id"], "checkin:submitted", checkin)
    return checkin


@router.post("/caregiver/elders/{elder_id}/appointments", status_code=status.HTTP_201_CREATED)
def caregiver_book_appointment(elder_id: str, payload: AppointmentCreateRequest, current_user: dict = Depends(get_current_user)):
    ensure_elder_access(current_user, elder_id, write=True)
    return _book_connected_appointment(elder_id, payload, current_user)


def _book_connected_appointment(elder_id: str, payload: AppointmentCreateRequest, current_user: dict) -> Dict[str, Any]:
    ensure_elder_access(current_user, elder_id, write=True)
    appt_id = new_id()
    created = now_iso()
    execute(
        """
        INSERT INTO connected_appointments
        (id, elder_id, doctor_id, hospital_id, scheduled_at, mode, status, notes, performed_by, created_at, updated_at)
        VALUES (:id, :elder_id, :doctor_id, :hospital_id, :scheduled_at, :mode, 'upcoming', :notes, :performed_by, :created_at, :updated_at)
        """,
        {"id": appt_id, "elder_id": elder_id, "doctor_id": payload.doctor_id, "hospital_id": payload.hospital_id, "scheduled_at": payload.scheduled_at, "mode": payload.mode, "notes": payload.notes, "performed_by": current_user["user_id"], "created_at": created, "updated_at": created},
    )
    appt = fetch_one("SELECT * FROM connected_appointments WHERE id = :id", {"id": appt_id}) or {}
    notify([elder_id], "appointment_booked", {"appointment_id": appt_id, "scheduled_at": payload.scheduled_at})
    if current_user.get("role") == "caregiver":
        audit(elder_id, current_user["user_id"], "appointment.booked", "appointment", appt_id, payload.model_dump())
    elder_room_manager.emit_background(elder_id, "appointment:booked", appt)
    return appt


@router.get("/caregiver/elders/{elder_id}/alerts")
def caregiver_alerts(elder_id: str, current_user: dict = Depends(get_current_user)):
    ensure_elder_access(current_user, elder_id, write=False)
    sos = fetch_all("SELECT * FROM connected_sos_events WHERE elder_id = :elder_id ORDER BY triggered_at DESC LIMIT 20", {"elder_id": elder_id})
    vitals = [parse_vital(row) for row in fetch_all("SELECT * FROM connected_vitals WHERE elder_id = :elder_id AND flagged = 1 ORDER BY recorded_at DESC LIMIT 20", {"elder_id": elder_id})]
    missed = fetch_all("SELECT * FROM medicine_logs WHERE elder_id = :elder_id AND status = 'missed' ORDER BY scheduled_time DESC LIMIT 20", {"elder_id": elder_id})
    return {"sos": sos, "flagged_vitals": vitals, "missed_medicines": missed}


@router.post("/messages", status_code=status.HTTP_201_CREATED)
def create_message(payload: MessageCreateRequest, current_user: dict = Depends(get_current_user)):
    ensure_elder_access(current_user, payload.elder_context_id, write=False)
    msg_id = new_id()
    sent_at = now_iso()
    execute(
        """
        INSERT INTO connected_messages (id, sender_id, receiver_id, elder_context_id, content, attachment_url, sent_at, read_at)
        VALUES (:id, :sender_id, :receiver_id, :elder_context_id, :content, :attachment_url, :sent_at, NULL)
        """,
        {"id": msg_id, "sender_id": current_user["user_id"], "receiver_id": payload.receiver_id, "elder_context_id": payload.elder_context_id, "content": payload.content, "attachment_url": payload.attachment_url, "sent_at": sent_at},
    )
    message = fetch_one("SELECT * FROM connected_messages WHERE id = :id", {"id": msg_id}) or {}
    notify([payload.receiver_id], "message_new", {"message_id": msg_id, "elder_context_id": payload.elder_context_id})
    elder_room_manager.emit_background(payload.elder_context_id, "message:new", message)
    return message


@router.get("/messages")
def list_messages(elder_context_id: str = Query(...), current_user: dict = Depends(get_current_user)):
    ensure_elder_access(current_user, elder_context_id, write=False)
    return fetch_all(
        "SELECT * FROM connected_messages WHERE elder_context_id = :elder_context_id ORDER BY sent_at ASC LIMIT 100",
        {"elder_context_id": elder_context_id},
    )


@router.get("/notifications")
def list_notifications(current_user: dict = Depends(get_current_user)):
    rows = fetch_all(
        "SELECT * FROM connected_notifications WHERE user_id = :user_id ORDER BY created_at DESC LIMIT 100",
        {"user_id": current_user["user_id"]},
    )
    return [parse_notification(row) for row in rows]


@ws_router.websocket("/ws/elder/{elder_id}")
async def elder_room_websocket(websocket: WebSocket, elder_id: str, token: Optional[str] = Query(None)):
    if token:
        try:
            current_user = verify_jwt_token(token)
            ensure_elder_access(current_user, elder_id, write=False)
        except Exception:
            await websocket.close(code=1008)
            return
    await elder_room_manager.connect(elder_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        elder_room_manager.disconnect(elder_id, websocket)
