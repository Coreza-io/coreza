#!/bin/bash

# Container resource monitoring script
set -e

CONTAINER_NAME="coreza-backend"
ALERT_CPU_THRESHOLD=80
ALERT_MEMORY_THRESHOLD=80
LOG_FILE="/tmp/container-monitor.log"

echo "🔍 Container Resource Monitor Started" | tee -a $LOG_FILE
echo "Monitoring: $CONTAINER_NAME" | tee -a $LOG_FILE
echo "CPU Alert Threshold: ${ALERT_CPU_THRESHOLD}%" | tee -a $LOG_FILE
echo "Memory Alert Threshold: ${ALERT_MEMORY_THRESHOLD}%" | tee -a $LOG_FILE

monitor_container() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    # Check if container is running
    if ! docker ps --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
        echo "[$timestamp] ❌ Container $CONTAINER_NAME is not running!" | tee -a $LOG_FILE
        return 1
    fi
    
    # Get container stats
    local stats=$(docker stats $CONTAINER_NAME --no-stream --format "{{.CPUPerc}}\t{{.MemPerc}}\t{{.MemUsage}}")
    local cpu_percent=$(echo $stats | cut -f1 | sed 's/%//')
    local mem_percent=$(echo $stats | cut -f2 | sed 's/%//')
    local mem_usage=$(echo $stats | cut -f3)
    
    # Log current stats
    echo "[$timestamp] CPU: ${cpu_percent}%, Memory: ${mem_percent}% ($mem_usage)" | tee -a $LOG_FILE
    
    # Check CPU threshold
    if (( $(echo "$cpu_percent > $ALERT_CPU_THRESHOLD" | bc -l) )); then
        echo "[$timestamp] 🚨 HIGH CPU USAGE: ${cpu_percent}%" | tee -a $LOG_FILE
        # Trigger alert (webhook, email, etc.)
        curl -X POST "${ALERT_WEBHOOK_URL:-http://localhost:8000/api/alerts}" \
            -H "Content-Type: application/json" \
            -d "{\"type\":\"high_cpu\",\"value\":\"${cpu_percent}\",\"threshold\":\"${ALERT_CPU_THRESHOLD}\"}" \
            2>/dev/null || true
    fi
    
    # Check Memory threshold
    if (( $(echo "$mem_percent > $ALERT_MEMORY_THRESHOLD" | bc -l) )); then
        echo "[$timestamp] 🚨 HIGH MEMORY USAGE: ${mem_percent}%" | tee -a $LOG_FILE
        curl -X POST "${ALERT_WEBHOOK_URL:-http://localhost:8000/api/alerts}" \
            -H "Content-Type: application/json" \
            -d "{\"type\":\"high_memory\",\"value\":\"${mem_percent}\",\"threshold\":\"${ALERT_MEMORY_THRESHOLD}\"}" \
            2>/dev/null || true
    fi
    
    # Health check
    if ! docker exec $CONTAINER_NAME node healthcheck.js >/dev/null 2>&1; then
        echo "[$timestamp] ❌ Health check failed!" | tee -a $LOG_FILE
        curl -X POST "${ALERT_WEBHOOK_URL:-http://localhost:8000/api/alerts}" \
            -H "Content-Type: application/json" \
            -d "{\"type\":\"health_check_failed\",\"container\":\"${CONTAINER_NAME}\"}" \
            2>/dev/null || true
    fi
}

# Main monitoring loop
while true; do
    monitor_container
    sleep 30
done