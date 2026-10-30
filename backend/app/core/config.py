import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY: str = os.getenv("SUPABASE_KEY", "")
DB_PROVIDER: str = os.getenv("DB_PROVIDER", "hybrid")  # 'hybrid', 'supabase', or 'postgres_local'

# Local PostgreSQL Configuration
LOCAL_POSTGRES_HOST: str = os.getenv("LOCAL_POSTGRES_HOST", "localhost")
LOCAL_POSTGRES_PORT: str = os.getenv("LOCAL_POSTGRES_PORT", "5432")
LOCAL_POSTGRES_USER: str = os.getenv("LOCAL_POSTGRES_USER", "postgres")
LOCAL_POSTGRES_PASSWORD: str = os.getenv("LOCAL_POSTGRES_PASSWORD", "postgres")
LOCAL_POSTGRES_DB: str = os.getenv("LOCAL_POSTGRES_DB", "elderguard_db")
# A local SQLite database makes the application usable out of the box when
# PostgreSQL/Docker has not been configured.  Set LOCAL_POSTGRES_URL (or
# DATABASE_URL) to a PostgreSQL URL in deployed environments.
_DEFAULT_LOCAL_DB = Path(__file__).resolve().parents[2] / "elderguard.db"
LOCAL_POSTGRES_URL: str = os.getenv(
    "LOCAL_POSTGRES_URL",
    os.getenv("DATABASE_URL", f"sqlite:///{_DEFAULT_LOCAL_DB.as_posix()}")
)
JWT_SECRET: str = os.getenv("JWT_SECRET", "elderguard_super_secret_jwt_key_2026")
JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
REFRESH_TOKEN_EXPIRE_DAYS: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))

GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
GROQ_API_KEYS: str = os.getenv("GROQ_API_KEYS", "")
GROQ_MODEL: str = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")

# Notification Service Variables
FIREBASE_CREDENTIALS_JSON: str = os.getenv("FIREBASE_CREDENTIALS_JSON", "")
TELEGRAM_BOT_TOKEN: str = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_BOT_USERNAME: str = os.getenv("TELEGRAM_BOT_USERNAME", "ElderGuardAIBot")
TELEGRAM_WEBHOOK_SECRET: str = os.getenv("TELEGRAM_WEBHOOK_SECRET", "")

# Vitals Escalation Toggle
AUTO_ESCALATE_CRITICAL_VITALS: bool = os.getenv("AUTO_ESCALATE_CRITICAL_VITALS", "false").lower() in ("true", "1", "yes")

# AI Companion Chat History Persistence Toggle
PERSIST_CHAT_HISTORY: bool = os.getenv("PERSIST_CHAT_HISTORY", "false").lower() in ("true", "1", "yes")
