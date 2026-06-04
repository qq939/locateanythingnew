#!/bin/bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${PROJECT_DIR}/logs"
PID_FILE="${LOG_DIR}/server.pid"
SYSTEM_PYTHON="${PYTHON:-python3}"
VENV_DIR="${PROJECT_DIR}/.venv"
PYTHON_BIN="${VENV_DIR}/bin/python"
mkdir -p "${LOG_DIR}"
touch "${LOG_DIR}/start.log"
if [ ! -x "${PYTHON_BIN}" ]; then
  echo "Creating Python virtual environment..." >> "${LOG_DIR}/start.log"
  "${SYSTEM_PYTHON}" -m venv "${VENV_DIR}" >> "${LOG_DIR}/start.log" 2>&1 || {
    echo "Python venv creation failed; falling back to ${SYSTEM_PYTHON}." >> "${LOG_DIR}/start.log"
    PYTHON_BIN="${SYSTEM_PYTHON}"
  }
fi
if ! "${PYTHON_BIN}" - <<'PY' >/dev/null 2>&1
import torch
import transformers
import PIL
PY
then
  echo "Installing LocateAnything Python dependencies..." >> "${LOG_DIR}/start.log"
  "${PYTHON_BIN}" -m pip install --upgrade pip >> "${LOG_DIR}/start.log" 2>&1 || true
  "${PYTHON_BIN}" -m pip install -r "${PROJECT_DIR}/requirements.txt" >> "${LOG_DIR}/start.log" 2>&1 || {
    echo "Python dependency installation failed; web UI will still start and show model status." >> "${LOG_DIR}/start.log"
  }
fi
if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti tcp:8082 2>/dev/null || true)"
  if [ -n "${PIDS}" ]; then kill ${PIDS} 2>/dev/null || true; sleep 1; fi
fi
screen -S locateanythingnew-8082 -X quit >/dev/null 2>&1 || true
: > "${LOG_DIR}/run.log"
if command -v screen >/dev/null 2>&1; then
  screen -dmS locateanythingnew-8082 /bin/bash -lc "cd '${PROJECT_DIR}' && export PYTHON='${PYTHON_BIN}' && exec node server.js >> logs/start.log 2>&1"
  sleep 1
  lsof -ti tcp:8082 2>/dev/null | head -1 > "${PID_FILE}" || true
else
  PYTHON="${PYTHON_BIN}" nohup node "${PROJECT_DIR}/server.js" >> "${LOG_DIR}/start.log" 2>&1 &
  echo $! > "${PID_FILE}"
fi
echo "LocateAnything New started on 8082"
