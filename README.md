# CRM Software for Organisation

A lightweight CRM starter app for managing:
- Contacts
- Sales leads
- Follow-up tasks

## Features
- Dashboard with live counters
- Add and view contacts
- Add and view leads with stage and estimated value
- Add and complete follow-up tasks
- Persistent storage using browser localStorage

## Project files
- `index.html` → UI structure
- `styles.css` → styling
- `app.js` → CRM logic and localStorage persistence

## Run on your local machine

### Option 1: Open directly (quickest)
1. Download/clone this repository.
2. Open the project folder.
3. Double-click `index.html`.

### Option 2: Run with Python HTTP server (recommended)
1. Open terminal in the project folder.
2. Run:

```bash
python3 -m http.server 8080
```

3. Open browser: `http://localhost:8080`
4. Stop server with `Ctrl + C`.

## Run in VS Code (VSC)

### Method A: VS Code + Live Server extension
1. Open VS Code.
2. Go to **Extensions** and install **Live Server** (by Ritwick Dey).
3. Open this project folder in VS Code.
4. Right-click `index.html` → **Open with Live Server**.
5. Your app opens in browser (usually `http://127.0.0.1:5500`).

### Method B: VS Code terminal + Python
1. Open this project folder in VS Code.
2. Open terminal (**Terminal → New Terminal**).
3. Run:

```bash
python3 -m http.server 8080
```

4. Open `http://localhost:8080`.

## Troubleshooting
- If `python3` is not found, install Python 3 and retry.
- If port `8080` is busy, run on another port:

```bash
python3 -m http.server 9090
```

Then open `http://localhost:9090`.

## Suggested next upgrades
- Multi-user login with role-based access
- Backend database (PostgreSQL / MySQL)
- Lead assignment and pipeline analytics
- Activity timeline and email/SMS integration
- Import/export via CSV
## Multi-user RBAC upgrade
For a full step-by-step implementation plan, see `docs/RBAC_SETUP.md`.

