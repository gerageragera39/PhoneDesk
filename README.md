# PhoneDesk

![Node 20+](https://img.shields.io/badge/node-20%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)
![React 18](https://img.shields.io/badge/react-18-149eca?style=for-the-badge&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/typescript-5-3178c6?style=for-the-badge&logo=typescript&logoColor=white)
![Platform](https://img.shields.io/badge/platform-windows%20%7C%20linux-111827?style=for-the-badge)

PhoneDesk turns a phone into a polished local control surface for launching desktop applications and using the PC mouse remotely.

> Main application source: [`/phonedesk`](./phonedesk)

## Why it is ready for GitHub

- English-only UI and documentation
- Production-friendly repo cleanup and ignore rules
- Native file picker for quick app onboarding
- Smarter Windows app scanning focused on real user-facing apps
- Faster Windows mouse control through a persistent worker
- Health endpoint, CI workflow, contribution guide, and structured docs

## Quick start

```bash
cd phonedesk
npm ci
npm run build
npm start
```

Open the admin panel locally on your computer, then connect from your phone on the same network.

## Architecture

```mermaid
flowchart LR
  Phone[Phone browser / PWA] --> UI[React client]
  UI --> API[Express API]
  API --> Auth[PIN + JWT auth]
  API --> Apps[JSON app registry]
  API --> Launch[Platform launch strategies]
  API --> Mouse[Remote mouse service]
  Launch --> Win[Windows launcher]
  Launch --> Lin[Linux launcher]
  Mouse --> WinMouse[Windows worker]
  Mouse --> LinMouse[xdotool]
```

## Documentation

- [Project README](./phonedesk/README.md)
- [Installation guide](./phonedesk/docs/INSTALLATION.md)
- [Architecture notes](./phonedesk/docs/ARCHITECTURE.md)
- [Operations guide](./phonedesk/docs/OPERATIONS.md)
- [Security guide](./phonedesk/docs/SECURITY.md)
- [Contributing](./CONTRIBUTING.md)

## Repository note

Do **not** commit the live `data/` folder. It contains runtime state such as the generated PIN hash, app catalog, and audit log. Keep only `.gitkeep` or sample data if you need placeholders.
