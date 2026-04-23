# Installation Guide

## 1. Install dependencies

```bash
npm ci
npm ci --prefix client
npm ci --prefix server
```

## 2. Optional environment file

Create `server/.env` if you want custom settings.

```env
PORT=3000
NODE_ENV=development
# INITIAL_PIN=123456
```

## 3. Start in development

```bash
npm run dev
```

## 4. Build for production

```bash
npm run build
npm start
```

## First startup expectations

When the server starts successfully, the terminal prints:

- a local URL for the host machine
- one or more phone URLs for your LAN
- the localhost-only Admin URL used to rotate the PIN

If you run the server from WSL, prefer the printed **Windows host** LAN URL on your phone.

## Linux requirements

Install the optional desktop helpers if you want full platform support:

```bash
sudo apt install xdotool wmctrl zenity
```

- `xdotool` → mouse control
- `wmctrl` → focusing existing windows
- `zenity` → native file picker for quick add

## Windows notes

- Windows app scans can extract icons directly from discovered executables.
- The launcher dashboard includes a floating shortcut to the remote mouse page.
