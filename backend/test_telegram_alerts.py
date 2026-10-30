import time
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.security import create_jwt_token
from app.notifications.channels import telegram as tg
from test_connected_portals import linked_pair, auth

client = TestClient(app)


@pytest.fixture
def telegram_api(monkeypatch):
    """Fake bot token plus a recording stand-in for the Telegram HTTP API."""
    calls = []

    class FakeResponse:
        status_code = 200

        def json(self):
            return {"ok": True}

    def fake_post(url, json=None, timeout=None):
        calls.append({"url": url, "json": json})
        return FakeResponse()

    monkeypatch.setattr(tg, "TELEGRAM_BOT_TOKEN", "999:TESTTOKEN")
    monkeypatch.setattr(tg.httpx, "post", fake_post)
    import app.notifications.routes as routes
    monkeypatch.setattr(routes, "TELEGRAM_BOT_TOKEN", "999:TESTTOKEN")
    monkeypatch.setattr(routes.httpx, "post", fake_post)
    return calls


def link_chat(token: str, chat_id: int) -> str:
    url = client.get("/notifications/telegram/link-url", headers=auth(token)).json()["url"]
    code = url.split("?start=")[1]
    client.post(
        "/notifications/telegram/webhook",
        json={"message": {"chat": {"id": chat_id, "username": "tester"}, "text": f"/start {code}"}},
    )
    return code


def wait_for(calls, predicate, seconds=3.0):
    deadline = time.time() + seconds
    while time.time() < deadline:
        matches = [c for c in calls if predicate(c)]
        if matches:
            return matches
        time.sleep(0.05)
    return []


def test_link_code_is_one_time_and_not_the_user_id(telegram_api):
    elder, caregiver = linked_pair()
    chat_id = int(uuid.uuid4().int % 10**9)
    code = link_chat(caregiver["access_token"], chat_id)
    assert code != caregiver["user"]["id"]
    assert tg.get_active_telegram_link(caregiver["user"]["id"])["telegram_chat_id"] == str(chat_id)

    # Replaying the same code from another chat must not link it.
    other_chat = chat_id + 1
    client.post(
        "/notifications/telegram/webhook",
        json={"message": {"chat": {"id": other_chat}, "text": f"/start {code}"}},
    )
    assert tg.get_active_telegram_link(caregiver["user"]["id"])["telegram_chat_id"] == str(chat_id)
    replies = [c["json"]["text"] for c in telegram_api if c["json"]["chat_id"] == str(other_chat)]
    assert replies and "expired" in replies[-1]


def test_raw_user_id_cannot_hijack_a_link(telegram_api):
    elder, caregiver = linked_pair()
    victim = caregiver["user"]["id"]
    client.post(
        "/notifications/telegram/webhook",
        json={"message": {"chat": {"id": 424242001}, "text": f"/start {victim}"}},
    )
    assert tg.get_active_telegram_link(victim) is None


def test_expired_code_is_rejected(telegram_api):
    elder, caregiver = linked_pair()
    code = tg.create_link_code(caregiver["user"]["id"])
    with tg._engine().begin() as conn:
        conn.execute(tg.sql("UPDATE telegram_link_codes SET expires_at = '2000-01-01T00:00:00+00:00' WHERE code = :c"), {"c": code})
    assert tg.consume_link_code(code) is None


def test_sos_reaches_linked_caregiver_on_telegram(telegram_api):
    elder, caregiver = linked_pair()
    chat_id = int(uuid.uuid4().int % 10**9)
    link_chat(caregiver["access_token"], chat_id)
    telegram_api.clear()

    response = client.post(
        "/api/elder/sos",
        headers=auth(elder["access_token"]),
        json={"location": {"lat": 12.5, "lng": 77.25}},
    )
    assert response.status_code == 201, response.text

    sent = wait_for(telegram_api, lambda c: c["json"]["chat_id"] == str(chat_id))
    assert sent, "SOS alert never reached Telegram"
    body = sent[0]["json"]
    assert "SOS" in body["text"] and "Connected Elder" in body["text"]
    assert "12.5,77.25" in body["text"]
    assert "parse_mode" not in body  # plain text so names with _ or * cannot break delivery
    assert "999:TESTTOKEN" in sent[0]["url"]


def test_unlinked_caregiver_gets_no_telegram_and_request_still_succeeds(telegram_api):
    elder, caregiver = linked_pair()
    telegram_api.clear()
    response = client.post("/api/elder/sos", headers=auth(elder["access_token"]), json={"location": {"lat": 1, "lng": 2}})
    assert response.status_code == 201
    time.sleep(0.4)
    assert telegram_api == []


def test_telegram_failure_never_breaks_the_api(monkeypatch, telegram_api):
    elder, caregiver = linked_pair()
    link_chat(caregiver["access_token"], int(uuid.uuid4().int % 10**9))

    def boom(*a, **k):
        raise RuntimeError("telegram down")

    monkeypatch.setattr(tg.httpx, "post", boom)
    response = client.post("/api/elder/sos", headers=auth(elder["access_token"]), json={"location": {"lat": 1, "lng": 2}})
    assert response.status_code == 201


def test_medicine_taken_alert(telegram_api):
    elder, caregiver = linked_pair()
    chat_id = int(uuid.uuid4().int % 10**9)
    link_chat(caregiver["access_token"], chat_id)
    med = client.post(
        f"/api/caregiver/elders/{elder['user']['id']}/medicines",
        headers=auth(caregiver["access_token"]),
        json={"name": "Metformin", "dosage": "500mg", "scheduled_times": ["08:00"]},
    )
    assert med.status_code in (200, 201), med.text
    telegram_api.clear()
    taken = client.post(f"/api/elder/medicines/{med.json()['id']}/mark-taken", headers=auth(elder["access_token"]), json={})
    assert taken.status_code in (200, 201), taken.text
    sent = wait_for(telegram_api, lambda c: c["json"]["chat_id"] == str(chat_id))
    assert sent and "taken" in sent[0]["json"]["text"]


def test_webhook_secret_is_enforced(monkeypatch, telegram_api):
    import app.notifications.routes as routes
    monkeypatch.setattr(routes, "TELEGRAM_WEBHOOK_SECRET", "s3cret")
    elder, caregiver = linked_pair()
    code = tg.create_link_code(caregiver["user"]["id"])
    payload = {"message": {"chat": {"id": 515151}, "text": f"/start {code}"}}
    client.post("/notifications/telegram/webhook", json=payload)
    assert tg.get_active_telegram_link(caregiver["user"]["id"]) is None
    client.post("/notifications/telegram/webhook", json=payload, headers={"X-Telegram-Bot-Api-Secret-Token": "s3cret"})
    assert tg.get_active_telegram_link(caregiver["user"]["id"]) is not None


def test_register_webhook_calls_set_webhook(monkeypatch, telegram_api):
    monkeypatch.setattr(tg, "TELEGRAM_WEBHOOK_SECRET", "s3cret")
    result = tg.register_webhook("https://example.onrender.com/")
    assert result == {"success": True, "url": "https://example.onrender.com/notifications/telegram/webhook"}
    call = telegram_api[-1]
    assert call["url"].endswith("/setWebhook")
    assert call["json"]["secret_token"] == "s3cret"
