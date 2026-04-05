# AI Gateway v2.0 Cluster Protection Framework

## Overview
This document describes the cluster protection mechanisms implemented for AI Gateway v2.0 to prevent accidental deletion and ensure operational safety of critical infrastructure.

## Protection Scripts

### 1. cluster-protection.sh
**Purpose**: Prevents accidental deletion of critical AI Gateway clusters

**Protected Clusters**:
- `ai-gateway` - Main development/testing cluster
- `ai-gateway-prod` - Production cluster

**Features**:
- Interactive authorization prompts for destructive operations
- Cluster ownership verification
- Comprehensive audit logging
- Protected cluster registry

**Usage**:
```bash
# Delete a cluster (with protection checks)
./scripts/cluster-protection.sh delete <cluster-name>

# Stop a cluster (with protection checks)
./scripts/cluster-protection.sh stop <cluster-name>

# List protected clusters
./scripts/cluster-protection.sh list-protected

# Check if cluster is protected
./scripts/cluster-protection.sh check <cluster-name>
```

### 2. cluster-backup.sh
**Purpose**: Creates and manages backups of AI Gateway clusters

**Features**:
- Full cluster configuration export
- Kubernetes resources backup
- PostgreSQL database backup
- Persistent volume data preservation
- Compressed archive storage
- Automated cleanup of old backups

**Usage**:
```bash
# Create backup of a cluster
./scripts/cluster-backup.sh backup ai-gateway

# Restore cluster from backup
./scripts/cluster-backup.sh restore backups/ai-gateway_20240101_120000.tar.gz

# List available backups
./scripts/cluster-backup.sh list

# Clean up old backups (default: 7 days)
./scripts/cluster-backup.sh cleanup 14
```

### 3. cluster-monitor.sh
**Purpose**: Monitors AI Gateway clusters and alerts on issues

**Features**:
- Health checks for critical clusters
- AI Gateway specific service monitoring (PostgreSQL, Redis, Gateway pods)
- Endpoint availability testing
- Automated backup scheduling
- Alert logging and notifications
- Status report generation

**Usage**:
```bash
# Check health of all critical clusters
./scripts/cluster-monitor.sh check

# Check specific cluster
./scripts/cluster-monitor.sh check ai-gateway

# Start continuous monitoring (5-minute intervals)
./scripts/cluster-monitor.sh monitor

# Generate status report
./scripts/cluster-monitor.sh status

# View recent alerts
./scripts/cluster-monitor.sh alerts

# Backup all critical clusters
./scripts/cluster-monitor.sh backup-all
```

## Integration with Team Workflows

### Daily Operations
1. **Before any cluster deletion**: Use `cluster-protection.sh delete` instead of direct `k3d cluster delete`
2. **Regular health checks**: Run `cluster-monitor.sh status` at start of day
3. **Backup before major changes**: Use `cluster-backup.sh backup` before deployments

### CI/CD Integration
Add to your deployment scripts:
```bash
# Pre-deployment backup
./scripts/cluster-backup.sh backup ai-gateway-prod

# Post-deployment health check
./scripts/cluster-monitor.sh check ai-gateway-prod
```

### Automated Monitoring
Set up a cron job for continuous monitoring:
```bash
# Add to crontab
*/5 * * * * /path/to/ai-gateway-v2/scripts/cluster-monitor.sh check >> /var/log/ai-gateway-monitor.log 2>&1

# Daily backup of production
0 2 * * * /path/to/ai-gateway-v2/scripts/cluster-backup.sh backup ai-gateway-prod
```

## Best Practices

### 1. Cluster Naming Conventions
- Production: `ai-gateway-prod`
- Development/Testing: `ai-gateway`
- Feature branches: `ai-gateway-feature-<name>` (not protected by default)

### 2. Backup Strategy
- **Production**: Daily automated backups, 30-day retention
- **Development**: On-demand backups before major changes, 7-day retention

### 3. Monitoring Alerts
- Set up notification webhooks in `cluster-monitor.sh` for critical alerts
- Review alert logs daily: `./scripts/cluster-monitor.sh alerts`
- Investigate any "degraded" or "unhealthy" status immediately

### 4. Access Control
- Restrict script execution to authorized team members
- Use sudo or group permissions for production operations
- Maintain audit logs for compliance

## Troubleshooting

### Cluster Won't Delete
If protection script prevents deletion but you need to force it:
1. Verify you have authorization
2. Check cluster ownership
3. Use override with explicit confirmation:
   ```bash
   # This will prompt multiple times for confirmation
   ./scripts/cluster-protection.sh delete ai-gateway-prod
   ```

### Backup Restoration Fails
1. Check backup file integrity:
   ```bash
   tar -tzf backups/cluster_backup.tar.gz
   ```
2. Ensure cluster doesn't already exist
3. Verify sufficient resources for restoration

### Monitoring False Positives
1. Check network connectivity to cluster
2. Verify kubectl context is correctly configured
3. Review pod startup times (may need to adjust monitoring thresholds)

## Emergency Procedures

### Cluster Deletion Recovery
1. Check for recent backups:
   ```bash
   ./scripts/cluster-backup.sh list
   ```
2. Restore from most recent backup:
   ```bash
   ./scripts/cluster-backup.sh restore backups/latest_backup.tar.gz
   ```
3. Verify services are running:
   ```bash
   ./scripts/cluster-monitor.sh check ai-gateway
   ```

### Critical Service Failure
1. Generate status report:
   ```bash
   ./scripts/cluster-monitor.sh status
   ```
2. Check specific service logs:
   ```bash
   kubectl logs -l app=ai-gateway-v2 --tail=100
   kubectl logs -l app=postgres-db --tail=100
   ```
3. Restart failed services if needed:
   ```bash
   kubectl rollout restart deployment/ai-gateway-v2
   ```

## Maintenance

### Log Rotation
Logs are stored in:
- Protection logs: `logs/cluster-operations.log`
- Backup logs: `logs/cluster-backup.log`
- Monitor logs: `logs/cluster-monitor.log`
- Alert logs: `logs/cluster-alerts.log`

Set up logrotate for automatic rotation:
```bash
# /etc/logrotate.d/ai-gateway
/path/to/ai-gateway-v2/logs/*.log {
    daily
    rotate 30
    compress
    missingok
    notifempty
}
```

### Script Updates
When updating protection scripts:
1. Test in development environment first
2. Update protected cluster lists as needed
3. Document changes in this guide
4. Notify team of any behavioral changes

## Security Considerations

1. **Script Permissions**: Keep scripts executable only by authorized users
2. **Backup Encryption**: Consider encrypting backup files for sensitive data
3. **Audit Logs**: Regularly review operation logs for unauthorized attempts
4. **API Keys**: Never store API keys in scripts; use environment variables
5. **Network Security**: Ensure cluster access is properly restricted

## Support and Escalation

### Primary Contacts
- AI Gateway Team Lead
- DevOps Team
- Security Team (for access issues)

### Escalation Path
1. Check documentation and troubleshooting guide
2. Review recent alerts and logs
3. Contact team lead with status report
4. Escalate to DevOps for infrastructure issues
5. Engage security team for access/authorization problems

## Version History
- v1.0.0 (2024-01-13): Initial implementation adapted from AHIS server
- Features: Protection, backup, and monitoring scripts
- Protected clusters: ai-gateway, ai-gateway-prod

---

**Version**: 2.0.0  
**Guide Version**: 1.0.0  
**Last Updated**: 2025-09-25  
**Status**: Production Ready
