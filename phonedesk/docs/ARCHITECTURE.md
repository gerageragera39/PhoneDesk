# Architecture

## Overview

PhoneDesk is a small full-stack app with a React frontend and an Express backend.

- The **client** is a mobile-optimized PWA-like web app.
- The **server** provides authentication, application management, launch orchestration, and mouse control.
- Persistent state is stored in JSON files inside `data/`.

## Backend modules

### `auth`

- Generates or loads the PIN hash and JWT secret
- Performs login validation
- Enforces brute-force protection
- Supports PIN rotation

### `apps`

- Stores launcher entries
- Returns app lists for users and admins
- Provides native executable picking
- Scans likely user-facing apps on Windows and Linux

### `launcher`

- Validates executable paths
- Launches or focuses apps via platform strategies
- Streams running-state updates through SSE

### `mouse`

- Accepts relative move/click/scroll commands
- Uses `xdotool` on Linux
- Uses a persistent PowerShell worker on Windows for lower latency

## Storage model

Runtime state lives in:

- `data/config.json`
- `data/apps.windows.json`
- `data/apps.linux.json`
- `data/audit.log`

No database is required.
