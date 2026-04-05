#!/bin/bash
# AI Gateway v2.0 Cluster Protection Script
# Prevents accidental deletion of critical AI Gateway infrastructure

set -e

# Protected clusters list - critical AI Gateway infrastructure
# Only protect AI Gateway specific clusters in this repository
PROTECTED_CLUSTERS=("ai-gateway" "ai-gateway-prod")
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/../logs/cluster-operations.log"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

log_operation() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"
}

check_cluster_protection() {
    local cluster_name="$1"
    local operation="$2"
    
    for protected in "${PROTECTED_CLUSTERS[@]}"; do
        if [[ "$cluster_name" == "$protected" ]]; then
            echo "⚠️  WARNING: '$cluster_name' is a PROTECTED AI Gateway infrastructure cluster"
            echo "   Operation: $operation"
            echo "   This cluster provides critical AI Gateway services"
            echo ""
            read -p "Are you authorized to $operation this cluster? (yes/no): " confirmation
            
            if [[ "$confirmation" != "yes" ]]; then
                echo "❌ Operation cancelled for safety"
                log_operation "BLOCKED: Unauthorized $operation attempt on $cluster_name"
                exit 1
            fi
            
            echo "✅ Authorized operation confirmed"
            log_operation "AUTHORIZED: $operation on $cluster_name by $(whoami)"
            return 0
        fi
    done
    
    log_operation "ALLOWED: $operation on $cluster_name (not protected)"
    return 0
}

verify_cluster_ownership() {
    local cluster_name="$1"
    local current_user="$(whoami)"
    
    # Extract team prefix from cluster name
    local team_prefix="${cluster_name%%-*}"
    
    echo "🔍 Cluster: $cluster_name"
    echo "   Team prefix: $team_prefix"
    echo "   Current user: $current_user"
    echo ""
    
    # Check if cluster follows naming convention
    if [[ ! "$cluster_name" =~ ^[a-z]+-[a-z-]+-[a-z]+$ ]] && [[ ! "$cluster_name" =~ ^[a-z]+-[a-z]+$ ]]; then
        echo "⚠️  WARNING: Cluster name doesn't follow standard convention"
        echo "   Expected formats: {team}-{service}-{env} or {service}-{env}"
        echo "   Example: ai-gateway-prod, ai-gateway-dev"
        echo ""
    fi
}

# Main protection function
protect_cluster_operation() {
    local operation="$1"
    local cluster_name="$2"
    
    if [[ -z "$cluster_name" ]]; then
        echo "❌ Error: No cluster name provided"
        echo "Usage: $0 $operation <cluster-name>"
        exit 1
    fi
    
    echo "🛡️  AI Gateway Cluster Protection"
    echo "================================"
    
    verify_cluster_ownership "$cluster_name"
    check_cluster_protection "$cluster_name" "$operation"
    
    echo ""
    echo "✅ Protection check passed. You may proceed with: k3d cluster $operation $cluster_name"
}

# Command line interface
case "${1:-}" in
    "delete")
        protect_cluster_operation "delete" "$2"
        ;;
    "stop")
        protect_cluster_operation "stop" "$2"
        ;;
    "list-protected")
        echo "🛡️  Protected AI Gateway Clusters:"
        for cluster in "${PROTECTED_CLUSTERS[@]}"; do
            echo "   - $cluster"
        done
        ;;
    "check")
        if [[ -n "$2" ]]; then
            verify_cluster_ownership "$2"
        else
            echo "Usage: $0 check <cluster-name>"
        fi
        ;;
    *)
        echo "AI Gateway Cluster Protection Script"
        echo ""
        echo "Usage:"
        echo "  $0 delete <cluster-name>     - Check before deleting cluster"
        echo "  $0 stop <cluster-name>       - Check before stopping cluster"
        echo "  $0 check <cluster-name>      - Verify cluster ownership"
        echo "  $0 list-protected            - List protected clusters"
        echo ""
        echo "Examples:"
        echo "  $0 delete ai-gateway-temp"
        echo "  $0 delete ai-gateway         # Will require authorization"
        echo ""
        exit 1
        ;;
esac
