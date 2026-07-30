#!/bin/bash
# =============================================================================
#  Current Weather App - Linux launcher
#
#  Run it from your file manager (mark it executable first) or with:
#      ./launch/start-linux.sh
#
#  It installs what's needed the first time, starts the app, and opens your
#  browser. Keep the terminal open while you use the app.
# =============================================================================

set -u
cd "$(dirname "$0")/../server" || exit 1

printf '\n  Current Weather App\n  ===================\n\n'

if ! command -v node >/dev/null 2>&1; then
  cat <<'EOF'
  Node.js is not installed, and the app needs it to run.

  Install it with your package manager, for example:
      Debian/Ubuntu   sudo apt install nodejs npm
      Fedora          sudo dnf install nodejs
      Arch            sudo pacman -S nodejs npm

  Node 18 or newer is required. Then run this script again.

EOF
  exit 1
fi

printf '  Node.js %s found.\n' "$(node --version)"

if [ ! -d node_modules ]; then
  printf '  First run - installing dependencies. This takes a minute...\n\n'
  if ! npm install --no-audit --no-fund; then
    printf '\n  Install failed. Check your internet connection and try again.\n'
    exit 1
  fi
  printf '\n'
fi

if [ ! -f .env ]; then
  cp .env.example .env
  printf '  Created server/.env - edit it to add your Gmail App Password\n'
  printf '  and Anthropic API key.\n\n'
fi

printf '  Starting the app...\n'
printf '  Your browser will open in a moment. Keep this terminal open.\n\n'

# Wait for the port to actually accept connections before opening the browser.
(
  for _ in $(seq 1 40); do
    if curl -s -o /dev/null "http://localhost:8787/api/health"; then
      xdg-open "http://localhost:8787" >/dev/null 2>&1
      exit 0
    fi
    sleep 0.5
  done
) &

trap 'kill %1 2>/dev/null' EXIT

node src/index.js

printf '\n  The app has stopped.\n'
