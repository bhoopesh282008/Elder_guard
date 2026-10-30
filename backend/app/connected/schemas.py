import re
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator

# 24-hour "08:00" or 12-hour "8:00 AM"
_TIME_RE = re.compile(r"^(?:(?:[01]?\d|2[0-3]):[0-5]\d|(?:0?[1-9]|1[0-2]):[0-5]\d\s?[AaPp][Mm])$")


class InviteRequest(BaseModel):
    elder_identifier: str
    permission_level: str = Field(default="full_access", pattern="^(full_access|view_only)$")


class InviteAcceptRequest(BaseModel):
    permission_level: Optional[str] = Field(default=None, pattern="^(full_access|view_only)$")


class MedicineCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    dosage: str = Field(max_length=100)
    frequency: Optional[str] = None
    scheduled_times: List[str] = Field(default_factory=list)
    instructions: Optional[str] = Field(default=None, max_length=2000)
    stock_count: int = Field(default=30, ge=0)
    low_stock_threshold: int = Field(default=7, ge=0)

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Medicine name cannot be blank.")
        return value

    @field_validator("scheduled_times")
    @classmethod
    def _times_valid(cls, values: List[str]) -> List[str]:
        cleaned = [v.strip() for v in values]
        bad = [v for v in cleaned if not _TIME_RE.match(v)]
        if bad:
            raise ValueError(f"Invalid time(s) {bad}; use HH:MM or h:mm AM/PM.")
        return cleaned


class MedicineTakenRequest(BaseModel):
    scheduled_time: Optional[str] = None


class VitalCreateRequest(BaseModel):
    type: str = Field(pattern="^(bp|sugar|heart_rate|spo2|weight|sleep)$")
    value: Dict[str, Any]
    unit: Optional[str] = None
    recorded_at: Optional[str] = None
    source: str = Field(default="manual", pattern="^(manual|device_sync)$")


class AppointmentCreateRequest(BaseModel):
    doctor_id: Optional[str] = None
    hospital_id: Optional[str] = None
    scheduled_at: str
    mode: str = Field(pattern="^(video|in_person)$")
    notes: Optional[str] = None


class SOSTriggerRequest(BaseModel):
    location: Optional[Dict[str, float]] = None


class SOSResolveRequest(BaseModel):
    resolution_notes: Optional[str] = None


class CheckInRequest(BaseModel):
    mood: str = Field(pattern="^(calm|tired|unwell|happy)$")
    ok_status: bool = True


class ReminderCreateRequest(BaseModel):
    type: str = Field(pattern="^(medicine|appointment|water|activity|custom)$")
    scheduled_time: str
    payload: Dict[str, Any] = Field(default_factory=dict)


class MessageCreateRequest(BaseModel):
    receiver_id: str
    elder_context_id: str
    content: str
    attachment_url: Optional[str] = None
