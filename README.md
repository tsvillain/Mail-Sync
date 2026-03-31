# MailSync — Gmail Multi-Account Backup & Archive System

> **"Your emails are evidence. Treat them like it."**
>
> The moment you leave an organization, your access is revoked. Every thread, every approval, every agreement you were CC'd on gone. MailSync ensures that before the door closes, your record is already safe.

---

## Why This Exists

Email is not just communication — it is documentation. Every project kick-off, every verbal agreement that became written, every complaint escalation, every performance review, every decision you were part of — lives in your inbox.

When you leave a company, your email account is typically deactivated within hours. If you are ever in a position where you need to:

- Prove you raised a concern before a decision was made
- Demonstrate your contributions to a project
- Reference an agreement or commitment made by a third party
- Support a legal, HR, or compliance inquiry
- Simply retain institutional knowledge that belongs to you

...and you have no backup — **you have nothing**.

MailSync is a self-hosted Gmail archival system that continuously syncs one or more Gmail accounts into a private MongoDB database, giving you a permanent, searchable, exportable record of your email history. It runs on your machine or your own server, stores data you control, and requires no third-party cloud service beyond Google's own OAuth API.

**Taking a backup is not paranoia. It is professional due diligence.**

---

## What It Does

- Connects to multiple Gmail accounts via Google OAuth 2.0
- Performs a full historical sync on first run, then incremental syncs every 15 minutes
- Stores all email metadata, headers, body text, HTML, and attachment info in MongoDB
- Provides a web dashboard to browse, search, and manage your archived emails
- Supports bulk export to JSONL format (portable, legally admissible records)
- Supports bulk import for restoring or migrating archives
- Optionally saves attachments to local disk or AWS S3
- Runs entirely self-hosted via Docker or Node.js — your data never leaves your infrastructure

---

## Tech Stack

| Layer              | Technology                                                    |
| ------------------ | ------------------------------------------------------------- |
| Backend            | Node.js 24+, Bun, node-cron, googleapis                       |
| Frontend           | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Database           | MongoDB (via Mongoose)                                        |
| Auth               | Google OAuth 2.0 (read-only Gmail scopes)                     |
| Containerization   | Docker, Docker Compose                                        |
| Attachment Storage | Local disk or AWS S3 (configurable)                           |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    Docker Container                 │
│                                                     │
│  ┌──────────────────┐     ┌───────────────────────┐ │
│  │   Node.js Server │     │   Next.js Dashboard   │ │
│  │   (port 3000)    │◄───►│   (port 3001)         │ │
│  │                  │     │                       │ │
│  │  - OAuth flow     │     │  - Account overview   │ │
│  │  - REST API      │     │  - Email browser      │ │
│  │  - Cron sync     │     │  - Import / Export    │ │
│  │  - Gmail API     │     │  - Settings panel     │ │
│  └────────┬─────────┘     └──────────┬────────────┘ │
│           │                          │              │
│           └──────────┬───────────────┘              │
│                      ▼                              │
│              ┌───────────────┐                      │
│              │    MongoDB    │                      │
│              │               │                      │
│              │  GmailEmail   │                      │
│              │  AccountCreds │                      │
│              │  SyncState    │                      │
│              │  GmailLabel   │                      │
│              │  AppConfig     │                      │
│              └───────────────┘                      │
└─────────────────────────────────────────────────────┘
```

---

## Prerequisites

### For Local Development

- Node.js 24.10.0 or higher
- Bun 1.1.7 or higher ([install](https://bun.sh))
- MongoDB (local instance or MongoDB Atlas URI)
- A Google Cloud project with OAuth 2.0 credentials (see setup below)

### For Docker

- Docker Desktop or Docker Engine + Docker Compose v2
- MongoDB (local or remote — the container does not include a database)

---

## Step 1 — Google OAuth Setup

You must create a Google Cloud project and OAuth credentials before running the application.

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Navigate to **APIs & Services → Library**
4. Search for and enable **Gmail API**
5. Navigate to **APIs & Services → Credentials**
6. Click **Create Credentials → OAuth 2.0 Client ID**
7. Set Application type to **Web application**
8. Under **Authorized redirect URIs**, add:
   ```
   http://localhost:3000/auth/callback
   ```
   (Replace `localhost:3000` with your production domain if deploying)
9. Click **Create**
10. Copy your **Client ID** and **Client Secret** — you will need these in `.env`

> If this is your first OAuth app in this project, you may also need to configure the **OAuth consent screen** under APIs & Services. Set it to **External**, add your own email as a test user, and add the scope `https://www.googleapis.com/auth/gmail.readonly`.

---

## Step 2 — Configuration

Copy the sample environment file and fill in your values:

```bash
cp .env.sample .env
```

Open `.env` and configure the following:

```env
# MongoDB connection string
MONGODB_URI=mongodb://localhost:27017/mailsync

# Google OAuth credentials (from Step 1)
GMAIL_CLIENT_ID=your-client-id.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=GOCSPX-your-client-secret

# Optional: pre-seed accounts (or add via the dashboard UI)
GMAIL_ACCOUNTS=you@gmail.com,work@domain.com

# Server and client URLs
BASE_URL=http://localhost:3000
AUTH_PORT=3000
FRONTEND_URL=http://localhost:3001
SERVER_URL=http://localhost:3000

# Sync schedule (cron syntax — default is every 15 minutes)
CRON_SCHEDULE=*/15 * * * *

# Optional: password-protect the dashboard
AUTH_PASSWORD=

# Optional: enable verbose debug logging
DEBUG=
```

---

## Running Locally (Without Docker)

### 1. Install dependencies

```bash
bun install
```

### 2. Start the application

```bash
bun run dev
```

This starts both the backend server (port 3000) and the Next.js dashboard (port 3001) concurrently.

### 3. Open the dashboard

Navigate to [http://localhost:3001](http://localhost:3001)

### 4. Add your first account

- Click **Add Account**
- You will be redirected to Google's OAuth consent screen
- Grant read-only Gmail access
- You will be redirected back to the dashboard
- A full historical sync begins immediately in the background

---

## Running with Docker

Docker is the recommended way to run MailSync in production. The image bundles both the server and the Next.js client into a single Alpine-based container.

### Option A — Pull & Run from Docker Hub (quickest way to test)

The fastest way to get started is to pull the pre-built image directly from Docker Hub — no cloning or building required:

```bash
docker run -d \
  -p 3000:3000 \
  -p 3001:3001 \
  -e "MONGODB_URI=mongodb://192.168.1.2:27017/mail-sync?directConnection=true" \
  -e GMAIL_CLIENT_ID=your-client-id.apps.googleusercontent.com \
  -e GMAIL_CLIENT_SECRET=GOCSPX-your-client-secret \
  -e BASE_URL=http://localhost:3000 \
  -e FRONTEND_URL=http://localhost:3001 \
  -v ~/attachments:/app/attachments \
  gadgetvala/mail-sync:latest
```

Replace the `MONGODB_URI` with your MongoDB host IP, and fill in your OAuth credentials from Step 1. The dashboard will be available at [http://localhost:3001](http://localhost:3001).

> **Tip:** If MongoDB is running on your host machine, use its LAN IP (e.g. `192.168.1.x`) instead of `localhost`, since `localhost` inside the container refers to the container itself — not your host.

---

### Option B — Docker Compose (recommended for self-hosted)

```bash
# Build and start (detached)
docker compose up --build -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

The `docker-compose.yml` mounts a local `./attachments` directory into the container for persistent attachment storage.

### Option B — Manual docker run

```bash
# Build the image
docker build -t mailsync .

# Run the container
docker run -d \
  --name mailsync \
  -p 3000:3000 \
  -p 3001:3001 \
  --env-file .env \
  -v "$(pwd)/attachments:/app/attachments" \
  mailsync
```

### Ports

| Port | Service                      |
| ---- | ---------------------------- |
| 3000 | Backend API + OAuth callback |
| 3001 | Web dashboard (Next.js)      |

> If you are deploying behind a reverse proxy (nginx, Caddy, Traefik), make sure both ports are accessible and your `BASE_URL` in `.env` points to the externally reachable domain.

---

## Using the Dashboard

Once running, open [http://localhost:3001](http://localhost:3001).

### Account Overview

The home page shows all connected Gmail accounts with:

- Authorization status (Authorized / Pending / Error)
- Total emails synced
- Unread count
- Last sync timestamp

### Adding an Account

Click **Add Account** to start the OAuth flow for a new Gmail address. No server restart required.

### Browsing Emails

Click any account to open its email list. Click any email to view the full thread, headers, and body.

### Manual Sync

Click **Sync Now** on any account to trigger an immediate sync outside the cron schedule.

### Export

Click **Export** to download a full JSONL archive of all emails for that account. Each line is a self-contained JSON record — portable, human-readable, and suitable for legal archival.

### Import

Click **Import** to restore a previously exported JSONL file back into the database.

### Settings

The **Settings** panel lets you configure:

- Whether to download email attachments
- Attachment storage backend (local disk or AWS S3)
- Maximum attachment size limit
- AWS S3 credentials (bucket, region, access key)

### Revoking Access

Click **Revoke** on any account to remove its OAuth tokens and stop syncing. Existing archived emails remain in the database.

---

## Data Model

All data is stored in MongoDB under the configured `MONGODB_URI` database.

| Collection           | Contents                                                       |
| -------------------- | -------------------------------------------------------------- |
| `gmailemails`        | Full email records — headers, body, labels, flags, attachments |
| `accountcredentials` | OAuth tokens, sync state, error tracking per account           |
| `syncstates`         | Gmail history IDs for incremental sync per account             |
| `gmaillabels`        | Label/folder metadata (Inbox, Sent, custom labels)             |
| `appconfigs`         | Global application settings (attachment config, S3 creds)      |

Each email document includes: `from`, `to`, `cc`, `bcc`, `subject`, `date`, `bodyText`, `bodyHtml`, `threadId`, `labels`, `isUnread`, `isStarred`, `isSent`, `isTrash`, `isDraft`, `attachments[]`, and full indexing on `gmailId` and `syncedFromAccount`.

---

## Sync Behavior

| Scenario                       | Behavior                                                      |
| ------------------------------ | ------------------------------------------------------------- |
| First account authorization    | Full historical sync (all messages, no limit)                 |
| Subsequent cron runs           | Incremental sync using Gmail History API                      |
| Rate limit hit                 | Exponential backoff, up to 4 automatic retries                |
| Concurrent sync attempt        | Locked per account — second run skipped safely                |
| 5 consecutive sync errors      | Account flagged as errored, manual intervention required      |
| Container shutdown during sync | Graceful — waits up to 60 seconds for active sync to complete |

---

## Project Structure

```
backup_full_gmail/
├── .env.sample                   # Configuration template
├── docker-compose.yml            # Docker Compose orchestration
├── Dockerfile                    # Multi-stage production image
├── docker-entrypoint.sh          # Container startup manager
├── package.json                  # Root monorepo config
│
├── server/                       # Backend (Node.js)
│   └── src/
│       ├── index.js              # Entry point + cron scheduler
│       ├── server.js             # HTTP server + API router
│       ├── config/
│       │   ├── db.js             # MongoDB models
│       │   └── env.js            # Environment validation
│       ├── routes/
│       │   ├── auth.js           # OAuth start / callback / revoke
│       │   └── api.js            # REST endpoints
│       └── services/
│           ├── emailMonitor.js   # Gmail sync engine
│           └── extractor.js      # Email parsing + attachment handler
│
└── client/                       # Frontend (Next.js)
    ├── next.config.ts            # Proxy config + env injection
    ├── lib/db.ts                 # Mongoose models (read-only)
    └── app/
        ├── page.tsx              # Dashboard home
        ├── login/page.tsx        # Password-protect login
        ├── [account]/page.tsx    # Email list for an account
        ├── [account]/[emailId]/  # Email thread detail
        └── api/                  # Server-side API routes
```

---

## NPM Scripts

| Command               | Description                                            |
| --------------------- | ------------------------------------------------------ |
| `bun run dev`         | Start server + client in development mode (hot reload) |
| `bun run build`       | Build Next.js for production                           |
| `bun run start`       | Start server + client in production mode               |
| `bun run install:all` | Install all workspace dependencies                     |

---

## Legal & Compliance Notes

MailSync archives your own email, from your own Google account, using official Google APIs with OAuth 2.0 — the same authorization mechanism Google itself uses. All data is stored on infrastructure you own and control.

**Exported JSONL records include:**

- Full message headers (From, To, CC, BCC, Date, Subject, Message-ID, References)
- Complete message body (plain text and HTML)
- Attachment metadata
- Gmail label and folder state
- Timestamps of sync and original receipt

When used as supporting documentation, exported records should be accompanied by the sync logs and the original OAuth authorization record to demonstrate chain of custody.

> This software does not provide legal advice. Consult your legal counsel regarding email retention obligations and admissibility requirements in your jurisdiction.

---

## Security

- OAuth tokens are stored in MongoDB in your own infrastructure — never sent to any third party
- Gmail access is **read-only** — the application cannot send, delete, or modify emails
- The Next.js frontend connects to MongoDB in read-only mode
- Docker container runs as a non-root user (`appuser`)
- Optional dashboard password protection via `AUTH_PASSWORD`
- No telemetry, no analytics, no external calls beyond Google's Gmail API

---

## Troubleshooting

**OAuth redirect URI mismatch**
Ensure the redirect URI in your Google Cloud credentials exactly matches `BASE_URL/auth/callback` in your `.env`.

**MongoDB connection refused**
Confirm your `MONGODB_URI` is reachable from within the container. For Docker, use `host.docker.internal` instead of `localhost` if MongoDB is running on the host machine.

**Sync not running**
Check that the account shows as **Authorized** in the dashboard. Accounts in **Pending** or **Error** state will not sync until re-authorized or cleared.

**Gmail API quota exceeded**
The sync engine includes automatic rate-limit handling. If you are syncing many accounts simultaneously, consider adjusting `CRON_SCHEDULE` to a longer interval.

**Attachments not saving**
Ensure the `./attachments` volume is mounted and writable, and that **Save Attachments** is enabled in the Settings panel.

---

## License

MIT License — use freely, host privately, archive responsibly.

---

_Built with ❤️ by **gadgetvala** for the professional who understands that records matter, access is temporary, and preparation is the only guarantee._
