#!/bin/bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${PROJECT_DIR}/logs"
PID_FILE="${LOG_DIR}/server.pid"
mkdir -p "${LOG_DIR}"
if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti tcp:8082 2>/dev/null || true)"
  if [ -n "${PIDS}" ]; then kill ${PIDS} 2>/dev/null || true; sleep 1; fi
fi
screen -S locateanythingnew-8082 -X quit >/dev/null 2>&1 || true
: > "${LOG_DIR}/run.log"
if command -v screen >/dev/null 2>&1; then
  screen -dmS locateanythingnew-8082 /bin/bash -lc "cd '${PROJECT_DIR}' && exec node server.js >> logs/start.log 2>&1"
  sleep 1
  lsof -ti tcp:8082 2>/dev/null | head -1 > "${PID_FILE}" || true
else
  nohup node "${PROJECT_DIR}/server.js" >> "${LOG_DIR}/start.log" 2>&1 &
  echo $! > "${PID_FILE}"
fi
echo "LocateAnything New started on 8082"
