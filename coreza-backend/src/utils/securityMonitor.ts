/**
 * Security monitoring and alerting for the credential encryption system
 * Tracks encryption operations, detects anomalies, and provides audit trails
 */

interface SecurityEvent {
  timestamp: string;
  type: 'encryption' | 'decryption' | 'migration' | 'key_rotation' | 'access_denied' | 'validation_failed';
  userId: string;
  credentialId?: string;
  serviceType?: string;
  operation?: string;
  success: boolean;
  error?: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

interface SecurityMetrics {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  uniqueUsers: number;
  operationsByType: Record<string, number>;
  errorsByType: Record<string, number>;
  averageOperationsPerHour: number;
  timeRange: {
    start: string;
    end: string;
  };
}

interface SecurityAlert {
  id: string;
  timestamp: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: 'rate_limit' | 'suspicious_activity' | 'encryption_failure' | 'unauthorized_access' | 'key_issue';
  title: string;
  description: string;
  userId?: string;
  metadata: Record<string, any>;
  resolved: boolean;
}

class SecurityMonitor {
  private static events: SecurityEvent[] = [];
  private static alerts: SecurityAlert[] = [];
  private static readonly MAX_EVENTS = 10000; // Keep last 10k events in memory
  private static readonly RATE_LIMIT_THRESHOLD = 100; // Operations per minute
  private static readonly FAILURE_RATE_THRESHOLD = 0.5; // 50% failure rate threshold

  /**
   * Log a security event
   */
  static logEvent(event: Omit<SecurityEvent, 'timestamp'>): void {
    const fullEvent: SecurityEvent = {
      ...event,
      timestamp: new Date().toISOString()
    };

    this.events.push(fullEvent);

    // Keep only the most recent events
    if (this.events.length > this.MAX_EVENTS) {
      this.events = this.events.slice(-this.MAX_EVENTS);
    }

    // Log to console with structured format
    const logLevel = event.success ? 'info' : 'error';
    console.log(`[SECURITY] [${logLevel.toUpperCase()}] ${event.type}: ${event.success ? 'SUCCESS' : 'FAILED'}`, {
      userId: event.userId,
      credentialId: event.credentialId,
      serviceType: event.serviceType,
      operation: event.operation,
      error: event.error,
      timestamp: fullEvent.timestamp
    });

    // Check for anomalies
    this.checkForAnomalies(fullEvent);
  }

  /**
   * Log encryption operation
   */
  static logEncryption(
    userId: string,
    serviceType: string,
    success: boolean,
    error?: string,
    metadata?: Record<string, any>
  ): void {
    this.logEvent({
      type: 'encryption',
      userId,
      serviceType,
      operation: 'store_credential',
      success,
      error,
      metadata
    });
  }

  /**
   * Log decryption operation
   */
  static logDecryption(
    userId: string,
    credentialId: string,
    serviceType: string,
    success: boolean,
    error?: string,
    metadata?: Record<string, any>
  ): void {
    this.logEvent({
      type: 'decryption',
      userId,
      credentialId,
      serviceType,
      operation: 'get_credential',
      success,
      error,
      metadata
    });
  }

  /**
   * Log migration operation
   */
  static logMigration(
    userId: string,
    credentialId: string,
    serviceType: string,
    success: boolean,
    error?: string,
    metadata?: Record<string, any>
  ): void {
    this.logEvent({
      type: 'migration',
      userId,
      credentialId,
      serviceType,
      operation: 'migrate_to_envelope',
      success,
      error,
      metadata
    });
  }

  /**
   * Log access denied event
   */
  static logAccessDenied(
    userId: string,
    operation: string,
    reason: string,
    metadata?: Record<string, any>
  ): void {
    this.logEvent({
      type: 'access_denied',
      userId,
      operation,
      success: false,
      error: reason,
      metadata
    });
  }

  /**
   * Log validation failure
   */
  static logValidationFailure(
    userId: string,
    serviceType: string,
    errors: string[],
    metadata?: Record<string, any>
  ): void {
    this.logEvent({
      type: 'validation_failed',
      userId,
      serviceType,
      operation: 'credential_validation',
      success: false,
      error: errors.join(', '),
      metadata
    });
  }

  /**
   * Get security metrics for a time range
   */
  static getMetrics(hours: number = 24): SecurityMetrics {
    const now = new Date();
    const startTime = new Date(now.getTime() - (hours * 60 * 60 * 1000));
    
    const relevantEvents = this.events.filter(event => 
      new Date(event.timestamp) >= startTime
    );

    const totalOperations = relevantEvents.length;
    const successfulOperations = relevantEvents.filter(e => e.success).length;
    const failedOperations = totalOperations - successfulOperations;
    const uniqueUsers = new Set(relevantEvents.map(e => e.userId)).size;

    const operationsByType: Record<string, number> = {};
    const errorsByType: Record<string, number> = {};

    for (const event of relevantEvents) {
      operationsByType[event.type] = (operationsByType[event.type] || 0) + 1;
      
      if (!event.success && event.error) {
        errorsByType[event.type] = (errorsByType[event.type] || 0) + 1;
      }
    }

    const averageOperationsPerHour = totalOperations / hours;

    return {
      totalOperations,
      successfulOperations,
      failedOperations,
      uniqueUsers,
      operationsByType,
      errorsByType,
      averageOperationsPerHour,
      timeRange: {
        start: startTime.toISOString(),
        end: now.toISOString()
      }
    };
  }

  /**
   * Check for security anomalies
   */
  private static checkForAnomalies(event: SecurityEvent): void {
    // Check rate limiting per user
    this.checkRateLimit(event);
    
    // Check failure rates
    this.checkFailureRate(event);
    
    // Check for suspicious patterns
    this.checkSuspiciousActivity(event);
  }

  /**
   * Check for rate limiting violations
   */
  private static checkRateLimit(event: SecurityEvent): void {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const recentEvents = this.events.filter(e => 
      e.userId === event.userId && 
      new Date(e.timestamp) >= oneMinuteAgo
    );

    if (recentEvents.length > this.RATE_LIMIT_THRESHOLD) {
      this.createAlert({
        severity: 'high',
        type: 'rate_limit',
        title: 'Rate Limit Exceeded',
        description: `User ${event.userId} exceeded rate limit with ${recentEvents.length} operations in the last minute`,
        userId: event.userId,
        metadata: {
          operationCount: recentEvents.length,
          threshold: this.RATE_LIMIT_THRESHOLD,
          timeWindow: '1 minute'
        }
      });
    }
  }

  /**
   * Check for high failure rates
   */
  private static checkFailureRate(event: SecurityEvent): void {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentEvents = this.events.filter(e => 
      e.userId === event.userId && 
      new Date(e.timestamp) >= tenMinutesAgo
    );

    if (recentEvents.length >= 10) {
      const failureRate = recentEvents.filter(e => !e.success).length / recentEvents.length;
      
      if (failureRate > this.FAILURE_RATE_THRESHOLD) {
        this.createAlert({
          severity: 'medium',
          type: 'encryption_failure',
          title: 'High Failure Rate Detected',
          description: `User ${event.userId} has a ${Math.round(failureRate * 100)}% failure rate over the last 10 minutes`,
          userId: event.userId,
          metadata: {
            failureRate: Math.round(failureRate * 100),
            totalOperations: recentEvents.length,
            failedOperations: recentEvents.filter(e => !e.success).length
          }
        });
      }
    }
  }

  /**
   * Check for suspicious activity patterns
   */
  private static checkSuspiciousActivity(event: SecurityEvent): void {
    // Check for rapid credential access across multiple services
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentAccess = this.events.filter(e => 
      e.userId === event.userId && 
      e.type === 'decryption' &&
      new Date(e.timestamp) >= fiveMinutesAgo
    );

    const uniqueServices = new Set(recentAccess.map(e => e.serviceType)).size;
    
    if (uniqueServices >= 5) {
      this.createAlert({
        severity: 'medium',
        type: 'suspicious_activity',
        title: 'Rapid Cross-Service Access',
        description: `User ${event.userId} accessed credentials for ${uniqueServices} different services in 5 minutes`,
        userId: event.userId,
        metadata: {
          serviceCount: uniqueServices,
          accessCount: recentAccess.length,
          timeWindow: '5 minutes'
        }
      });
    }

    // Check for access to credentials immediately after creation
    if (event.type === 'decryption' && event.credentialId) {
      const creationEvent = this.events.find(e => 
        e.type === 'encryption' && 
        e.userId === event.userId &&
        e.serviceType === event.serviceType &&
        new Date(e.timestamp) >= new Date(Date.now() - 2 * 60 * 1000) // Within 2 minutes
      );

      if (creationEvent) {
        const timeDiff = new Date(event.timestamp).getTime() - new Date(creationEvent.timestamp).getTime();
        if (timeDiff < 10 * 1000) { // Less than 10 seconds
          this.createAlert({
            severity: 'low',
            type: 'suspicious_activity',
            title: 'Immediate Credential Access',
            description: `User ${event.userId} accessed credential immediately after creation`,
            userId: event.userId,
            metadata: {
              timeBetweenCreateAndAccess: `${timeDiff}ms`,
              serviceType: event.serviceType
            }
          });
        }
      }
    }
  }

  /**
   * Create a security alert
   */
  private static createAlert(alert: Omit<SecurityAlert, 'id' | 'timestamp' | 'resolved'>): void {
    const fullAlert: SecurityAlert = {
      ...alert,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      resolved: false
    };

    this.alerts.push(fullAlert);

    // Log the alert
    console.warn(`[SECURITY ALERT] [${alert.severity.toUpperCase()}] ${alert.title}`, {
      alertId: fullAlert.id,
      description: alert.description,
      userId: alert.userId,
      metadata: alert.metadata
    });

    // Keep only recent alerts (last 1000)
    if (this.alerts.length > 1000) {
      this.alerts = this.alerts.slice(-1000);
    }
  }

  /**
   * Get active alerts
   */
  static getAlerts(severity?: SecurityAlert['severity']): SecurityAlert[] {
    let alerts = this.alerts.filter(alert => !alert.resolved);
    
    if (severity) {
      alerts = alerts.filter(alert => alert.severity === severity);
    }

    return alerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  /**
   * Resolve an alert
   */
  static resolveAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      console.log(`[SECURITY] Alert ${alertId} resolved`);
      return true;
    }
    return false;
  }

  /**
   * Get security dashboard data
   */
  static getDashboard(): {
    metrics: SecurityMetrics;
    alerts: SecurityAlert[];
    recentEvents: SecurityEvent[];
    systemHealth: {
      encryptionKeyAvailable: boolean;
      migrationProgress: number;
      alertCount: number;
      criticalAlertCount: number;
    };
  } {
    const metrics = this.getMetrics(24);
    const alerts = this.getAlerts();
    const recentEvents = this.events.slice(-50).reverse(); // Last 50 events
    
    const systemHealth = {
      encryptionKeyAvailable: Boolean(process.env.COREZA_ENCRYPTION_KEY),
      migrationProgress: 0, // Would need to query database for actual progress
      alertCount: alerts.length,
      criticalAlertCount: alerts.filter(a => a.severity === 'critical').length
    };

    return {
      metrics,
      alerts,
      recentEvents,
      systemHealth
    };
  }

  /**
   * Clear old events and alerts (maintenance function)
   */
  static cleanup(): void {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    // Keep only recent events
    this.events = this.events.filter(event => 
      new Date(event.timestamp) >= oneWeekAgo
    );

    // Keep only recent alerts
    this.alerts = this.alerts.filter(alert => 
      new Date(alert.timestamp) >= oneWeekAgo
    );

    console.log(`[SECURITY] Cleanup completed. ${this.events.length} events and ${this.alerts.length} alerts retained.`);
  }

  /**
   * Export security logs for external analysis
   */
  static exportLogs(startDate?: Date, endDate?: Date): {
    events: SecurityEvent[];
    alerts: SecurityAlert[];
    exportInfo: {
      timestamp: string;
      eventCount: number;
      alertCount: number;
      timeRange: {
        start: string;
        end: string;
      };
    };
  } {
    const start = startDate || new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = endDate || new Date();

    const filteredEvents = this.events.filter(event => {
      const eventTime = new Date(event.timestamp);
      return eventTime >= start && eventTime <= end;
    });

    const filteredAlerts = this.alerts.filter(alert => {
      const alertTime = new Date(alert.timestamp);
      return alertTime >= start && alertTime <= end;
    });

    return {
      events: filteredEvents,
      alerts: filteredAlerts,
      exportInfo: {
        timestamp: new Date().toISOString(),
        eventCount: filteredEvents.length,
        alertCount: filteredAlerts.length,
        timeRange: {
          start: start.toISOString(),
          end: end.toISOString()
        }
      }
    };
  }
}

export default SecurityMonitor;
