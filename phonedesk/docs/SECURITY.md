# Security Guide

## Built-in protections

- PIN-based login
- JWT session validation
- brute-force blocking after repeated failed PIN attempts
- localhost-only admin routes
- request validation through Zod
- security headers via Helmet
- API rate limiting
- `Cache-Control: no-store` on API routes

## Recommended usage

- Use PhoneDesk only on trusted local networks.
- Change the generated PIN immediately after first launch.
- Do not expose the admin panel through a reverse proxy without extra safeguards.
- Do not commit `data/config.json` or `data/audit.log`.
