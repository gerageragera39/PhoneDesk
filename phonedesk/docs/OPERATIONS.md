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

## Git guidance

Recommended:

- commit source code
- commit docs
- commit `.env.example`
- ignore live `data/`
- ignore build output and `node_modules`
