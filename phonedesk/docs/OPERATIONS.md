# Operations Guide

## Health check

```http
GET /api/health
```

Example response:

```json
{
  "status": "ok",
  "platform": "windows",
  "environment": "production",
  "uptimeSeconds": 143,
  "timestamp": "2026-04-20T00:00:00.000Z"
}
```

## Useful commands

```bash
npm run dev
npm run typecheck
npm run build
npm start
```

## Deployment notes

- Keep PhoneDesk inside a trusted local network.
- Open the Admin page only on the host machine.
- Rotate the PIN after first startup.
- Back up only the files you truly need from `data/`.
- On WSL-based setups, use the printed Windows-host phone URL instead of the WSL guest IP.

## Runtime behavior to expect

- The server prints local, phone, and Admin URLs on startup.
- Windows scans return launcher-ready suggestions with extracted icons.
- Suggestions already added to the launcher disappear from the scan-results list.
- The dashboard includes a fixed shortcut button for mouse mode.

## Git guidance

Recommended:

- commit source code
- commit docs
- commit `.env.example`
- ignore live `data/`
- ignore build output and `node_modules`
