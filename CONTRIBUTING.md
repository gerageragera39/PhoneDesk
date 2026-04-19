# Contributing to PhoneDesk

## Development setup

```bash
cd phonedesk
npm ci
npm run dev
```

## Before opening a PR

Run:

```bash
npm run typecheck
npm run build
```

## Guidelines

- Keep the UI and docs in English.
- Prefer production-safe defaults.
- Avoid committing runtime `data/`, local `.env` files, or build artifacts.
- If you touch platform-specific logic, mention how it was tested.
