const { EventEmitter } = require('events');

/**
 * Alert and Notification Service for AI Gateway v2.1
 * Monitors metrics and triggers alerts based on configurable rules
 * Features: Threshold monitoring, budget alerts, anomaly detection, notification routing
 */
class AlertService extends EventEmitter {
  constructor(storage) {
    super();
    this.storage = storage;
    this.rules = new Map();
    this.activeAlerts = new Map();
    this.alertHistory = [];
    this.maxHistorySize = 1000;
    
    // Alert cooldown to prevent spam (5 minutes default)
    this.alertCooldown = 5 * 60 * 1000;
    this.lastAlertTime = new Map();
    
    // Initialize default alert rules
    this.initializeDefaultRules();
    
    console.log('[Alert Service] Initialized');
    
    // Check alerts periodically
    setInterval(() => this.checkAllRules(), 60000); // Every minute
  }

  /**
   * Initialize default alert rules
   */
  initializeDefaultRules() {
    // High error rate alert
    this.addRule({
      id: 'high_error_rate',
      name: 'High Error Rate',
      description: 'Triggers when error rate exceeds threshold',
      type: 'threshold',
      metric: 'error_rate',
      condition: 'greater_than',
      threshold: 0.1, // 10%
      severity: 'warning',
      enabled: true,
      checkInterval: 60000, // 1 minute
    });

    // Critical error rate alert
    this.addRule({
      id: 'critical_error_rate',
      name: 'Critical Error Rate',
      description: 'Triggers when error rate is critically high',
      type: 'threshold',
      metric: 'error_rate',
      condition: 'greater_than',
      threshold: 0.25, // 25%
      severity: 'critical',
      enabled: true,
      checkInterval: 60000,
    });

    // High latency alert
    this.addRule({
      id: 'high_latency',
      name: 'High Latency',
      description: 'Triggers when average latency exceeds threshold',
      type: 'threshold',
      metric: 'avg_latency',
      condition: 'greater_than',
      threshold: 5000, // 5 seconds
      severity: 'warning',
      enabled: true,
      checkInterval: 60000,
    });

    // Budget threshold alert
    this.addRule({
      id: 'budget_80_percent',
      name: 'Budget 80% Used',
      description: 'Triggers when 80% of budget is consumed',
      type: 'threshold',
      metric: 'budget_usage_percent',
      condition: 'greater_than',
      threshold: 80,
      severity: 'warning',
      enabled: true,
      checkInterval: 300000, // 5 minutes
    });

    // Budget exceeded alert
    this.addRule({
      id: 'budget_exceeded',
      name: 'Budget Exceeded',
      description: 'Triggers when budget is exceeded',
      type: 'threshold',
      metric: 'budget_usage_percent',
      condition: 'greater_than',
      threshold: 100,
      severity: 'critical',
      enabled: true,
      checkInterval: 300000,
    });

    // Provider offline alert
    this.addRule({
      id: 'provider_offline',
      name: 'Provider Offline',
      description: 'Triggers when a provider becomes unavailable',
      type: 'status',
      metric: 'provider_status',
      condition: 'equals',
      threshold: 'offline',
      severity: 'critical',
      enabled: true,
      checkInterval: 120000, // 2 minutes
    });

    // Low throughput alert
    this.addRule({
      id: 'low_throughput',
      name: 'Low Throughput',
      description: 'Triggers when request rate drops significantly',
      type: 'anomaly',
      metric: 'requests_per_second',
      condition: 'less_than',
      threshold: 0.1, // Less than 0.1 req/sec
      severity: 'info',
      enabled: true,
      checkInterval: 300000,
    });

    console.log(`[Alert Service] Initialized ${this.rules.size} default rules`);
  }

  /**
   * Add a new alert rule
   */
  addRule(rule) {
    this.rules.set(rule.id, {
      ...rule,
      createdAt: new Date().toISOString(),
      lastChecked: null,
      lastTriggered: null,
      triggerCount: 0,
    });
    
    console.log(`[Alert Service] Added rule: ${rule.id}`);
  }

  /**
   * Remove an alert rule
   */
  removeRule(ruleId) {
    this.rules.delete(ruleId);
    console.log(`[Alert Service] Removed rule: ${ruleId}`);
  }

  /**
   * Update an alert rule
   */
  updateRule(ruleId, updates) {
    const rule = this.rules.get(ruleId);
    if (!rule) {
      console.warn(`[Alert Service] Rule not found: ${ruleId}`);
      return;
    }
    
    this.rules.set(ruleId, { ...rule, ...updates });
    console.log(`[Alert Service] Updated rule: ${ruleId}`);
  }

  /**
   * Check all active rules
   */
  async checkAllRules() {
    for (const [ruleId, rule] of this.rules.entries()) {
      if (!rule.enabled) continue;
      
      try {
        await this.checkRule(ruleId);
      } catch (error) {
        console.error(`[Alert Service] Error checking rule ${ruleId}:`, error);
      }
    }
  }

  /**
   * Check a specific rule
   */
  async checkRule(ruleId) {
    const rule = this.rules.get(ruleId);
    if (!rule || !rule.enabled) return;
    
    // Update last checked time
    rule.lastChecked = new Date().toISOString();
    
    // Get current metric value
    const metricValue = await this.getMetricValue(rule.metric);
    
    // Evaluate condition
    const triggered = this.evaluateCondition(
      metricValue,
      rule.condition,
      rule.threshold
    );
    
    if (triggered) {
      await this.triggerAlert(ruleId, metricValue);
    } else {
      // Clear alert if it was previously active
      if (this.activeAlerts.has(ruleId)) {
        await this.clearAlert(ruleId);
      }
    }
  }

  /**
   * Trigger an alert
   */
  async triggerAlert(ruleId, metricValue) {
    const rule = this.rules.get(ruleId);
    if (!rule) return;
    
    // Check cooldown to prevent spam
    const lastTime = this.lastAlertTime.get(ruleId);
    if (lastTime && Date.now() - lastTime < this.alertCooldown) {
      return; // Still in cooldown
    }
    
    const alert = {
      id: `${ruleId}_${Date.now()}`,
      ruleId,
      ruleName: rule.name,
      description: rule.description,
      severity: rule.severity,
      metric: rule.metric,
      currentValue: metricValue,
      threshold: rule.threshold,
      timestamp: new Date().toISOString(),
      status: 'active',
    };
    
    // Store active alert
    this.activeAlerts.set(ruleId, alert);
    
    // Update rule stats
    rule.lastTriggered = alert.timestamp;
    rule.triggerCount += 1;
    
    // Update cooldown
    this.lastAlertTime.set(ruleId, Date.now());
    
    // Add to history
    this.addToHistory(alert);
    
    // Persist to storage
    try {
      await this.storage.saveAlert(alert);
    } catch (error) {
      console.error('[Alert Service] Failed to save alert:', error);
    }
    
    // Emit event for external listeners
    this.emit('alert_triggered', alert);
    
    console.log(`[Alert Service] Alert triggered: ${rule.name}`);
  }

  /**
   * Clear an alert
   */
  async clearAlert(ruleId) {
    const alert = this.activeAlerts.get(ruleId);
    if (!alert) return;
    
    alert.status = 'cleared';
    alert.clearedAt = new Date().toISOString();
    
    this.activeAlerts.delete(ruleId);
    this.addToHistory(alert);
    
    try {
      await this.storage.updateAlert(alert.id, { status: 'cleared', clearedAt: alert.clearedAt });
    } catch (error) {
      console.error('[Alert Service] Failed to update alert:', error);
    }
    
    this.emit('alert_cleared', alert);
    
    console.log(`[Alert Service] Alert cleared: ${alert.ruleName}`);
  }

  /**
   * Get current metric value
   */
  async getMetricValue(metric) {
    // This would fetch from your monitoring/metrics service
    // For now, return placeholder
    try {
      switch (metric) {
        case 'error_rate':
          // Fetch from metrics service
          return 0.05; // 5% placeholder
          
        case 'avg_latency':
          return 1500; // 1.5s placeholder
          
        case 'budget_usage_percent':
          return 75; // 75% placeholder
          
        case 'provider_status':
          return 'online'; // placeholder
          
        case 'requests_per_second':
          return 5.2; // placeholder
          
        default:
          return null;
      }
    } catch (error) {
      console.error(`[Alert Service] Error getting metric ${metric}:`, error);
      return null;
    }
  }

  /**
   * Evaluate condition
   */
  evaluateCondition(value, condition, threshold) {
    if (value === null || value === undefined) return false;
    
    switch (condition) {
      case 'greater_than':
        return value > threshold;
      case 'less_than':
        return value < threshold;
      case 'equals':
        return value === threshold;
      case 'not_equals':
        return value !== threshold;
      case 'greater_than_or_equal':
        return value >= threshold;
      case 'less_than_or_equal':
        return value <= threshold;
      default:
        return false;
    }
  }

  /**
   * Add to history
   */
  addToHistory(alert) {
    this.alertHistory.unshift(alert);
    
    // Trim history if too large
    if (this.alertHistory.length > this.maxHistorySize) {
      this.alertHistory = this.alertHistory.slice(0, this.maxHistorySize);
    }
  }

  /**
   * Get active alerts
   */
  getActiveAlerts() {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * Get alert history
   */
  getAlertHistory(limit = 50) {
    return this.alertHistory.slice(0, limit);
  }

  /**
   * Get all rules
   */
  getRules() {
    return Array.from(this.rules.values());
  }

  /**
   * Get rule by ID
   */
  getRule(ruleId) {
    return this.rules.get(ruleId);
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(alertId, acknowledgedBy) {
    const alert = Array.from(this.activeAlerts.values()).find(a => a.id === alertId);
    
    if (alert) {
      alert.acknowledgedBy = acknowledgedBy;
      alert.acknowledgedAt = new Date().toISOString();
      
      try {
        await this.storage.updateAlert(alertId, {
          acknowledgedBy,
          acknowledgedAt: alert.acknowledgedAt,
        });
      } catch (error) {
        console.error('[Alert Service] Failed to acknowledge alert:', error);
      }
      
      this.emit('alert_acknowledged', alert);
    }
  }

  /**
   * Get alert statistics
   */
  getStatistics() {
    const rules = Array.from(this.rules.values());
    
    return {
      totalRules: rules.length,
      enabledRules: rules.filter(r => r.enabled).length,
      activeAlerts: this.activeAlerts.size,
      alertsByseverity: {
        critical: this.getActiveAlerts().filter(a => a.severity === 'critical').length,
        warning: this.getActiveAlerts().filter(a => a.severity === 'warning').length,
        info: this.getActiveAlerts().filter(a => a.severity === 'info').length,
      },
      totalTriggered: rules.reduce((sum, r) => sum + r.triggerCount, 0),
    };
  }

  /**
   * Get health status
   */
  getHealthStatus() {
    return {
      status: 'healthy',
      activeAlerts: this.activeAlerts.size,
      rules: this.rules.size,
      historySize: this.alertHistory.length,
    };
  }
}

module.exports = AlertService;
