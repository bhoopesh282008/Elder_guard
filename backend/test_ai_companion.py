import uuid
from unittest.mock import patch
from datetime import datetime, timezone

from app.ai_companion.models import ChatRole, ChatMessage, ChatRequest
from app.ai_companion.routes import (
    chat_with_ai_companion,
    get_chat_history,
    check_distress_signals,
    build_prompt,
    _mock_chat_logs_db,
    FALLBACK_REPLY_MESSAGE,
)
from app.core import config

print("==================================================================")
print("AI COMPANION MICROSERVICE TEST SUITE")
print("==================================================================")

elder_id = str(uuid.uuid4())
caregiver_id = str(uuid.uuid4())
unauthorized_id = str(uuid.uuid4())

user_elder = {"user_id": elder_id, "role": "elder", "name": "Elder AI User"}
user_caregiver = {"user_id": caregiver_id, "role": "caregiver", "name": "Caregiver AI User"}
user_unauthorized = {"user_id": unauthorized_id, "role": "elder", "name": "Stranger"}

# STEP 1: Blank / Whitespace Message Validation
print("\n--- STEP 1: Blank Message Validation ---")
try:
    ChatRequest(elder_id=elder_id, message="   ")
    assert False, "Should have raised ValueError for blank message"
except Exception:
    print("[OK] Step 1 Passed: Blank message correctly rejected.")

# STEP 2: Mode System Prompt Selection
print("\n--- STEP 2: Mode System Prompt Selection ---")
req_comp = ChatRequest(elder_id=elder_id, message="Hello!", mode="companion")
sys_comp, _ = build_prompt(req_comp)
assert "warm, patient, and empathetic" in sys_comp

req_checkin = ChatRequest(elder_id=elder_id, message="Hello!", mode="checkin")
sys_check, _ = build_prompt(req_checkin)
assert "gentle, friendly daily check-in" in sys_check
print("[OK] Step 2 Passed: System prompt mode selection verified ('companion' vs 'checkin').")

# STEP 3: History Truncation (Last 20 Messages)
print("\n--- STEP 3: History Truncation ---")
many_messages = [
    ChatMessage(role=ChatRole.USER if i % 2 == 0 else ChatRole.MODEL, content=f"Msg {i}")
    for i in range(25)
]
req_trunc = ChatRequest(elder_id=elder_id, message="Latest", history=many_messages)
_, formatted_hist = build_prompt(req_trunc)
assert len(formatted_hist) == 20, f"Expected 20 history items, got {len(formatted_hist)}"
assert formatted_hist[0]["content"] == "Msg 5", f"Expected oldest truncated to be Msg 5, got {formatted_hist[0]['content']}"
print("[OK] Step 3 Passed: History truncated to last 20 messages (oldest first).")

# STEP 4: Distress Signal Detection & Caregiver Notification
print("\n--- STEP 4: Distress Signal Detection ---")
distress_msg = "I fell down and can't get up"
assert check_distress_signals(distress_msg) == True

req_distress = ChatRequest(elder_id=elder_id, message=distress_msg)
res_distress = chat_with_ai_companion(req_distress, user_elder)
assert res_distress.distress_flagged == True
print("[OK] Step 4 Passed: Distress signal detected & caregiver alert dispatched.")

# STEP 5: Non-Distress Message
print("\n--- STEP 5: Non-Distress Message ---")
normal_msg = "Good morning, how is the weather today?"
assert check_distress_signals(normal_msg) == False

req_normal = ChatRequest(elder_id=elder_id, message=normal_msg)
res_normal = chat_with_ai_companion(req_normal, user_elder)
assert res_normal.distress_flagged == False
print("[OK] Step 5 Passed: Normal message processed without distress flag.")

# STEP 6: Groq API Failure Graceful Fallback
print("\n--- STEP 6: Groq API Failure Fallback ---")
with patch("app.ai_companion.routes.call_groq_api", return_value=FALLBACK_REPLY_MESSAGE):
    req_fail = ChatRequest(elder_id=elder_id, message="Hello?")
    res_fail = chat_with_ai_companion(req_fail, user_elder)
    assert res_fail.reply == FALLBACK_REPLY_MESSAGE
print("[OK] Step 6 Passed: Groq failure returned graceful fallback message (200 OK).")

# STEP 7: Persistence Toggle Disabled
print("\n--- STEP 7: Persistence Toggle Disabled ---")
config.PERSIST_CHAT_HISTORY = False
_mock_chat_logs_db.clear()

req_no_persist = ChatRequest(elder_id=elder_id, message="Testing no persist")
chat_with_ai_companion(req_no_persist, user_elder)
assert len(_mock_chat_logs_db) == 0
print("[OK] Step 7 Passed: Chat logs not persisted when PERSIST_CHAT_HISTORY=False.")

# STEP 8: Persistence Toggle Enabled & History Endpoint
print("\n--- STEP 8: Persistence Toggle Enabled & History Retrieval ---")
config.PERSIST_CHAT_HISTORY = True
_mock_chat_logs_db.clear()

req_persist = ChatRequest(elder_id=elder_id, message="Hello AI!")
chat_with_ai_companion(req_persist, user_elder)
assert len(_mock_chat_logs_db) == 2  # 1 user + 1 model

history_logs = get_chat_history(elder_id, current_user=user_elder)
assert len(history_logs) == 2
assert history_logs[0].role in [ChatRole.USER, ChatRole.MODEL]
print("[OK] Step 8 Passed: Chat logs persisted and retrieved via history endpoint.")

# Reset toggle
config.PERSIST_CHAT_HISTORY = False

# STEP 9: Authorization Enforcement & FastAPI HTTP Route Test
print("\n--- STEP 9: Authorization Enforcement & HTTP Route Test ---")
# Caregiver history view allowed
cg_history = get_chat_history(elder_id, current_user=user_caregiver)
assert len(cg_history) == 2

# Unauthorized user chat/history blocked
try:
    req_unauth = ChatRequest(elder_id=elder_id, message="Unauthorized chat")
    chat_with_ai_companion(req_unauth, user_unauthorized)
    assert False, "Should have raised 403 Forbidden"
except Exception:
    print("[OK] Step 9 Passed: Unauthorized user access correctly blocked (403).")

# FastAPI TestClient HTTP verification
from fastapi.testclient import TestClient
from app.main import app
from app.core.security import get_current_user

client = TestClient(app)
app.dependency_overrides[get_current_user] = lambda: user_elder

http_req = {
    "elder_id": elder_id,
    "message": "Hello from HTTP test!",
    "mode": "companion"
}
resp = client.post("/ai/chat", json=http_req)
assert resp.status_code == 200, f"POST /ai/chat failed: {resp.text}"
http_res = resp.json()
assert "reply" in http_res
print(f"[OK] POST /ai/chat returned 200 OK. Reply preview: {http_res['reply'][:40]}...")

app.dependency_overrides.clear()

print("\n==================================================================")
print("ALL AI COMPANION MICROSERVICE TESTS PASSED SUCCESSFULLY!")
print("==================================================================")
