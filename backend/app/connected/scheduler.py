import logging
from datetime import timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.config import TELEGRAM_SUMMARY_HOUR, TELEGRAM_TZ_OFFSET_MINUTES

logger = logging.getLogger("elderguard.connected.scheduler")
scheduler = AsyncIOScheduler()


def _escalation_job() -> None:
    from app.connected.sos_actions import escalate_unacknowledged_sos
    try:
        escalate_unacknowledged_sos()
    except Exception:
        logger.exception("SOS escalation sweep failed")


def _daily_summary_job() -> None:
    from app.connected.telegram_bot import send_daily_summaries
    try:
        logger.info("Daily Telegram summaries sent: %s", send_daily_summaries())
    except Exception:
        logger.exception("Daily summary job failed")


def start_connected_scheduler() -> None:
    if scheduler.running:
        return
    local_tz = timezone(timedelta(minutes=TELEGRAM_TZ_OFFSET_MINUTES))
    scheduler.add_job(_escalation_job, "interval", seconds=30, id="connected_sos_escalation")
    scheduler.add_job(
        _daily_summary_job,
        CronTrigger(hour=TELEGRAM_SUMMARY_HOUR, minute=0, timezone=local_tz),
        id="connected_daily_summary",
    )
    scheduler.start()
    logger.info("Connected-portal scheduler started (SOS escalation, daily summary at %02d:00).", TELEGRAM_SUMMARY_HOUR)


def shutdown_connected_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
