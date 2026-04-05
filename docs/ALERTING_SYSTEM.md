# AI Gateway Alerting System

## Overview

The AI Gateway Alerting System provides real-time monitoring and notifications for security events, anomalies, rate limit violations, and system health issues. The system automatically evaluates alert rules every 60 seconds and sends notifications via multiple channels.

## Architecture

### Components

1. **NotificationService** (`src/services/notification-service.js`)
   - Manages notification channels (email, webhook, Slack, Discord)
   - Sends formatted notifications
   - Tracks notification statistics

2. **AlertRulesEngine** (`src/services/alert-rules-engine.js`)
   - Loads and evaluates alert rules from database
   - Checks conditions every 60 seconds
   - Triggers alerts and sends notifications
   - Manages alert lifecycle and cooldowns

3. **Database Schema** (`migrations/002_alerting_system.sql`)
   - `alert_rules` - Alert rule definitions
   - `alert_history` - Triggered alert records
   - `alert_mutes` - Temporary alert suppression
   - `notification_channels` - Notification destinations

## Database Schema

### alert_rules

Stores alert rule definitions with conditions and severity levels.

```sql
CREATE TABLE alert_rules (
    rule_id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    rule_type VARCHAR(50) NOT NULL, -- 'anomaly_threshold', 'rate_limit', 'health_check', 'custom'
    severity VARCHAR(20) NOT NULL,  -- 'critical', 'warning', 'info'
    conditions JSONB NOT NULL,
    enabled BOOLEAN DEFAULT true,
    cooldown_minutes INTEGER DEFAULT 15,
    notification_channels TEXT[], -- Array of channel IDs
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### alert_history

Records all triggered alerts with full context.

```sql
CREATE TABLE alert_history (
    alert_id VARCHAR(100) PRIMARY KEY,
    rule_id VARCHAR(100) REFERENCES alert_rules(rule_id),
    severity VARCHAR(20) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    context JSONB,
    status VARCHAR(50) DEFAULT 'triggered', -- 'triggered', 'acknowledged', 'resolved'
    triggered_at TIMESTAMP DEFAULT NOW(),
    acknowledged_at TIMESTAMP,
    acknowledged_by VARCHAR(100),
    resolved_at TIMESTAMP
);
```

### notification_channels

Defines notification destinations and their configurations.

```sql
CREATE TABLE notification_channels (
    channel_id VARCHAR(100) PRIMARY KEY,
    channel_type VARCHAR(50) NOT NULL, -- 'email', 'webhook', 'slack', 'discord'
    name VARCHAR(255) NOT NULL,
    config JSONB NOT NULL,
    enabled BOOLEAN DEFAULT true,
    last_used_at TIMESTAMP,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### alert_mutes

Temporarily suppress specific alerts.

```sql
CREATE TABLE alert_mutes (
    mute_id SERIAL PRIMARY KEY,
    rule_id VARCHAR(100) REFERENCES alert_rules(rule_id),
    reason TEXT,
    muted_by VARCHAR(100),
    muted_at TIMESTAMP DEFAULT NOW(),
    unmute_at TIMESTAMP NOT NULL
);
```

## Alert Rule Types

### 1. Anomaly Threshold

Triggers when anomaly count exceeds threshold within a time window.

```json
{
  "rule_type": "anomaly_threshold",
  "conditions": {
    "severity": "critical",
    "threshold": 5,
    "window_minutes": 10,
    "operator": "greater_than"
  }
}
```

### 2. Rate Limit Violations

Monitors rate-limited requests from audit log.

```json
{
  "rule_type": "rate_limit",
  "conditions": {
    "threshold": 100,
    "window_minutes": 5,
    "operator": "greater_than"
  }
}
```

### 3. Health Check Failures

Alerts on component health check failures.

```json
{
  "rule_type": "health_check",
  "conditions": {
    "component": "postgres",
    "status": "unhealthy"
  }
}
```

### 4. Custom Metrics

Evaluates custom security metrics.

```json
{
  "rule_type": "custom",
  "conditions": {
    "metric": "security_score",
    "threshold": 80,
    "operator": "less_than"
  }
}
```

## Notification Channels

### Email (SMTP)

Send HTML-formatted email notifications.

**Configuration:**
```json
{
  "smtp_host": "smtp.mail.me.com",
  "smtp_port": 587,
  "smtp_secure": false,
  "smtp_user": "your-email@example.com",
  "smtp_password": "your-app-password",
  "from": "AI Homelab Security <your-email@example.com>",
  "to": ["admin@example.com"]
}
```

**Example:**
```sql
INSERT INTO notification_channels (channel_id, channel_type, name, config, enabled)
VALUES (
  'default-email',
  'email',
  'Default Email Notifications',
  '{
    "smtp_host": "smtp.mail.me.com",
    "smtp_port": 587,
    "smtp_secure": false,
    "smtp_user": "eleazarf@icloud.com",
    "smtp_password": "your-password",
    "from": "AI Homelab Security <eleazarf@icloud.com>",
    "to": ["eleazarf@icloud.com"]
  }'::jsonb,
  true
);
```

### Webhook

Send JSON payloads to HTTP endpoints.

**Configuration:**
```json
{
  "webhook_url": "https://your-webhook-endpoint.com/alerts",
  "method": "POST",
  "headers": {
    "Authorization": "Bearer your-token"
  }
}
```

### Slack

Send formatted messages to Slack channels.

**Configuration:**
```json
{
  "webhook_url": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
}
```

### Discord

Send embedded messages to Discord channels.

**Configuration:**
```json
{
  "webhook_url": "https://discord.com/api/webhooks/YOUR/WEBHOOK/URL"
}
```

## API Endpoints

### Get Alert Rules

```bash
GET /api/v1/security/alerts/rules
Authorization: X-API-Key: your-api-key
```

**Response:**
```json
{
  "success": true,
  "rules": [
    {
      "rule_id": "critical-anomalies-spike",
      "name": "Critical Anomalies Spike",
      "severity": "critical",
      "enabled": true,
      "cooldown_minutes": 15
    }
  ]
}
```

### Get Alert History

```bash
GET /api/v1/security/alerts/history?limit=50&severity=critical&status=triggered
Authorization: X-API-Key: your-api-key
```

**Response:**
```json
{
  "success": true,
  "alerts": [
    {
      "alert_id": "alert-critical-anomalies-spike-1234567890",
      "rule_id": "critical-anomalies-spike",
      "severity": "critical",
      "title": "Critical Anomalies Spike",
      "message": "Detected 8 critical anomalies in the last 10 minutes",
      "status": "triggered",
      "triggered_at": "2026-02-20T11:16:51.539Z"
    }
  ],
  "count": 1
}
```

### Acknowledge Alert

```bash
POST /api/v1/security/alerts/:id/acknowledge
Authorization: X-API-Key: your-api-key
Content-Type: application/json

{
  "acknowledgedBy": "admin"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Alert acknowledged"
}
```

### Get Notification Channels

```bash
GET /api/v1/security/notifications/channels
Authorization: X-API-Key: your-api-key
```

**Response:**
```json
{
  "success": true,
  "channels": [
    {
      "channel_id": "default-email",
      "channel_type": "email",
      "name": "Default Email Notifications",
      "enabled": true,
      "success_count": 15,
      "failure_count": 0
    }
  ]
}
```

### Test Notification Channel

```bash
POST /api/v1/security/notifications/channels/:channelId/test
Authorization: X-API-Key: your-api-key
```

**Response:**
```json
{
  "success": true,
  "message": "Test notification sent successfully"
}
```

## Configuration

### Environment Variables

The alerting system uses the following environment variables:

- `POSTGRES_HOST` - PostgreSQL host (default: localhost)
- `POSTGRES_PORT` - PostgreSQL port (default: 5434)
- `POSTGRES_DB` - Database name (default: aigateway_db)
- `POSTGRES_USER` - Database user
- `POSTGRES_PASSWORD` - Database password

### Alert Rule Configuration

Alert rules are stored in the database and can be managed via SQL or API endpoints.

**Add a new alert rule:**
```sql
INSERT INTO alert_rules (rule_id, name, description, rule_type, severity, conditions, enabled, cooldown_minutes, notification_channels)
VALUES (
  'custom-alert-rule',
  'Custom Alert Rule',
  'Monitors custom metric',
  'custom',
  'warning',
  '{"metric": "custom_metric", "threshold": 100, "operator": "greater_than"}'::jsonb,
  true,
  15,
  ARRAY['default-email']
);
```

**Disable an alert rule:**
```sql
UPDATE alert_rules SET enabled = false WHERE rule_id = 'custom-alert-rule';
```

**Update cooldown period:**
```sql
UPDATE alert_rules SET cooldown_minutes = 30 WHERE rule_id = 'custom-alert-rule';
```

## Alert Lifecycle

1. **Rule Evaluation** - AlertRulesEngine checks all enabled rules every 60 seconds
2. **Condition Check** - Evaluates rule conditions against current metrics
3. **Cooldown Check** - Verifies alert hasn't triggered recently (within cooldown period)
4. **Alert Trigger** - Creates alert record in `alert_history`
5. **Notification** - Sends notifications via configured channels
6. **Acknowledgment** - Admin acknowledges alert via API
7. **Resolution** - Alert marked as resolved when condition clears

## Cooldown Mechanism

Alerts have a configurable cooldown period (default: 15 minutes) to prevent notification spam. Once an alert triggers, it won't trigger again until the cooldown period expires, even if conditions remain true.

**Cooldown is tracked per rule:**
- Last trigger time stored in memory
- Cooldown period defined in `alert_rules.cooldown_minutes`
- Cooldown resets when condition clears

## Pre-configured Alert Rules

The system includes 4 pre-configured alert rules:

1. **Critical Anomalies Spike**
   - Triggers when >5 critical anomalies detected in 10 minutes
   - Severity: Critical
   - Cooldown: 15 minutes

2. **High Rate Limit Violations**
   - Triggers when >100 rate limit violations in 5 minutes
   - Severity: Warning
   - Cooldown: 15 minutes

3. **Component Health Check Failure**
   - Triggers when any component becomes unhealthy
   - Severity: Critical
   - Cooldown: 10 minutes

4. **Security Score Drop**
   - Triggers when security score drops below 80
   - Severity: Warning
   - Cooldown: 30 minutes

## Monitoring and Troubleshooting

### Check Alert System Status

```bash
# View recent alerts
curl -H "X-API-Key: your-api-key" \
  http://localhost:8777/api/v1/security/alerts/history?limit=10

# View active rules
curl -H "X-API-Key: your-api-key" \
  http://localhost:8777/api/v1/security/alerts/rules

# Test email notifications
curl -X POST -H "X-API-Key: your-api-key" \
  http://localhost:8777/api/v1/security/notifications/channels/default-email/test
```

### Check Database

```sql
-- View alert statistics
SELECT 
  severity,
  status,
  COUNT(*) as count
FROM alert_history
GROUP BY severity, status;

-- View recent alerts
SELECT 
  alert_id,
  rule_id,
  severity,
  title,
  status,
  triggered_at
FROM alert_history
ORDER BY triggered_at DESC
LIMIT 10;

-- View notification channel statistics
SELECT 
  channel_id,
  channel_type,
  enabled,
  success_count,
  failure_count,
  last_used_at
FROM notification_channels;
```

### View Logs

```bash
# View alert engine logs
docker logs ai-gateway 2>&1 | grep -E "Alert|Notification"

# View email sending logs
docker logs ai-gateway 2>&1 | grep "Email sent"
```

### Common Issues

**Email notifications not working:**
1. Verify SMTP configuration in `notification_channels` table
2. Check SMTP credentials are correct
3. Verify SMTP port is accessible (587 for TLS, 465 for SSL)
4. Check Docker logs for email errors

**Alerts not triggering:**
1. Verify alert rules are enabled: `SELECT * FROM alert_rules WHERE enabled = true`
2. Check AlertRulesEngine is running: `docker logs ai-gateway | grep AlertRulesEngine`
3. Verify conditions are being met
4. Check cooldown hasn't expired

**Database connection issues:**
1. Verify PostgreSQL is running: `docker ps | grep postgres`
2. Check connection settings in environment variables
3. Verify database exists: `docker exec ai-gateway-postgres psql -U aigateway -l`

## Best Practices

1. **Set appropriate cooldown periods** - Balance between notification frequency and alert fatigue
2. **Use severity levels wisely** - Reserve 'critical' for truly urgent issues
3. **Test notification channels** - Regularly test email/webhook endpoints
4. **Monitor notification statistics** - Check success/failure counts
5. **Acknowledge alerts promptly** - Keep alert history clean
6. **Review alert rules periodically** - Adjust thresholds based on actual usage
7. **Use multiple notification channels** - Email + Slack/Discord for redundancy
8. **Set up alert mutes** - Temporarily suppress alerts during maintenance

## Security Considerations

1. **Protect SMTP credentials** - Store in environment variables, not in code
2. **Use API key authentication** - All alert endpoints require valid API key
3. **Limit notification recipients** - Only send to authorized personnel
4. **Sanitize alert messages** - Prevent injection attacks in notifications
5. **Audit alert access** - Track who acknowledges/mutes alerts
6. **Encrypt sensitive data** - Use HTTPS for webhooks, TLS for SMTP

## Future Enhancements

- [ ] Alert rule templates
- [ ] Alert aggregation (group similar alerts)
- [ ] Alert escalation (notify different channels based on severity)
- [ ] Alert analytics dashboard
- [ ] Machine learning-based anomaly detection
- [ ] Custom alert rule builder UI
- [ ] SMS notifications
- [ ] PagerDuty integration
- [ ] Alert correlation and root cause analysis
- [ ] Alert forecasting and prediction

## Support

For issues or questions about the alerting system:
1. Check the troubleshooting section above
2. Review Docker logs: `docker logs ai-gateway`
3. Check database state: `SELECT * FROM alert_history ORDER BY triggered_at DESC LIMIT 10`
4. Test notification channels: `POST /api/v1/security/notifications/channels/:channelId/test`
