#!/bin/bash
# AI Gateway v2.0 Cluster Monitoring and Alert Script
# Monitors AI Gateway clusters and sends alerts for issues

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/../logs/cluster-monitor.log"
ALERT_FILE="$SCRIPT_DIR/../logs/cluster-alerts.log"

# Critical clusters to monitor for AI Gateway
# Only monitor AI Gateway specific clusters
CRITICAL_CLUSTERS=("ai-gateway" "ai-gateway-prod")

# Ensure log directories exist
mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$ALERT_FILE")"

log_monitor() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

log_alert() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - ALERT: $1" | tee -a "$ALERT_FILE"
    log_monitor "ALERT: $1"
}

check_cluster_exists() {
    local cluster_name="$1"
    
    if k3d cluster list | grep -q "$cluster_name"; then
        return 0
    else
        return 1
    fi
}

check_cluster_health() {
    local cluster_name="$1"
    local health_status="healthy"
    local issues=()
    
    # Check if cluster exists
    if ! check_cluster_exists "$cluster_name"; then
        health_status="missing"
        issues+=("Cluster does not exist")
        return 1
    fi
    
    # Check cluster status
    local cluster_status=$(k3d cluster list | grep "$cluster_name" | awk '{print $2}')
    if [[ "$cluster_status" != "running" ]]; then
        health_status="unhealthy"
        issues+=("Cluster status: $cluster_status")
    fi
    
    # Check node readiness
    local context="k3d-$cluster_name"
    if ! kubectl --context="$context" get nodes --no-headers 2>/dev/null | grep -q "Ready"; then
        health_status="unhealthy"
        issues+=("No ready nodes found")
    fi
    
    # Check critical pods
    local failed_pods=$(kubectl --context="$context" get pods --all-namespaces --no-headers 2>/dev/null | grep -v "Running\|Completed" | wc -l)
    if [[ "$failed_pods" -gt 0 ]]; then
        health_status="degraded"
        issues+=("$failed_pods pods not running")
    fi
    
    # Check AI Gateway specific services
    if [[ "$cluster_name" == "ai-gateway"* ]]; then
        # Check PostgreSQL
        if ! kubectl --context="$context" get pod -l app=postgres-db 2>/dev/null | grep -q Running; then
            health_status="degraded"
            issues+=("PostgreSQL not running")
        fi
        
        # Check Redis
        if ! kubectl --context="$context" get pod -l app=redis 2>/dev/null | grep -q Running; then
            health_status="degraded"
            issues+=("Redis not running")
        fi
        
        # Check AI Gateway pods
        if ! kubectl --context="$context" get pod -l app=ai-gateway-v2 2>/dev/null | grep -q Running; then
            health_status="unhealthy"
            issues+=("AI Gateway pods not running")
        fi
    fi
    
    # Check persistent volumes
    local failed_pvs=$(kubectl --context="$context" get pv --no-headers 2>/dev/null | grep -v "Bound\|Available" | wc -l)
    if [[ "$failed_pvs" -gt 0 ]]; then
        health_status="degraded"
        issues+=("$failed_pvs persistent volumes in bad state")
    fi
    
    # Log results
    if [[ "$health_status" == "healthy" ]]; then
        log_monitor "✅ $cluster_name: Healthy"
    else
        log_alert "$cluster_name: $health_status - ${issues[*]}"
    fi
    
    return 0
}

check_ai_gateway_endpoints() {
    local cluster_name="$1"
    local context="k3d-$cluster_name"
    
    log_monitor "Checking AI Gateway endpoints for $cluster_name..."
    
    # Get LoadBalancer IPs
    local internal_ip=$(kubectl --context="$context" get svc ai-gateway-internal -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null)
    local external_ip=$(kubectl --context="$context" get svc ai-gateway-external -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null)
    
    if [[ -n "$internal_ip" ]]; then
        # Check health endpoint
        if curl -s -f "http://$internal_ip:7777/health" > /dev/null 2>&1; then
            log_monitor "  ✅ Internal health endpoint (7777) responding"
        else
            log_alert "  ❌ Internal health endpoint (7777) not responding"
        fi
    fi
    
    if [[ -n "$external_ip" ]]; then
        # Check external endpoint with API key
        if curl -s -f -H "X-API-Key: ai-gateway-api-key-2024" "http://$external_ip:8777/api/v1/providers/status" > /dev/null 2>&1; then
            log_monitor "  ✅ External API endpoint (8777) responding"
        else
            log_alert "  ❌ External API endpoint (8777) not responding"
        fi
    fi
}

monitor_all_clusters() {
    log_monitor "Starting cluster health check..."
    
    local total_clusters=0
    local healthy_clusters=0
    local issues_found=0
    
    for cluster in "${CRITICAL_CLUSTERS[@]}"; do
        total_clusters=$((total_clusters + 1))
        
        if check_cluster_exists "$cluster"; then
            check_cluster_health "$cluster"
            if [[ $? -eq 0 ]]; then
                healthy_clusters=$((healthy_clusters + 1))
                
                # Additional checks for AI Gateway clusters
                if [[ "$cluster" == "ai-gateway"* ]]; then
                    check_ai_gateway_endpoints "$cluster"
                fi
            else
                issues_found=$((issues_found + 1))
            fi
        else
            log_alert "$cluster: MISSING - Critical cluster not found!"
            issues_found=$((issues_found + 1))
        fi
    done
    
    log_monitor "Health check complete: $healthy_clusters/$total_clusters clusters healthy"
    
    if [[ "$issues_found" -gt 0 ]]; then
        log_alert "Found $issues_found cluster issues requiring attention"
        return 1
    fi
    
    return 0
}

auto_backup_critical_clusters() {
    log_monitor "Starting automatic backup of critical clusters..."
    
    for cluster in "${CRITICAL_CLUSTERS[@]}"; do
        if check_cluster_exists "$cluster"; then
            log_monitor "Creating backup for $cluster..."
            "$SCRIPT_DIR/cluster-backup.sh" backup "$cluster" || log_alert "Failed to backup $cluster"
        else
            log_alert "Cannot backup $cluster - cluster not found"
        fi
    done
    
    # Clean up old backups (keep 14 days for critical clusters)
    "$SCRIPT_DIR/cluster-backup.sh" cleanup 14
    
    log_monitor "Automatic backup completed"
}

send_notification() {
    local message="$1"
    local priority="${2:-normal}"
    
    # For now, just log the notification
    # In production, this could send to Slack, email, etc.
    log_monitor "NOTIFICATION [$priority]: $message"
    
    # Could integrate with notification services:
    # curl -X POST -H 'Content-type: application/json' \
    #   --data '{"text":"'"$message"'"}' \
    #   "$SLACK_WEBHOOK_URL"
}

generate_status_report() {
    echo "🏥 AI Gateway Cluster Status Report"
    echo "===================================="
    echo "Generated: $(date)"
    echo ""
    
    echo "📊 Critical Clusters:"
    for cluster in "${CRITICAL_CLUSTERS[@]}"; do
        if check_cluster_exists "$cluster"; then
            local status=$(k3d cluster list | grep "$cluster" | awk '{print $2}')
            local nodes=$(kubectl --context="k3d-$cluster" get nodes --no-headers 2>/dev/null | wc -l)
            local pods=$(kubectl --context="k3d-$cluster" get pods --all-namespaces --no-headers 2>/dev/null | grep "Running" | wc -l)
            echo "  ✅ $cluster: $status ($nodes nodes, $pods running pods)"
            
            # Show AI Gateway specific info
            if [[ "$cluster" == "ai-gateway"* ]]; then
                local pg_status=$(kubectl --context="k3d-$cluster" get pod -l app=postgres-db --no-headers 2>/dev/null | awk '{print $3}')
                local redis_status=$(kubectl --context="k3d-$cluster" get pod -l app=redis --no-headers 2>/dev/null | awk '{print $3}')
                local gw_pods=$(kubectl --context="k3d-$cluster" get pod -l app=ai-gateway-v2 --no-headers 2>/dev/null | wc -l)
                echo "      PostgreSQL: ${pg_status:-Not Found}, Redis: ${redis_status:-Not Found}, Gateway Pods: $gw_pods"
            fi
        else
            echo "  ❌ $cluster: MISSING"
        fi
    done
    
    echo ""
    echo "📈 Recent Alerts (last 24 hours):"
    if [[ -f "$ALERT_FILE" ]]; then
        tail -n 50 "$ALERT_FILE" | grep "$(date '+%Y-%m-%d')" || echo "  No alerts today"
    else
        echo "  No alert log found"
    fi
    
    echo ""
    echo "💾 Recent Backups:"
    "$SCRIPT_DIR/cluster-backup.sh" list | tail -n 10
}

# Command line interface
case "${1:-}" in
    "check")
        if [[ -n "$2" ]]; then
            check_cluster_health "$2"
        else
            monitor_all_clusters
        fi
        ;;
    "monitor")
        # Continuous monitoring mode
        echo "🔍 Starting continuous AI Gateway cluster monitoring..."
        while true; do
            monitor_all_clusters
            sleep 300  # Check every 5 minutes
        done
        ;;
    "backup-all")
        auto_backup_critical_clusters
        ;;
    "status")
        generate_status_report
        ;;
    "alerts")
        if [[ -f "$ALERT_FILE" ]]; then
            echo "🚨 Recent Alerts:"
            tail -n 20 "$ALERT_FILE"
        else
            echo "No alerts found"
        fi
        ;;
    *)
        echo "AI Gateway Cluster Monitoring Script"
        echo ""
        echo "Usage:"
        echo "  $0 check [cluster-name]      - Check cluster health (all if no name)"
        echo "  $0 monitor                   - Start continuous monitoring"
        echo "  $0 backup-all                - Backup all critical clusters"
        echo "  $0 status                    - Generate status report"
        echo "  $0 alerts                    - Show recent alerts"
        echo ""
        echo "Examples:"
        echo "  $0 check ai-gateway"
        echo "  $0 status"
        echo ""
        echo "Critical Clusters Monitored:"
        for cluster in "${CRITICAL_CLUSTERS[@]}"; do
            echo "  - $cluster"
        done
        echo ""
        exit 1
        ;;
esac
