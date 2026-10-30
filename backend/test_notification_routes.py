import uuid
from fastapi.testclient import TestClient
from app.main import app
from app.core.security import create_jwt_token
from app.notifications.channels.in_app import deliver_in_app

client = TestClient(app)

print("==================================================================")
print("TESTING NOTIFICATION HTTP ENDPOINTS (/notifications)")
print("==================================================================")

user_id = str(uuid.uuid4())
token = create_jwt_token(user_id=user_id, role="elder")
headers = {"Authorization": f"Bearer {token}"}

# 1. Create dummy notifications via deliver_in_app
notif1 = deliver_in_app(recipient_id=user_id, type="alarm", title="Test Alarm 1", body="Take Metformin", priority="high")
notif2 = deliver_in_app(recipient_id=user_id, type="alert", title="Test Alert 2", body="Missed dose", priority="high")

# 2. GET /notifications/{user_id}
r_history = client.get(f"/notifications/{user_id}", headers=headers)
print("History Status:", r_history.status_code)
print("History JSON:", r_history.json())
assert r_history.status_code == 200
assert r_history.json()["total"] >= 2

# 3. GET /notifications/{user_id}/unread-count
r_unread = client.get(f"/notifications/{user_id}/unread-count", headers=headers)
print("Unread Count Status:", r_unread.status_code)
print("Unread Count JSON:", r_unread.json())
assert r_unread.status_code == 200
assert r_unread.json()["count"] >= 2

# 4. PUT /notifications/{id}/mark-read
r_mark = client.put(f"/notifications/{notif1['id']}/mark-read", headers=headers)
print("Mark Read Status:", r_mark.status_code)
print("Mark Read JSON:", r_mark.json())
assert r_mark.status_code == 200
assert r_mark.json()["is_read"] == True

# 5. PUT /notifications/{user_id}/mark-all-read
r_mark_all = client.put(f"/notifications/{user_id}/mark-all-read", headers=headers)
print("Mark All Read Status:", r_mark_all.status_code)
print("Mark All Read JSON:", r_mark_all.json())
assert r_mark_all.status_code == 200

# 6. POST /notifications/register-device
r_reg = client.post("/notifications/register-device", json={"fcm_token": "fcm_test_token_999", "device_type": "android"}, headers=headers)
print("Register Device Status:", r_reg.status_code)
print("Register Device JSON:", r_reg.json())
assert r_reg.status_code == 200

# 7. GET /notifications/telegram/link-url
r_tg_url = client.get("/notifications/telegram/link-url", headers=headers)
print("Telegram Link URL Status:", r_tg_url.status_code)
print("Telegram Link URL JSON:", r_tg_url.json())
assert r_tg_url.status_code == 200
link_code = r_tg_url.json()["url"].split("?start=")[1]
assert link_code != user_id  # one-time code, never the raw user id

# 8. POST /notifications/telegram/webhook
webhook_payload = {
    "update_id": 123456,
    "message": {
        "message_id": 1,
        "chat": {"id": 987654321, "username": "tg_elder_user"},
        "text": f"/start {link_code}"
    }
}
r_webhook = client.post("/notifications/telegram/webhook", json=webhook_payload)
print("Telegram Webhook Status:", r_webhook.status_code)
print("Telegram Webhook JSON:", r_webhook.json())
assert r_webhook.status_code == 200

print("\nALL NOTIFICATION HTTP ENDPOINT TESTS PASSED SUCCESSFULLY!")
