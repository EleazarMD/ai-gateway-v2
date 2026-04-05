# Alerting System - Quick Start Guide

## 🚀 Getting Started

The AI Gateway Alerting System is already configured and running. This guide shows you how to use it.

## ✅ Current Status

- **Alert Rules:** 4 active rules monitoring your system
- **Notification Channels:** Email configured (eleazarf@icloud.com)
- **Check Interval:** Every 60 seconds
- **Status:** ✅ Operational

## 📧 Email Notifications

Alerts are automatically sent to: **eleazarf@icloud.com**

Email format includes:
- 🚨 Severity indicator (Critical/Warning/Info)
- Alert title and detailed message
- Timestamp and context
- Link to security dashboard

## 🔔 Active Alert Rules

### 1. Critical Anomalies Spike
- **Triggers:** >5 critical anomalies in 10 minutes
- **Severity:** Critical
- **Cooldown:** 15 minutes
- **Action:** Investigate security anomalies immediately

### 2. High Rate Limit Violations
- **Triggers:** >100 blocked requests in 5 minutes
- **Severity:** Warning
- **Cooldown:** 15 minutes
- **Action:** Check for potential DDoS or misconfigured clients

### 3. Component Health Check Failure
- **Triggers:** Any component becomes unhealthy
- **Severity:** Critical
- **Cooldown:** 10 minutes
- **Action:** Check PostgreSQL, Redis, or API health

### 4. Security Score Drop
- **Triggers:** Security score falls below 80
- **Severity:** Warning
- **Cooldown:** 30 minutes
- **Action:** Review security metrics and recent changes

## 🛠️ Common Operations

### View Recent Alerts

```bash
curl -H "X-API-Key: ai-gateway-api-key-2024" \
  http://localhost:8777/api/v1/security/alerts/history?limit=10
```

### View Alert Rules

```bash
curl -H "X-API-Key: ai-gateway-api-key-2024" \
  http://localhost:8777/api/v1/security/alerts/rules
```

### Test Email Notifications

```bash
curl -X POST -H "X-API-Key: ai-gateway-api-key-2024" \
  http://localhost:8777/api/v1/security/notifications/channels/default-email/test
```

### Acknowledge an Alert

```bash
curl -X POST -H "X-API-Key: ai-gateway-api-key-2024" \
  -H "Content-Type: application/json" \
  -d '{"acknowledgedBy": "admin"}' \
  http://localhost:8777/api/v1/security/alerts/ALERT_ID/acknowledge
```

### Filter Alerts by Severity

```bash
# Critical alerts only
curl -H "X-API-Key: ai-gateway-api-key-2024" \
  "http://localhost:8777/api/v1/security/alerts/history?severity=critical"

# Warning alerts only
curl -H "X-API-Key: ai-gateway-api-key-2024" \
  "http://localhost:8777/api/v1/security/alerts/history?severity=warning"
```

### Filter Alerts by Status

```bash
# Triggered alerts (not yet acknowledged)
curl -H "X-API-Key: ai-gateway-api-key-2024" \
  "http://localhost:8777/api/v1/security/alerts/history?status=triggered"

# Acknowledged alerts
curl -H "X-API-Key: ai-gateway-api-key-2024" \
  "http://localhost:8777/api/v1/security/alerts/history?status=acknowledged"
```

## 📊 Database Queries

### View Alert Statistics

```sql
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c "
SELECT 
  severity,
  status,
  COUNT(*) as count
FROM alert_history
GROUP BY severity, status
ORDER BY severity, status;
"
```

### View Recent Alerts

```sql
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c "
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
"
```

### View Notification Channel Stats

```sql
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c "
SELECT 
  channel_id,
  channel_type,
  enabled,
  success_count,
  failure_count,
  last_used_at
FROM notification_channels;
"
```

## ➕ Adding New Alert Rules

### Example: High Error Rate Alert

```sql
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c "
INSERT INTO alert_rules (rule_id, name, description, rule_type, severity, conditions, enabled, cooldown_minutes, notification_channels)
VALUES (
  'high-error-rate',
  'High Error Rate',
  'Triggers when error rate exceeds 10% in 5 minutes',
  'custom',
  'warning',
  '{\"metric\": \"error_rate\", \"threshold\": 0.1, \"operator\": \"greater_than\", \"window_minutes\": 5}'::jsonb,
  true,
  15,
  ARRAY['default-email']
);
"
```

### Example: Low Throughput Alert

```sql
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c "
INSERT INTO alert_rules (rule_id, name, description, rule_type, severity, conditions, enabled, cooldown_minutes, notification_channels)
VALUES (
  'low-throughput',
  'Low Throughput',
  'Triggers when requests per minute drops below 10',
  'custom',
  'info',
  '{\"metric\": \"requests_per_minute\", \"threshold\": 10, \"operator\": \"less_than\"}'::jsonb,
  true,
  30,
  ARRAY['default-email']
);
"
```

## 📱 Adding Slack Notifications

1. Create a Slack webhook URL at https://api.slack.com/messaging/webhooks

2. Add the Slack channel:

```sql
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c "
INSERT INTO notification_channels (channel_id, channel_type, name, config, enabled)
VALUES (
  'slack-alerts',
  'slack',
  'Slack Alerts',
  '{\"webhook_url\": \"https://hooks.slack.com/services/YOUR/WEBHOOK/URL\"}'::jsonb,
  true
);
"
```

3. Update alert rules to use Slack:

```sql
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c "
UPDATE alert_rules 
SET notification_channels = ARRAY['default-email', 'slack-alerts']
WHERE rule_id = 'critical-anomalies-spike';
"
```

## 🔕 Temporarily Mute an Alert

```sql
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c "
INSERT INTO alert_mutes (rule_id, reason, muted_by, unmute_at)
VALUES (
  'high-rate-limit-violations',
  'Planned load testing',
  'admin',
  NOW() + INTERVAL '2 hours'
);
"
```

## 🔧 Modify Alert Rules

### Change Alert Threshold

```sql
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c "
UPDATE alert_rules 
SET conditions = jsonb_set(conditions, '{threshold}', '200')
WHERE rule_id = 'high-rate-limit-violations';
"
```

### Change Cooldown Period

```sql
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c "
UPDATE alert_rules 
SET cooldown_minutes = 30
WHERE rule_id = 'critical-anomalies-spike';
"
```

### Disable an Alert Rule

```sql
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c "
UPDATE alert_rules 
SET enabled = false
WHERE rule_id = 'security-score-drop';
"
```

### Enable an Alert Rule

```sql
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c "
UPDATE alert_rules 
SET enabled = true
WHERE rule_id = 'security-score-drop';
"
```

## 📈 Monitoring

### Check Alert System Logs

```bash
# View alert engine activity
docker logs ai-gateway 2>&1 | grep AlertRulesEngine | tail -20

# View notification activity
docker logs ai-gateway 2>&1 | grep NotificationService | tail -20

# View email sending logs
docker logs ai-gateway 2>&1 | grep "Email sent" | tail -10
```

### Check System Health

```bash
curl -H "X-API-Key: ai-gateway-api-key-2024" \
  http://localhost:8777/api/v1/security/health
```

## 🚨 Troubleshooting

### Email Not Received?

1. Check notification channel is enabled:
```sql
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c "
SELECT * FROM notification_channels WHERE channel_id = 'default-email';
"
```

2. Check email logs:
```bash
docker logs ai-gateway 2>&1 | grep -E "Email|SMTP"
```

3. Test email manually:
```bash
curl -X POST -H "X-API-Key: ai-gateway-api-key-2024" \
  http://localhost:8777/api/v1/security/notifications/channels/default-email/test
```

### Alert Not Triggering?

1. Check rule is enabled:
```sql
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c "
SELECT rule_id, name, enabled FROM alert_rules;
"
```

2. Check cooldown hasn't expired:
```sql
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c "
SELECT 
  rule_id,
  triggered_at,
  NOW() - triggered_at as time_since_trigger
FROM alert_history
WHERE rule_id = 'YOUR_RULE_ID'
ORDER BY triggered_at DESC
LIMIT 1;
"
```

3. Check alert engine is running:
```bash
docker logs ai-gateway 2>&1 | grep "Alert rules engine initialized"
```

### Too Many Alerts?

1. Increase cooldown period:
```sql
UPDATE alert_rules SET cooldown_minutes = 60 WHERE rule_id = 'YOUR_RULE_ID';
```

2. Adjust thresholds:
```sql
UPDATE alert_rules 
SET conditions = jsonb_set(conditions, '{threshold}', '500')
WHERE rule_id = 'high-rate-limit-violations';
```

3. Temporarily mute the alert:
```sql
INSERT INTO alert_mutes (rule_id, reason, muted_by, unmute_at)
VALUES ('YOUR_RULE_ID', 'Too noisy', 'admin', NOW() + INTERVAL '24 hours');
```

## 📚 Additional Resources

- Full documentation: `docs/ALERTING_SYSTEM.md`
- Database schema: `migrations/002_alerting_system.sql`
- Notification service: `src/services/notification-service.js`
- Alert rules engine: `src/services/alert-rules-engine.js`

## 🆘 Need Help?

1. Check logs: `docker logs ai-gateway`
2. Review database state: `SELECT * FROM alert_history ORDER BY triggered_at DESC LIMIT 10`
3. Test notification channels: `POST /api/v1/security/notifications/channels/:channelId/test`
4. Consult full documentation: `docs/ALERTING_SYSTEM.md`
