"""Registers the Telegram webhook for a deployed ElderGuard AI backend.

Usage (token comes from the environment, never the command line):
    set TELEGRAM_BOT_TOKEN=...            (PowerShell: $env:TELEGRAM_BOT_TOKEN="...")
    python set_telegram_webhook.py https://elderguard-nmn9.onrender.com

On Render the app also does this itself at startup, so this is only needed for other hosts.
"""
import sys

from app.notifications.channels.telegram import register_webhook

if len(sys.argv) != 2:
    sys.exit(__doc__)

result = register_webhook(sys.argv[1])
print(result)
sys.exit(0 if result["success"] else 1)
