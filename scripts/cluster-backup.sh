#!/bin/bash
# AI Gateway v2.0 Cluster Backup and Recovery Script
# Creates backups of AI Gateway cluster configurations and data

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/../backups"
LOG_FILE="$SCRIPT_DIR/../logs/cluster-backup.log"

# Ensure directories exist
mkdir -p "$BACKUP_DIR" "$(dirname "$LOG_FILE")"

log_backup() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

backup_cluster_config() {
    local cluster_name="$1"
    local backup_timestamp="$(date '+%Y%m%d_%H%M%S')"
    local cluster_backup_dir="$BACKUP_DIR/${cluster_name}_${backup_timestamp}"
    
    log_backup "Starting backup for cluster: $cluster_name"
    
    # Check if cluster exists
    if ! k3d cluster list | grep -q "$cluster_name"; then
        log_backup "ERROR: Cluster $cluster_name not found"
        return 1
    fi
    
    mkdir -p "$cluster_backup_dir"
    
    # Export cluster configuration
    log_backup "Exporting cluster configuration..."
    k3d cluster list --output json | jq ".[] | select(.name == \"$cluster_name\")" > "$cluster_backup_dir/cluster-config.json"
    
    # Export all Kubernetes resources
    log_backup "Exporting Kubernetes resources..."
    kubectl --context="k3d-$cluster_name" get all --all-namespaces -o yaml > "$cluster_backup_dir/all-resources.yaml"
    
    # Export AI Gateway specific resources
    log_backup "Exporting AI Gateway specific resources..."
    kubectl --context="k3d-$cluster_name" get configmaps,secrets,pvc -o yaml > "$cluster_backup_dir/ai-gateway-resources.yaml"
    
    # Export specific namespaces
    kubectl --context="k3d-$cluster_name" get namespaces -o json | jq -r '.items[].metadata.name' | while read ns; do
        if [[ "$ns" != "kube-system" && "$ns" != "kube-public" && "$ns" != "kube-node-lease" ]]; then
            log_backup "Backing up namespace: $ns"
            mkdir -p "$cluster_backup_dir/namespaces/$ns"
            kubectl --context="k3d-$cluster_name" get all,configmaps,secrets,pvc -n "$ns" -o yaml > "$cluster_backup_dir/namespaces/$ns/resources.yaml"
        fi
    done
    
    # Export persistent volume data
    log_backup "Checking for persistent volumes..."
    kubectl --context="k3d-$cluster_name" get pv -o json > "$cluster_backup_dir/persistent-volumes.json"
    
    # Backup AI Gateway configuration database if exists
    if kubectl --context="k3d-$cluster_name" get pod -l app=postgres-db 2>/dev/null | grep -q Running; then
        log_backup "Backing up AI Gateway PostgreSQL database..."
        kubectl --context="k3d-$cluster_name" exec -i deploy/postgres-db -- pg_dump -U aigateway aigateway_db > "$cluster_backup_dir/postgres-backup.sql" 2>/dev/null || true
    fi
    
    # Create backup manifest
    cat > "$cluster_backup_dir/backup-manifest.json" << EOF
{
  "cluster_name": "$cluster_name",
  "backup_timestamp": "$backup_timestamp",
  "backup_date": "$(date -Iseconds)",
  "backup_user": "$(whoami)",
  "k3d_version": "$(k3d version | head -1)",
  "kubectl_version": "$(kubectl version --client --short)",
  "backup_location": "$cluster_backup_dir",
  "ai_gateway_version": "2.0.0"
}
EOF
    
    # Compress backup
    log_backup "Compressing backup..."
    tar -czf "$BACKUP_DIR/${cluster_name}_${backup_timestamp}.tar.gz" -C "$BACKUP_DIR" "${cluster_name}_${backup_timestamp}"
    rm -rf "$cluster_backup_dir"
    
    log_backup "Backup completed: ${cluster_name}_${backup_timestamp}.tar.gz"
    echo "✅ Backup created: $BACKUP_DIR/${cluster_name}_${backup_timestamp}.tar.gz"
}

restore_cluster_config() {
    local backup_file="$1"
    
    if [[ ! -f "$backup_file" ]]; then
        echo "❌ Backup file not found: $backup_file"
        return 1
    fi
    
    log_backup "Starting restore from: $backup_file"
    
    # Extract backup
    local temp_dir=$(mktemp -d)
    tar -xzf "$backup_file" -C "$temp_dir"
    
    # Find the backup directory
    local backup_dir=$(find "$temp_dir" -maxdepth 1 -type d -name "*_*" | head -1)
    
    if [[ ! -d "$backup_dir" ]]; then
        echo "❌ Invalid backup structure"
        rm -rf "$temp_dir"
        return 1
    fi
    
    # Read backup manifest
    local cluster_name=$(jq -r '.cluster_name' "$backup_dir/backup-manifest.json")
    local backup_date=$(jq -r '.backup_date' "$backup_dir/backup-manifest.json")
    
    echo "🔄 Restoring cluster: $cluster_name (backed up: $backup_date)"
    
    # Check if cluster already exists
    if k3d cluster list | grep -q "$cluster_name"; then
        read -p "Cluster $cluster_name already exists. Delete and recreate? (yes/no): " confirm
        if [[ "$confirm" == "yes" ]]; then
            k3d cluster delete "$cluster_name"
        else
            echo "❌ Restore cancelled"
            rm -rf "$temp_dir"
            return 1
        fi
    fi
    
    # Create cluster with AI Gateway ports
    log_backup "Creating cluster: $cluster_name with AI Gateway ports"
    k3d cluster create "$cluster_name" \
        --port "7777:7777@loadbalancer" \
        --port "8777:8777@loadbalancer" \
        --port "8404:8404@loadbalancer" \
        --agents 1 --wait
    
    # Import AI Gateway image if available
    if docker images | grep -q "ai-gateway-v2"; then
        log_backup "Importing AI Gateway image..."
        k3d image import ai-gateway-v2:latest -c "$cluster_name"
    fi
    
    # Restore AI Gateway resources
    if [[ -f "$backup_dir/ai-gateway-resources.yaml" ]]; then
        log_backup "Restoring AI Gateway resources..."
        kubectl --context="k3d-$cluster_name" apply -f "$backup_dir/ai-gateway-resources.yaml" || true
    fi
    
    # Restore namespaces and resources
    if [[ -d "$backup_dir/namespaces" ]]; then
        for ns_dir in "$backup_dir/namespaces"/*; do
            if [[ -d "$ns_dir" ]]; then
                local ns_name=$(basename "$ns_dir")
                log_backup "Restoring namespace: $ns_name"
                kubectl --context="k3d-$cluster_name" apply -f "$ns_dir/resources.yaml" || true
            fi
        done
    fi
    
    # Restore PostgreSQL database if backup exists
    if [[ -f "$backup_dir/postgres-backup.sql" ]]; then
        log_backup "Waiting for PostgreSQL to be ready..."
        sleep 10
        kubectl --context="k3d-$cluster_name" exec -i deploy/postgres-db -- psql -U aigateway aigateway_db < "$backup_dir/postgres-backup.sql" 2>/dev/null || true
    fi
    
    # Clean up
    rm -rf "$temp_dir"
    
    log_backup "Restore completed for cluster: $cluster_name"
    echo "✅ Cluster restored: $cluster_name"
}

list_backups() {
    echo "📦 Available AI Gateway Backups:"
    echo "================================"
    
    if [[ ! -d "$BACKUP_DIR" ]] || [[ -z "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]]; then
        echo "No backups found in $BACKUP_DIR"
        return 0
    fi
    
    for backup in "$BACKUP_DIR"/*.tar.gz; do
        if [[ -f "$backup" ]]; then
            local filename=$(basename "$backup")
            local size=$(du -h "$backup" | cut -f1)
            local date=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$backup" 2>/dev/null || stat -c "%y" "$backup" 2>/dev/null | cut -d' ' -f1-2)
            echo "  📁 $filename ($size) - $date"
        fi
    done
}

cleanup_old_backups() {
    local days_to_keep="${1:-7}"
    
    log_backup "Cleaning up backups older than $days_to_keep days"
    
    find "$BACKUP_DIR" -name "*.tar.gz" -type f -mtime +$days_to_keep -delete
    
    log_backup "Cleanup completed"
    echo "✅ Cleaned up backups older than $days_to_keep days"
}

# Command line interface
case "${1:-}" in
    "backup")
        if [[ -n "$2" ]]; then
            backup_cluster_config "$2"
        else
            echo "Usage: $0 backup <cluster-name>"
        fi
        ;;
    "restore")
        if [[ -n "$2" ]]; then
            restore_cluster_config "$2"
        else
            echo "Usage: $0 restore <backup-file>"
        fi
        ;;
    "list")
        list_backups
        ;;
    "cleanup")
        cleanup_old_backups "$2"
        ;;
    *)
        echo "AI Gateway Cluster Backup Script"
        echo ""
        echo "Usage:"
        echo "  $0 backup <cluster-name>     - Create backup of cluster"
        echo "  $0 restore <backup-file>     - Restore cluster from backup"
        echo "  $0 list                      - List available backups"
        echo "  $0 cleanup [days]            - Clean up old backups (default: 7 days)"
        echo ""
        echo "Examples:"
        echo "  $0 backup ai-gateway"
        echo "  $0 restore $BACKUP_DIR/ai-gateway_20240101_120000.tar.gz"
        echo "  $0 cleanup 14"
        echo ""
        exit 1
        ;;
esac
