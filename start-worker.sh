#!/bin/bash
# SurveyAI Worker — Start persistent background worker
# Usage: ./start-worker.sh

set -e

WORKER_DIR="/root/projects/surveyai/worker"
LOG_FILE="/tmp/surveyai-worker.log"
PID_FILE="/tmp/surveyai-worker.pid"

# Kill existing worker if running
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Stopping existing worker (PID $OLD_PID)..."
    kill "$OLD_PID"
    sleep 2
  fi
  rm -f "$PID_FILE"
fi

echo "Starting SurveyAI worker..."
cd "$WORKER_DIR"

# Source the env file
export $(grep -v '^#' .env | xargs)

# Start worker in background
nohup python3 main.py > "$LOG_FILE" 2>&1 &
WORKER_PID=$!
echo "$WORKER_PID" > "$PID_FILE"

echo "Worker started (PID $WORKER_PID)"
echo "Log: $LOG_FILE"
echo "Stop with: kill $(cat $PID_FILE)"
