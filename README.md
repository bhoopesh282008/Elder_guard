# ElderGuard AI

A connected elder-care platform that links seniors, family caregivers, doctors, hospitals, and pharmacies in one place. A FastAPI backend and a React/Vite frontend share a single data layer, so a medicine a caregiver adds, a dose an elder marks taken, or an SOS alert shows up on the other side in real time.

**Live demo:** https://elderguard-nmn9.onrender.com (free tier, so the first load after idle can take up to a minute; data resets on restart). Sign in with the [demo accounts](#local-run) below.

## Features

- **1-tap SOS with escalation** - elders trigger an alert from the dashboard; linked caregivers are notified first and unacknowledged alerts escalate to the hospital desk.
- **Medicine reminders** - schedules grouped by time of day, "mark taken" logging, and caregiver notifications on each dose.
- **Vitals tracking** - blood pressure, pulse, glucose, SpO2, and weight, with anomaly flags and trend charts.
- **Appointments and virtual queue** - doctor slots with double-booking prevention, video or in-person consultations, and queue tokens.
- **AI companion** - a chat assistant (Groq-hosted LLM) for companionship, health questions, and AI-written vitals reviews and reports.
- **Prescription scanning** - parses prescription text into structured medicine schedules.
- **Community events** for elders, medical reports, and analytics.
- **Multi-channel notifications** - in-app, Firebase push, and Telegram.
- **Five role-based portals** - Elder, Caregiver, Doctor, Hospital, and Pharmacy.

## Connected Data Flow

All elder-owned records carry an `elder_id`, so caregiver queries are scoped to one elder at a time. Caregiver access is granted only through `elder_caregiver_links` with `status = active`; pending invites do not expose elder data.

When a caregiver adds a medicine through `POST /api/caregiver/elders/{elderId}/medicines`, the backend writes the shared medicine row, records an audit log, creates an elder notification, and emits `medicine:added` to the WebSocket room `elder:{elderId}` via `/ws/elder/{elderId}`. The Elder app receives the event and invalidates React Query caches, so the new medicine appears without a page reload.

When an elder marks a dose taken through `POST /api/elder/medicines/{medicineId}/mark-taken`, the backend writes a `medicine_logs` row, notifies linked caregivers, and emits `medicine:taken` to the same room. Caregiver dashboards listening to that elder room refresh immediately.

The SOS path is fully server-side: `POST /api/elder/sos` writes `connected_sos_events`, records caregiver notification timing, inserts notifications for active linked caregivers, and emits `sos:triggered` to all connected elder/caregiver clients in the elder room.

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| Frontend | React 18, Vite 5, Tailwind CSS, TanStack Query, React Router, Recharts, Axios |
| Backend | FastAPI, Pydantic v2, SQLAlchemy 2, APScheduler, WebSockets |
| Database | SQLite for local demos; PostgreSQL / Supabase via the SQL migrations |
| AI | Groq chat completions (`llama-3.1-8b-instant` by default) |
| Notifications | Firebase Cloud Messaging, Telegram bot, in-app |
| Auth | JWT access and refresh tokens, email/password, Google sign-in |

## Project Structure

```text
backend/
  app/                  FastAPI app: auth, profiles, medicines, emergency, appointments,
                        vitals, ai_companion, ocr, reports, analytics, events, hospital,
                        doctor_records, notifications, connected (shared portal layer + WebSockets)
  supabase/migrations/  PostgreSQL schema, 001 to 015
  seed_connected_demo.py  Creates the demo accounts and data
  test_*.py             Pytest suites per service
frontend/
  src/pages/            elder, caregiver, doctor, hospital, pharmacy portals, auth, landing page
  src/services/api.js   Axios client (VITE_API_URL, defaults to http://127.0.0.1:8000 in dev)
render.yaml             Render Blueprint (single web service)
docker-compose.yml      Local PostgreSQL 16 (optional)
```

## Local Run

Requirements: Python 3.13 and Node.js 18 or newer.

Install dependencies:

```bash
npm install
npm --prefix frontend install
cd backend
python -m venv venv
.\venv\Scripts\pip install -r requirements.txt   # Windows; use venv/bin/pip on macOS/Linux
```

The root `dev:backend` script runs `backend\venv\Scripts\python`, so it is written for Windows. On macOS/Linux, start the two servers yourself (see below).

Seed the connected demo:

```bash
cd backend
python seed_connected_demo.py
```

Start the full stack from the repo root:

```bash
npm run dev
```

Frontend: `http://localhost:5173`  
Backend: `http://127.0.0.1:8000` (interactive API docs at `/docs`)

On macOS/Linux, run these in two terminals instead of `npm run dev`:

```bash
cd backend && venv/bin/python -m uvicorn app.main:app --reload --port 8000
npm --prefix frontend run dev
```

Demo accounts:

```text
elder.demo@elderguard.ai / DemoPass123!
caregiver.demo@elderguard.ai / DemoPass123!
```

## Configuration

The app runs without any configuration. Copy `backend/.env.example` to `backend/.env` to enable more:

| Variable | Purpose |
| :--- | :--- |
| `JWT_SECRET` | Token signing key. Always set this outside local demos; the built-in default is public. |
| `DB_PROVIDER`, `SUPABASE_URL`, `SUPABASE_KEY`, `LOCAL_POSTGRES_*` | Switch from SQLite to Supabase or PostgreSQL |
| `GROQ_API_KEYS`, `GROQ_MODEL` | Enable the AI companion |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in |
| `FIREBASE_CREDENTIALS_JSON` | Push notifications |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` | Telegram alerts |

Without a Groq key the AI companion is unavailable; without Firebase or Telegram credentials only in-app notifications are delivered.

## Database

For local demos, the backend falls back to `backend/elderguard.db` if PostgreSQL is not configured. For PostgreSQL/Supabase, use the SQL migrations in `backend/supabase/migrations`, including `013_connected_portals.sql`. `docker-compose up -d` starts a local PostgreSQL 16 matching the defaults in `.env.example`.

## Deployment

`render.yaml` is a Render Blueprint that runs everything as one web service: it builds the frontend, and FastAPI serves the built `frontend/dist` alongside the API. The free plan has no persistent disk, so the SQLite demo data is re-seeded on every start. Use a PostgreSQL database for anything that has to persist.

## Validation

Run the connected portal integration tests:

```bash
cd backend
pytest test_connected_portals.py
```

These tests cover caregiver invite acceptance, active-link permission enforcement, caregiver-added medicine visibility in the elder endpoint, view-only write blocking, and SOS WebSocket delivery.

## Documentation

- [Report.md](Report.md) - full technical and system architecture report
- [Microservices_User_Flow_System_Design.md](Microservices_User_Flow_System_Design.md) - per-service user flows and diagrams
