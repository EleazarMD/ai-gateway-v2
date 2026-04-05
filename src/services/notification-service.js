/**
 * Notification Service
 * Handles sending notifications through various channels (email, webhook, etc.)
 */

const nodemailer = require('nodemailer');

class NotificationService {
  constructor(postgresWrapper) {
    this.db = postgresWrapper;
    this.channels = new Map();
    this.logger = {
      info: (...args) => console.log('[NotificationService]', ...args),
      error: (...args) => console.error('[NotificationService]', ...args),
      warn: (...args) => console.warn('[NotificationService]', ...args)
    };
  }

  async initialize() {
    this.logger.info('Initializing notification service...');
    await this.loadChannels();
    this.logger.info('Notification service initialized');
  }

  /**
   * Load notification channels from database
   */
  async loadChannels() {
    if (!this.db || !this.db.isConnected) {
      this.logger.warn('Database not connected, skipping channel load');
      return;
    }

    try {
      const result = await this.db.query(
        'SELECT * FROM notification_channels WHERE enabled = true'
      );
      
      for (const channel of result.rows) {
        this.channels.set(channel.channel_id, channel);
      }
      
      this.logger.info(`Loaded ${this.channels.size} notification channels`);
    } catch (error) {
      this.logger.error('Failed to load notification channels:', error);
    }
  }

  /**
   * Send notification through specified channel
   */
  async sendNotification(channelId, alert) {
    const channel = this.channels.get(channelId);
    
    if (!channel) {
      this.logger.warn(`Channel not found: ${channelId}`);
      return { success: false, error: 'Channel not found' };
    }

    if (!channel.enabled) {
      this.logger.warn(`Channel disabled: ${channelId}`);
      return { success: false, error: 'Channel disabled' };
    }

    try {
      let result;
      
      switch (channel.channel_type) {
        case 'email':
          result = await this.sendEmail(channel, alert);
          break;
        case 'webhook':
          result = await this.sendWebhook(channel, alert);
          break;
        case 'slack':
          result = await this.sendSlack(channel, alert);
          break;
        case 'discord':
          result = await this.sendDiscord(channel, alert);
          break;
        default:
          result = { success: false, error: `Unsupported channel type: ${channel.channel_type}` };
      }

      // Update channel stats
      if (result.success) {
        await this.updateChannelStats(channelId, true);
      } else {
        await this.updateChannelStats(channelId, false);
      }

      return result;
    } catch (error) {
      this.logger.error(`Error sending notification via ${channelId}:`, error);
      await this.updateChannelStats(channelId, false);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send email notification
   */
  async sendEmail(channel, alert) {
    const config = channel.config;
    
    // Create transporter
    const transporter = nodemailer.createTransport({
      host: config.smtp_host || 'localhost',
      port: config.smtp_port || 25,
      secure: config.smtp_secure || false,
      auth: config.smtp_user ? {
        user: config.smtp_user,
        pass: config.smtp_password
      } : undefined,
      tls: {
        rejectUnauthorized: false
      }
    });

    const severityEmoji = {
      critical: '🚨',
      warning: '⚠️',
      info: 'ℹ️'
    };

    // Format detailed information for rate limit violations
    let detailsHtml = '';
    if (alert.triggered_by) {
      const tb = alert.triggered_by;
      
      // Top violators table
      if (tb.top_violators && tb.top_violators.length > 0) {
        detailsHtml += `
          <div style="margin: 15px 0;">
            <h3 style="margin-bottom: 10px;">Top Violators:</h3>
            <table style="width: 100%; border-collapse: collapse; background: white;">
              <thead>
                <tr style="background: #f8f9fa;">
                  <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Endpoint</th>
                  <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Actor</th>
                  <th style="padding: 8px; text-align: right; border: 1px solid #ddd;">Violations</th>
                </tr>
              </thead>
              <tbody>
                ${tb.top_violators.map(v => `
                  <tr>
                    <td style="padding: 8px; border: 1px solid #ddd;"><code>${v.endpoint}</code></td>
                    <td style="padding: 8px; border: 1px solid #ddd;"><code>${v.actor}</code></td>
                    <td style="padding: 8px; text-align: right; border: 1px solid #ddd;"><strong>${v.violations}</strong></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }
      
      // Time distribution
      if (tb.time_distribution && tb.time_distribution.length > 0) {
        detailsHtml += `
          <div style="margin: 15px 0;">
            <h3 style="margin-bottom: 10px;">Recent Activity (per minute):</h3>
            <table style="width: 100%; border-collapse: collapse; background: white;">
              <thead>
                <tr style="background: #f8f9fa;">
                  <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Time</th>
                  <th style="padding: 8px; text-align: right; border: 1px solid #ddd;">Violations</th>
                </tr>
              </thead>
              <tbody>
                ${tb.time_distribution.map(t => `
                  <tr>
                    <td style="padding: 8px; border: 1px solid #ddd;">${new Date(t.minute).toLocaleTimeString()}</td>
                    <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${t.count}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }
    }

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: ${alert.severity === 'critical' ? '#dc3545' : alert.severity === 'warning' ? '#ffc107' : '#17a2b8'}; 
                    color: white; padding: 20px; border-radius: 5px 5px 0 0; }
          .content { background: #f8f9fa; padding: 20px; border-radius: 0 0 5px 5px; }
          .alert-details { background: white; padding: 15px; margin: 10px 0; border-left: 4px solid ${alert.severity === 'critical' ? '#dc3545' : alert.severity === 'warning' ? '#ffc107' : '#17a2b8'}; }
          .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
          .badge { display: inline-block; padding: 5px 10px; border-radius: 3px; font-size: 12px; font-weight: bold; }
          .badge-critical { background: #dc3545; color: white; }
          .badge-warning { background: #ffc107; color: #333; }
          .badge-info { background: #17a2b8; color: white; }
          .metric { display: inline-block; margin: 10px 15px 10px 0; padding: 10px 15px; background: white; border-radius: 5px; border: 1px solid #ddd; }
          .metric-value { font-size: 24px; font-weight: bold; color: ${alert.severity === 'critical' ? '#dc3545' : alert.severity === 'warning' ? '#f39c12' : '#17a2b8'}; }
          .metric-label { font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>${severityEmoji[alert.severity] || ''} Security Alert: ${alert.title}</h2>
          </div>
          <div class="content">
            <div class="alert-details">
              <p><strong>Severity:</strong> <span class="badge badge-${alert.severity}">${alert.severity.toUpperCase()}</span></p>
              <p><strong>Rule:</strong> ${alert.rule_name || 'N/A'}</p>
              <p><strong>Time:</strong> ${new Date(alert.triggered_at).toLocaleString()}</p>
              
              ${alert.triggered_by && alert.triggered_by.rate_limited_count ? `
                <div style="margin: 15px 0;">
                  <div class="metric">
                    <div class="metric-value">${alert.triggered_by.rate_limited_count}</div>
                    <div class="metric-label">Total Violations</div>
                  </div>
                  <div class="metric">
                    <div class="metric-value">${alert.triggered_by.window_minutes}m</div>
                    <div class="metric-label">Time Window</div>
                  </div>
                  <div class="metric">
                    <div class="metric-value">${alert.triggered_by.threshold}</div>
                    <div class="metric-label">Threshold</div>
                  </div>
                </div>
              ` : ''}
              
              ${detailsHtml}
              
              <p><strong>Message:</strong></p>
              <p>${alert.message}</p>
            </div>
            <p><strong>Action Required:</strong> Please review this alert in the AI Gateway Security Dashboard.</p>
          </div>
          <div class="footer">
            <p>This is an automated alert from AI Gateway Security Monitoring.</p>
            <p>Dashboard: <a href="http://localhost:8404/security">http://localhost:8404/security</a></p>
          </div>
        </div>
      </body>
      </html>
    `;

    const mailOptions = {
      from: config.from || 'security@ai-homelab.local',
      to: Array.isArray(config.to) ? config.to.join(', ') : config.to,
      subject: `[${alert.severity.toUpperCase()}] ${alert.title}`,
      text: `${alert.title}\n\n${alert.message}\n\nSeverity: ${alert.severity}\nTime: ${new Date(alert.triggered_at).toLocaleString()}`,
      html: emailHtml
    };

    try {
      await transporter.sendMail(mailOptions);
      this.logger.info(`Email sent successfully to ${mailOptions.to}`);
      return { success: true, channel: 'email' };
    } catch (error) {
      this.logger.error('Failed to send email:', error);
      return { success: false, error: error.message, channel: 'email' };
    }
  }

  /**
   * Send webhook notification
   */
  async sendWebhook(channel, alert) {
    const config = channel.config;
    
    if (!config.webhook_url) {
      return { success: false, error: 'Webhook URL not configured' };
    }

    const payload = {
      alert_id: alert.alert_id,
      rule_id: alert.rule_id,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      triggered_at: alert.triggered_at,
      triggered_by: alert.triggered_by,
      metadata: alert.metadata
    };

    try {
      const response = await fetch(config.webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.headers || {})
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        this.logger.info(`Webhook sent successfully to ${config.webhook_url}`);
        return { success: true, channel: 'webhook' };
      } else {
        this.logger.error(`Webhook failed with status ${response.status}`);
        return { success: false, error: `HTTP ${response.status}`, channel: 'webhook' };
      }
    } catch (error) {
      this.logger.error('Failed to send webhook:', error);
      return { success: false, error: error.message, channel: 'webhook' };
    }
  }

  /**
   * Send Slack notification
   */
  async sendSlack(channel, alert) {
    const config = channel.config;
    
    if (!config.webhook_url) {
      return { success: false, error: 'Slack webhook URL not configured' };
    }

    const colorMap = {
      critical: '#dc3545',
      warning: '#ffc107',
      info: '#17a2b8'
    };

    const payload = {
      text: `🚨 Security Alert: ${alert.title}`,
      attachments: [{
        color: colorMap[alert.severity] || '#17a2b8',
        fields: [
          {
            title: 'Severity',
            value: alert.severity.toUpperCase(),
            short: true
          },
          {
            title: 'Time',
            value: new Date(alert.triggered_at).toLocaleString(),
            short: true
          },
          {
            title: 'Message',
            value: alert.message,
            short: false
          }
        ],
        footer: 'AI Gateway Security',
        ts: Math.floor(new Date(alert.triggered_at).getTime() / 1000)
      }]
    };

    try {
      const response = await fetch(config.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        this.logger.info('Slack notification sent successfully');
        return { success: true, channel: 'slack' };
      } else {
        return { success: false, error: `HTTP ${response.status}`, channel: 'slack' };
      }
    } catch (error) {
      this.logger.error('Failed to send Slack notification:', error);
      return { success: false, error: error.message, channel: 'slack' };
    }
  }

  /**
   * Send Discord notification
   */
  async sendDiscord(channel, alert) {
    const config = channel.config;
    
    if (!config.webhook_url) {
      return { success: false, error: 'Discord webhook URL not configured' };
    }

    const colorMap = {
      critical: 0xdc3545,
      warning: 0xffc107,
      info: 0x17a2b8
    };

    const payload = {
      embeds: [{
        title: `🚨 Security Alert: ${alert.title}`,
        description: alert.message,
        color: colorMap[alert.severity] || 0x17a2b8,
        fields: [
          {
            name: 'Severity',
            value: alert.severity.toUpperCase(),
            inline: true
          },
          {
            name: 'Time',
            value: new Date(alert.triggered_at).toLocaleString(),
            inline: true
          }
        ],
        footer: {
          text: 'AI Gateway Security'
        },
        timestamp: alert.triggered_at
      }]
    };

    try {
      const response = await fetch(config.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        this.logger.info('Discord notification sent successfully');
        return { success: true, channel: 'discord' };
      } else {
        return { success: false, error: `HTTP ${response.status}`, channel: 'discord' };
      }
    } catch (error) {
      this.logger.error('Failed to send Discord notification:', error);
      return { success: false, error: error.message, channel: 'discord' };
    }
  }

  /**
   * Update channel statistics
   */
  async updateChannelStats(channelId, success) {
    if (!this.db || !this.db.isConnected) return;

    try {
      const field = success ? 'success_count' : 'failure_count';
      await this.db.query(
        `UPDATE notification_channels 
         SET ${field} = ${field} + 1, 
             last_used_at = CURRENT_TIMESTAMP 
         WHERE channel_id = $1`,
        [channelId]
      );
    } catch (error) {
      this.logger.error('Failed to update channel stats:', error);
    }
  }

  /**
   * Test notification channel
   */
  async testChannel(channelId) {
    const testAlert = {
      alert_id: 'test-alert',
      rule_id: 'test-rule',
      severity: 'info',
      title: 'Test Notification',
      message: 'This is a test notification from AI Gateway Security.',
      triggered_at: new Date().toISOString(),
      triggered_by: { test: true },
      metadata: {}
    };

    return await this.sendNotification(channelId, testAlert);
  }

  /**
   * Get all channels
   */
  getChannels() {
    return Array.from(this.channels.values());
  }

  /**
   * Reload channels from database
   */
  async reloadChannels() {
    this.channels.clear();
    await this.loadChannels();
  }
}

module.exports = NotificationService;
