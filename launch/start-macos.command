#!/bin/bash
# =============================================================================
#  Current Weather App - macOS launcher
#
#  Double-click this file. It installs what's needed the first time, starts the
#  app, and opens your browser. No commands to type.
#
#  First time only: macOS may refuse to run it. If so, right-click the file,
#  choose Open, then click Open again on the warning.
#
#  Keep the Terminal window open while you use the app. Closing it stops the app.
# =============================================================================

set -u
cd "$(dirname "$0")/../server" || exit 1

printf '\n  Current Weather App\n  ===================\n\n'

# --- Is Node installed? ---
if ! command -v node >/dev/null 2>&1; then
  cat <<'EOF'
  Node.js is not installed, and the app needs it to run.

  1. Go to  https://nodejs.org
  2. Download the "LTS" version for macOS and run the installer
  3. Accept all the defaults
  4. Close this window and double-click this file again

EOF
  read -r -p "  Press Return to close. "
  exit 1
fi

printf '  Node.js %s found.\n' "$(node --version)"

# --- First run? Install dependencies. ---
if [ ! -d node_modules ]; then
  printf '  First run - installing dependencies. This takes a minute...\n\n'
  if ! npm install --no-audit --no-fund; then
    printf '\n  Install failed. Check your internet connection and try again.\n'
    read -r -p "  Press Return to close. "
    exit 1
  fi
  printf '\n'
fi

# --- No settings file yet? Start from the example. ---
if [ ! -f .env ]; then
  cp .env.example .env
  printf '  Created server/.env - open it in TextEdit to add your Gmail\n'
  printf '  App Password and Anthropic API key.\n\n'
fi

printf '  Starting the app...\n'
printf '  Your browser will open in a moment. Keep this window open.\n\n'

# Open the browser once the port is actually accepting connections, so we never
# land on an error page because we were half a second early.
(
  for _ in $(seq 1 40); do
    if curl -s -o /dev/null "http://localhost:8787/api/health"; then
      open "http://localhost:8787"
      exit 0
    fi
    sleep 0.5
  done
) &

# Stop the background opener if the server exits first.
trap 'kill %1 2>/dev/null' EXIT

node src/index.js

printf '\n  The app has stopped.\n'
read -r -p "  Press Return to close. "
