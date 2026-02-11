#!/bin/bash
# Stop HCMC Tour Platform — kill backend + frontend
# Usage: ./stop.sh

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$PROJECT_DIR/.pids"

echo "=== Stopping HCMC Tour Platform ==="

stopped=0

# Try PID file first
if [[ -f "$PID_FILE" ]]; then
  while read -r pid; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null
      echo "  Killed process $pid"
      ((stopped++))
    fi
  done < "$PID_FILE"
  rm -f "$PID_FILE"
fi

# Fallback: kill by port — ONLY processes in LISTEN state (servers),
# NOT ssh tunnel connections which would disconnect the SSH session
for port in 3722 3721; do
  pids=$(lsof -ti:"$port" -sTCP:LISTEN 2>/dev/null)
  if [[ -n "$pids" ]]; then
    echo "$pids" | xargs kill 2>/dev/null
    echo "  Killed listener(s) on port $port"
    ((stopped++))
  fi
done

if [[ $stopped -eq 0 ]]; then
  echo "  No running processes found."
else
  echo ""
  echo "Platform stopped."
fi
