import time
import uuid

from fastapi.testclient import TestClient

from app.main import app
from test_connected_portals import auth, create_caregiver_profile, create_elder_profile, linked_pair, signup
from test_telegram_alerts import link_chat, telegram_api, wait_for  # noqa: F401  (telegram_api is a fixture)

client = TestClient(app)


def methods(calls, name):
    return [c for c in calls if c["url"].endswith("/" + name)]


def new_chat_id():
    return int(uuid.uuid4().int % 10**9)


def trigger_sos(elder, lat=12.5, lng=77.25):
    r = client.post("/api/elder/sos", headers=auth(elder["access_token"]), json={"location": {"lat": lat, "lng": lng}})
    assert r.status_code == 201, r.text
    return r.json()


def callback(chat_id, data, message_id=7, cb_id="cb"):
    client.post(
        "/notifications/telegram/webhook",
        json={"callback_query": {"id": cb_id, "data": data, "message": {"message_id": message_id, "chat": {"id": chat_id}}}},
    )


# ---------- buttons, location, commands, escalation ----------

def test_sos_alert_has_ack_button_location_pin_and_contact(telegram_api):
    elder, caregiver = linked_pair()
    chat_id = new_chat_id()
    link_chat(caregiver["access_token"], chat_id)
    telegram_api.clear()
    sos = trigger_sos(elder)

    assert wait_for(telegram_api, lambda c: c["url"].endswith("/sendLocation"))
    msg = next(c for c in methods(telegram_api, "sendMessage") if c["json"]["chat_id"] == str(chat_id))
    buttons = msg["json"]["reply_markup"]["inline_keyboard"][0]
    assert buttons[0]["callback_data"] == f"ack:{sos['id']}"
    assert buttons[1]["url"].startswith("https://maps.google.com/")
    pin = methods(telegram_api, "sendLocation")[0]["json"]
    assert (pin["latitude"], pin["longitude"]) == (12.5, 77.25)


def test_ack_button_marks_sos_acknowledged_and_tells_the_elder(telegram_api):
    elder, caregiver = linked_pair()
    chat_id = new_chat_id()
    link_chat(caregiver["access_token"], chat_id)
    sos = trigger_sos(elder)
    telegram_api.clear()

    callback(chat_id, f"ack:{sos['id']}", cb_id="cb1")
    dash = client.get("/api/elder/dashboard", headers=auth(elder["access_token"])).json()
    assert dash["active_sos"]["status"] == "acknowledged"
    assert methods(telegram_api, "answerCallbackQuery")[0]["json"]["text"].startswith("Thanks")
    assert methods(telegram_api, "editMessageReplyMarkup")  # button removed

    notes = client.get("/api/notifications", headers=auth(elder["access_token"])).json()
    assert any(n["type"] == "sos_acknowledged" for n in notes)

    # Pressing it again is harmless.
    telegram_api.clear()
    callback(chat_id, f"ack:{sos['id']}", cb_id="cb2")
    assert methods(telegram_api, "answerCallbackQuery")[0]["json"]["text"] == "Already acknowledged."


def test_ack_button_from_unrelated_or_unlinked_chat_is_refused(telegram_api):
    elder, caregiver = linked_pair()
    stranger_elder, stranger_cg = linked_pair()
    chat_id = new_chat_id()
    link_chat(stranger_cg["access_token"], chat_id)
    sos = trigger_sos(elder)
    telegram_api.clear()

    callback(chat_id, f"ack:{sos['id']}")
    assert "permission" in methods(telegram_api, "answerCallbackQuery")[0]["json"]["text"]
    callback(1, f"ack:{sos['id']}")
    assert "not linked" in methods(telegram_api, "answerCallbackQuery")[-1]["json"]["text"]
    dash = client.get("/api/elder/dashboard", headers=auth(elder["access_token"])).json()
    assert dash["active_sos"]["status"] == "active"


def test_unanswered_sos_escalates_but_acknowledged_one_does_not(telegram_api):
    from app.connected.sos_actions import escalate_unacknowledged_sos
    from app.connected.storage import execute

    elder, caregiver = linked_pair()
    chat_id = new_chat_id()
    link_chat(caregiver["access_token"], chat_id)
    sos = trigger_sos(elder)
    execute("UPDATE connected_sos_events SET triggered_at = '2000-01-01T00:00:00+00:00' WHERE id = :id", {"id": sos["id"]})
    telegram_api.clear()

    escalate_unacknowledged_sos()
    # The sweep covers every active SOS in the database, so only look at this test's chat.
    mine = lambda c: c["json"].get("chat_id") == str(chat_id) and "STILL UNANSWERED" in c["json"].get("text", "")
    sent = wait_for(telegram_api, mine)
    assert sent and sent[0]["json"]["reply_markup"]["inline_keyboard"][0][0]["callback_data"] == f"ack:{sos['id']}"

    ack = client.post(f"/api/caregiver/elders/{elder['user']['id']}/sos/{sos['id']}/acknowledge", headers=auth(caregiver["access_token"]))
    assert ack.status_code == 200 and ack.json()["status"] == "acknowledged"
    telegram_api.clear()
    escalate_unacknowledged_sos()
    time.sleep(0.4)
    assert not [c for c in telegram_api if mine(c)]


def test_status_and_summary_commands(telegram_api):
    elder, caregiver = linked_pair()
    chat_id = new_chat_id()
    link_chat(caregiver["access_token"], chat_id)
    telegram_api.clear()

    for command in ("/status", "/summary"):
        client.post("/notifications/telegram/webhook", json={"message": {"chat": {"id": chat_id}, "text": command}})
    texts = [c["json"]["text"] for c in methods(telegram_api, "sendMessage")]
    assert any("Connected Elder" in t and "Medicines today" in t for t in texts)
    assert any("Daily summary for Connected Elder" in t for t in texts)

    telegram_api.clear()
    client.post("/notifications/telegram/webhook", json={"message": {"chat": {"id": 31337}, "text": "/status"}})
    assert "not linked" in methods(telegram_api, "sendMessage")[0]["json"]["text"]


def test_daily_summary_job_reaches_linked_users(telegram_api):
    from app.connected.telegram_bot import send_daily_summaries

    elder, caregiver = linked_pair()
    chat_id = new_chat_id()
    link_chat(caregiver["access_token"], chat_id)
    telegram_api.clear()
    assert send_daily_summaries() >= 1
    assert any(c["json"]["chat_id"] == str(chat_id) and "Daily summary" in c["json"]["text"] for c in methods(telegram_api, "sendMessage"))


def test_telegram_status_and_unlink_endpoints(telegram_api):
    elder, caregiver = linked_pair()
    token = caregiver["access_token"]
    assert client.get("/notifications/telegram/status", headers=auth(token)).json()["linked"] is False
    link_chat(token, new_chat_id())
    status = client.get("/notifications/telegram/status", headers=auth(token)).json()
    assert status["linked"] is True and status["bot_configured"] is True
    assert client.delete("/notifications/telegram/link", headers=auth(token)).json() == {"linked": False}
    assert client.get("/notifications/telegram/status", headers=auth(token)).json()["linked"] is False


# ---------- invites need the elder's consent ----------

def test_invite_is_pending_until_the_elder_accepts():
    suffix = str(int(time.time() * 1000))
    elder = signup("elder", "c" + suffix)
    caregiver = signup("caregiver", "c" + suffix)
    create_elder_profile(elder["access_token"], "Consent Elder")
    create_caregiver_profile(caregiver["access_token"], "Consent Caregiver")

    invite = client.post(
        "/api/caregiver/invite", headers=auth(caregiver["access_token"]),
        json={"elder_identifier": elder["user"]["id"], "permission_level": "full_access"},
    )
    assert invite.status_code == 201 and invite.json()["status"] == "pending"

    # No access yet.
    assert client.get("/api/caregiver/elders", headers=auth(caregiver["access_token"])).json() == []
    denied = client.get(f"/api/caregiver/elders/{elder['user']['id']}/dashboard", headers=auth(caregiver["access_token"]))
    assert denied.status_code == 403

    pending = client.get("/api/elder/invites", headers=auth(elder["access_token"])).json()
    assert [p["caregiver_name"] for p in pending] == ["Consent Caregiver"]

    # Decline, then a fresh invite is possible; accept grants access.
    declined = client.post(f"/api/elder/invites/{invite.json()['id']}/decline", headers=auth(elder["access_token"]))
    assert declined.json()["status"] == "declined"
    assert client.get("/api/elder/invites", headers=auth(elder["access_token"])).json() == []
    again = client.post(
        "/api/caregiver/invite", headers=auth(caregiver["access_token"]),
        json={"elder_identifier": elder["user"]["id"], "permission_level": "view_only"},
    )
    assert again.json()["status"] == "pending"
    accept = client.post(f"/api/elder/invites/{again.json()['id']}/accept", headers=auth(elder["access_token"]), json={"permission_level": "view_only"})
    assert accept.status_code == 200 and accept.json()["status"] == "active"
    assert len(client.get("/api/caregiver/elders", headers=auth(caregiver["access_token"])).json()) == 1

    # Another elder cannot decline someone else's invite.
    other = signup("elder", "d" + suffix)
    assert client.post(f"/api/elder/invites/{again.json()['id']}/decline", headers=auth(other["access_token"])).status_code == 404


def test_send_test_alert_endpoint(telegram_api):
    elder, caregiver = linked_pair()
    token = caregiver["access_token"]
    assert client.post("/notifications/telegram/test", headers=auth(token)).status_code == 409  # not linked yet
    chat_id = new_chat_id()
    link_chat(token, chat_id)
    telegram_api.clear()
    assert client.post("/notifications/telegram/test", headers=auth(token)).json() == {"success": True}
    assert any(c["json"]["chat_id"] == str(chat_id) and "Test alert" in c["json"]["text"] for c in methods(telegram_api, "sendMessage"))
