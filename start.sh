#!/bin/bash
# Start HCMC Tour Platform — Backend + Frontend
# Usage: ./start.sh          (foreground, Ctrl+C to stop)
#        ./start.sh --bg     (background, use stop.sh to stop)

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="/data2/shared/haoxi/projects/ZenSVI/venv/bin"
PID_FILE="$PROJECT_DIR/.pids"
BG_MODE=false

if [[ "$1" == "--bg" ]]; then
  BG_MODE=true
fi

# Detect LAN IP
LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [[ -z "$LAN_IP" ]]; then
  LAN_IP="localhost"
fi

# Clean up any stale server processes on our ports (LISTEN only, not SSH tunnels)
for port in 3721 3722; do
  pids=$(lsof -ti:$port -sTCP:LISTEN 2>/dev/null)
  if [[ -n "$pids" ]]; then
    echo "Killing stale listener(s) on port $port..."
    echo "$pids" | xargs kill 2>/dev/null
    sleep 1
  fi
done

# Ensure logs dir exists before nohup writes to it
mkdir -p "$PROJECT_DIR/logs"

# Truncate old logs if they exceed 50MB
MAX_LOG_SIZE=$((50 * 1024 * 1024))
for logfile in "$PROJECT_DIR/logs/backend.log" "$PROJECT_DIR/logs/frontend.log"; do
  if [[ -f "$logfile" ]] && [[ $(stat -c%s "$logfile" 2>/dev/null || echo 0) -gt $MAX_LOG_SIZE ]]; then
    echo "Truncating oversized log: $logfile"
    : > "$logfile"
  fi
done

echo "=== HCMC Street View Tour Platform ==="
echo ""

# Start backend
echo "[1/2] Starting FastAPI backend on port 3722..."
cd "$PROJECT_DIR"
if $BG_MODE; then
  nohup $VENV/uvicorn backend.main:app --host 0.0.0.0 --port 3722 > "$PROJECT_DIR/logs/backend.log" 2>&1 &
else
  $VENV/uvicorn backend.main:app --host 0.0.0.0 --port 3722 &
fi
BACKEND_PID=$!
echo "  Backend PID: $BACKEND_PID"

# Wait for backend to be ready
sleep 2

# Start frontend dev server
echo "[2/2] Starting Vite dev server on port 3721..."
cd "$PROJECT_DIR/frontend"
if $BG_MODE; then
  nohup npx vite --host 0.0.0.0 --port 3721 > "$PROJECT_DIR/logs/frontend.log" 2>&1 &
else
  npx vite --host 0.0.0.0 --port 3721 &
fi
FRONTEND_PID=$!
echo "  Frontend PID: $FRONTEND_PID"

# Save PIDs
echo "$BACKEND_PID" > "$PID_FILE"
echo "$FRONTEND_PID" >> "$PID_FILE"

# Health check: verify both processes survived startup
sleep 3
HEALTH_OK=true
if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
  echo "ERROR: Backend (PID $BACKEND_PID) died on startup. Check logs/backend.log"
  HEALTH_OK=false
fi
if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
  echo "ERROR: Frontend (PID $FRONTEND_PID) died on startup. Check logs/frontend.log"
  HEALTH_OK=false
fi
if ! $HEALTH_OK; then
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
  rm -f "$PID_FILE"
  exit 1
fi

echo ""
echo "=== Platform Running ==="
echo "  Frontend: http://localhost:3721"
echo "  Backend:  http://localhost:3722"
echo "  API docs: http://localhost:3722/docs"
echo ""
echo "  LAN access:  http://$LAN_IP:3721"
echo ""
HOSTNAME=$(hostname 2>/dev/null || echo "server")
echo "  SSH tunnel (run on your local machine):"
echo "    ssh -L 3721:localhost:3721 -L 3722:localhost:3722 $(whoami)@$HOSTNAME"
echo "    then open http://localhost:3721 in your browser"
echo ""

if $BG_MODE; then
  echo "Running in background. Logs:"
  echo "  Backend:  $PROJECT_DIR/logs/backend.log"
  echo "  Frontend: $PROJECT_DIR/logs/frontend.log"
  echo ""
  echo "Run ./stop.sh to shut down."
else
  echo "Press Ctrl+C to stop both servers."
  trap "echo 'Shutting down...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; rm -f '$PID_FILE'; exit 0" INT TERM
  wait
fi
