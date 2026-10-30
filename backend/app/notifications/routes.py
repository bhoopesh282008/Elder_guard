import uuid
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException, status, Depends, Query, Request
import httpx

from app.core.config import TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_WEBHOOK_SECRET
from app.core.security import get_current_user
from app.core.database import supabase
from app.notifications.schemas import (
    DeviceTokenRegister,
    NotificationResponse,
    NotificationHistoryResponse,
    UnreadCountResponse,
    TelegramLinkUrlResponse,
    BroadcastNotificationRequest,
)
from app.notifications.service import broadcast_notification
from app.notifications.channels.in_app import _mock_notifications_db
from app.notifications.channels.push_fcm import _mock_device_tokens_db
from app.notifications.channels.telegram import create_link_code, consume_link_code, save_telegram_link

router = APIRouter(prefix="/notifications", tags=["Notifications"])


# --- STATIC ENDPOINTS FIRST (to prevent FastAPI parameter route collision) ---

@router.post("/broadcast", status_code=status.HTTP_200_OK)
def broadcast_notification_endpoint(
    payload: BroadcastNotificationRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Broadcasts notification to multiple recipient users.
    """
    return broadcast_notification(
        recipient_ids=payload.recipient_ids,
        title=payload.title,
        body=payload.body,
        type=payload.type,
        priority=payload.priority,
        payload=payload.payload
    )


@router.post("/register-device", status_code=status.HTTP_200_OK)
def register_device(
    payload: DeviceTokenRegister,
    current_user: dict = Depends(get_current_user)
):
    """
    Upserts FCM device token for current user.
    """
    user_id = current_user["user_id"]
    now_str = datetime.now(timezone.utc).isoformat()
    token_id = str(uuid.uuid4())

    token_data = {
        "id": token_id,
        "user_id": user_id,
        "fcm_token": payload.fcm_token,
        "device_type": payload.device_type.value,
        "is_active": True,
        "created_at": now_str,
        "updated_at": now_str,
    }

    if supabase is not None:
        try:
            supabase.table("device_tokens").upsert(token_data, on_conflict="fcm_token").execute()
        except Exception:
            _mock_device_tokens_db[payload.fcm_token] = token_data
    else:
        _mock_device_tokens_db[payload.fcm_token] = token_data

    return {"status": "success", "message": "Device token successfully registered.", "token": token_data}


@router.get("/telegram/link-url", response_model=TelegramLinkUrlResponse)
def get_telegram_link_url(current_user: dict = Depends(get_current_user)):
    """
    Returns Telegram bot deep-link URL for account linking.
    """
    user_id = current_user["user_id"]
    code = create_link_code(user_id)
    url = f"https://t.me/{TELEGRAM_BOT_USERNAME}?start={code}"
    return TelegramLinkUrlResponse(url=url)


@router.post("/telegram/webhook", status_code=status.HTTP_200_OK)
async def telegram_webhook(request: Request):
    """
    Telegram Bot API webhook receiver.
    Parses incoming updates, handles '/start <one-time code>', links account, and replies via Telegram API.
    Must always return 200 OK.
    """
    if TELEGRAM_WEBHOOK_SECRET and request.headers.get("x-telegram-bot-api-secret-token") != TELEGRAM_WEBHOOK_SECRET:
        return {"status": "ok"}

    try:
        update_data = await request.json()
        message = update_data.get("message", {})
        text: str = message.get("text", "")
        chat = message.get("chat", {})
        chat_id = str(chat.get("id")) if chat.get("id") else None
        username = chat.get("username")

        if text.startswith("/start") and chat_id:
            code = text[len("/start"):].strip()
            user_id = consume_link_code(code) if code else None

            if user_id:
                save_telegram_link(user_id, chat_id, username)
                reply_text = "✅ ElderGuard AI is now linked to your Telegram. You will get SOS and medicine alerts here."
            elif code:
                reply_text = "That link has expired or was already used. Open ElderGuard AI and tap Connect Telegram again."
            else:
                reply_text = "Hi! To link this chat, open ElderGuard AI and tap Connect Telegram."

            # Send reply via Telegram API if token configured
            if TELEGRAM_BOT_TOKEN and not TELEGRAM_BOT_TOKEN.startswith("123456789"):
                try:
                    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
                    httpx.post(url, json={"chat_id": chat_id, "text": reply_text}, timeout=5.0)
                except Exception:
                    pass

    except Exception:
        pass

    return {"status": "ok"}


@router.put("/{id}/mark-read", response_model=NotificationResponse)
def mark_notification_read(
    id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Marks single notification as read if it belongs to current_user.
    """
    notif = None
    if supabase is not None:
        try:
            res = supabase.table("notifications").select("*").eq("id", id).execute()
            if res.data:
                notif = res.data[0]
        except Exception:
            pass

    if not notif:
        notif = _mock_notifications_db.get(id)

    if not notif:
        raise HTTPException(status_code=404, detail=f"Notification '{id}' not found.")

    if notif.get("recipient_id") != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Not authorized to modify this notification.")

    notif["is_read"] = True
    if id in _mock_notifications_db:
        _mock_notifications_db[id]["is_read"] = True

    if supabase is not None:
        try:
            supabase.table("notifications").update({"is_read": True}).eq("id", id).execute()
        except Exception:
            pass

    return NotificationResponse(**notif)


# --- USER PARAMETERIZED ENDPOINTS ---

@router.get("/{user_id}", response_model=NotificationHistoryResponse)
def get_notification_history(
    user_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    """
    Get paginated notification history for user (most recent first).
    Enforces current_user.user_id == user_id.
    """
    if current_user["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to view notifications for another user.")

    offset = (page - 1) * limit
    all_notifs = []

    if supabase is not None:
        try:
            res = supabase.table("notifications").select("*", count="exact").eq("recipient_id", user_id).order("created_at", desc=True).range(offset, offset + limit - 1).execute()
            if res.data:
                all_notifs = res.data
                total_count = res.count or len(all_notifs)
                return NotificationHistoryResponse(
                    items=[NotificationResponse(**n) for n in all_notifs],
                    total=total_count,
                    page=page,
                    limit=limit
                )
        except Exception:
            pass

    # Fallback to local memory store
    user_notifs = [n for n in _mock_notifications_db.values() if n.get("recipient_id") == user_id]
    user_notifs.sort(key=lambda x: x.get("created_at", ""), reverse=True)

    total_count = len(user_notifs)
    paged_items = user_notifs[offset:offset + limit]

    return NotificationHistoryResponse(
        items=[NotificationResponse(**n) for n in paged_items],
        total=total_count,
        page=page,
        limit=limit
    )


@router.get("/{user_id}/unread-count", response_model=UnreadCountResponse)
def get_unread_count(
    user_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Returns unread notification count for user.
    """
    if current_user["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to access unread count for another user.")

    unread_count = 0
    if supabase is not None:
        try:
            res = supabase.table("notifications").select("*", count="exact").eq("recipient_id", user_id).eq("is_read", False).execute()
            if res.count is not None:
                unread_count = res.count
            elif res.data:
                unread_count = len(res.data)
            return UnreadCountResponse(count=unread_count)
        except Exception:
            pass

    unread_count = len([n for n in _mock_notifications_db.values() if n.get("recipient_id") == user_id and not n.get("is_read")])
    return UnreadCountResponse(count=unread_count)


@router.put("/{user_id}/mark-all-read")
def mark_all_notifications_read(
    user_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Bulk update all notifications for current user as read.
    """
    if current_user["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to modify notifications for another user.")

    if supabase is not None:
        try:
            supabase.table("notifications").update({"is_read": True}).eq("recipient_id", user_id).eq("is_read", False).execute()
        except Exception:
            pass

    for n in _mock_notifications_db.values():
        if n.get("recipient_id") == user_id:
            n["is_read"] = True

    return {"status": "success", "message": f"All notifications for user '{user_id}' marked as read."}
