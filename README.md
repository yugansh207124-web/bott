# Note Bot listener (for Render)

Runs the bot that receives your DMs and enforces the server lockdown.

## Render settings
- Type: Web Service
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`

## Environment variables (Render Environment tab only, never in the repo)
| Name | What it is |
|---|---|
| DISCORD_BOT_TOKEN | Bot token (Developer Portal, Bot page) |
| WORKER_URL | Your Worker URL, e.g. https://notes.yugansh207124.workers.dev (no trailing slash) |
| INGEST_SECRET | Same value as the Worker's INGEST_SECRET |
| OWNER_USER_ID | Your Discord user ID |
| GUILD_ID | Your server ID |
| ALLOWED_USER_IDS | Comma-separated IDs allowed to stay in the server (empty for now) |
| LOCKDOWN | `on` (kick anyone not allowed) or `off` |

Do not set PORT. Render sets it.

## Discord checks
- Developer Portal, Bot page: turn on Message Content Intent and Server Members Intent.
- The bot's role in the server has Kick Members and sits above other roles.
