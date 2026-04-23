# PhoneDesk

A polished local launcher and remote mouse dashboard for Windows and Linux.

## Highlights

- Mobile-friendly launcher dashboard with live app status
- Floating mouse shortcut on the launcher dashboard for one-tap access to trackpad mode
- PIN-based authentication with JWT sessions and brute-force protection
- Localhost-only admin panel for sensitive actions
- Quick add flow via a **native system file picker**
- Smarter Windows scan based on desktop + Start Menu shortcuts
- Windows app scan now extracts and stores executable icons automatically
- Faster Windows mouse control using a persistent PowerShell worker
- JSON storage with zero database setup
- PWA-ready frontend served directly from the Node server
- Built-in health endpoint: `GET /api/health`

## Tech stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, React Query, Framer Motion
- **Backend:** Express, TypeScript, Zod
- **Security:** Helmet, CORS, express-rate-limit, bcryptjs, jsonwebtoken
- **Persistence:** Local JSON files in `data/`

## Monorepo layout

```text
phonedesk/
├─ client/          # React frontend
├─ server/          # Express API + platform integrations
├─ docs/            # Project documentation
├─ data/            # Runtime state (ignored by Git)
└─ package.json     # Root scripts
```

## Requirements

- Node.js 20+
- Windows or Linux
- WSL is supported for Windows-host control workflows
- Linux mouse support: `xdotool`
- Linux window focusing: `wmctrl` recommended

## Installation

```bash
npm ci
npm ci --prefix client
npm ci --prefix server
```

## Environment

Copy `server/.env.example` if needed.

```env
PORT=3000
NODE_ENV=development
# INITIAL_PIN=123456
```

`INITIAL_PIN` is optional and only matters on first launch.

## Development

```bash
npm run dev
```

## Production build

```bash
npm run build
npm start
```

The production build:

1. builds the client
2. copies the generated frontend into `server/public`
3. builds the server

## First launch

On the first run, PhoneDesk:

1. creates the runtime `data/` files if they do not exist
2. generates a temporary PIN unless `INITIAL_PIN` is set
3. prints:
   - a local URL for the host machine
   - one or more phone URLs for the local network
   - a localhost-only Admin URL for PIN rotation

Then:

- open `http://127.0.0.1:3000/admin` on the host machine
- change the PIN
- add or scan the applications you want to expose
- open the launcher URL on your phone

On Windows scan results:

- executable icons are extracted automatically
- apps already added to the launcher are hidden from the suggestion list

## Key routes

### Auth

- `POST /api/auth/login`
- `GET /api/auth/verify`
- `POST /api/auth/change-pin`

### Apps

- `GET /api/apps`
- `POST /api/apps/:id/launch`
- `GET /api/apps/status`

### Admin

- `GET /api/admin/apps`
- `POST /api/admin/apps`
- `POST /api/admin/apps/pick-executable`
- `POST /api/admin/apps/scan`
- `PUT /api/admin/apps/:id`
- `DELETE /api/admin/apps/:id`

### Mouse

- `POST /api/mouse/move`
- `POST /api/mouse/click`
- `POST /api/mouse/scroll`

### Operations

- `GET /api/health`

## Security notes

- Admin routes are restricted to `localhost`
- API responses under `/api/*` are `no-store`
- PIN login is rate-limited and brute-force protected
- Input payloads are validated with Zod
- Audit events are written to `data/audit.log`

## Data folder

Do **not** push the live `data/` folder to GitHub.

It contains runtime state such as:

- the generated PIN hash
- the JWT secret
- your local application catalog
- audit logs

Keep only `data/.gitkeep` in the repository.

## Documentation

- [Installation](./docs/INSTALLATION.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Operations](./docs/OPERATIONS.md)
- [Security](./docs/SECURITY.md)
