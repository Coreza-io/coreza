#!/usr/bin/env node

/**
 * Memory Profiler for Node.js Backend
 * Monitors memory usage, heap snapshots, and garbage collection
 */

const fs = require('fs');
const path = require('path');
const { performance, PerformanceObserver } = require('perf_hooks');

class MemoryProfiler {
  constructor(options = {}) {
    this.options = {
      interval: options.interval || 5000, // 5 seconds
      duration: options.duration || 300000, // 5 minutes
      outputDir: options.outputDir || path.join(__dirname, 'memory-reports'),
      heapSnapshotInterval: options.heapSnapshotInterval || 60000, // 1 minute
      ...options
    };

    this.metrics = [];
    this.gcMetrics = [];
    this.isRunning = false;
    this.startTime = null;

    this.setupPerformanceObserver();
    this.ensureOutputDir();
  }

  setupPerformanceObserver() {
    // Monitor garbage collection
    const gcObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'gc') {
          this.gcMetrics.push({
            timestamp: Date.now(),
            kind: entry.detail?.kind || 'unknown',
            duration: entry.duration,
            flags: entry.detail?.flags || 0
          });
        }
      }
    });

    try {
      gcObserver.observe({ entryTypes: ['gc'] });
    } catch (error) {
      console.warn('GC performance observation not available:', error.message);
    }
  }

  ensureOutputDir() {
    if (!fs.existsSync(this.options.outputDir)) {
      fs.mkdirSync(this.options.outputDir, { recursive: true });
    }
  }

  start() {
    if (this.isRunning) {
      console.warn('Memory profiler is already running');
      return;
    }

    console.log('🧠 Starting Memory Profiler...');
    console.log(`Duration: ${this.options.duration}ms, Interval: ${this.options.interval}ms`);
    console.log(`Output Directory: ${this.options.outputDir}`);

    this.isRunning = true;
    this.startTime = Date.now();

    // Start monitoring
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, this.options.interval);

    // Schedule heap snapshots
    this.heapSnapshotInterval = setInterval(() => {
      this.takeHeapSnapshot();
    }, this.options.heapSnapshotInterval);

    // Auto-stop after duration
    this.stopTimeout = setTimeout(() => {
      this.stop();
    }, this.options.duration);

    // Initial metrics collection
    this.collectMetrics();
  }

  stop() {
    if (!this.isRunning) {
      return;
    }

    console.log('⏹️ Stopping Memory Profiler...');
    this.isRunning = false;

    // Clear intervals
    if (this.monitoringInterval) clearInterval(this.monitoringInterval);
    if (this.heapSnapshotInterval) clearInterval(this.heapSnapshotInterval);
    if (this.stopTimeout) clearTimeout(this.stopTimeout);

    // Generate final report
    this.generateReport();
  }

  collectMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    const metric = {
      timestamp: Date.now(),
      uptime: process.uptime(),
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external,
        arrayBuffers: memUsage.arrayBuffers
      },
      cpu: cpuUsage,
      loadAverage: process.platform !== 'win32' ? process.loadavg() : [0, 0, 0],
      eventLoopDelay: this.measureEventLoopDelay()
    };

    this.metrics.push(metric);

    // Log current status
    if (this.metrics.length % 12 === 0) { // Every minute with 5s interval
      this.logCurrentStatus(metric);
    }
  }

  measureEventLoopDelay() {
    const start = process.hrtime.bigint();
    setImmediate(() => {
      const delay = Number(process.hrtime.bigint() - start) / 1000000; // Convert to ms
      return delay;
    });
    return 0; // Simplified for this implementation
  }

  takeHeapSnapshot() {
    try {
      const v8 = require('v8');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = path.join(this.options.outputDir, `heap-${timestamp}.heapsnapshot`);
      
      const heapSnapshot = v8.getHeapSnapshot();
      const writeStream = fs.createWriteStream(filename);
      
      heapSnapshot.pipe(writeStream);
      console.log(`📸 Heap snapshot saved: ${filename}`);
    } catch (error) {
      console.error('Failed to take heap snapshot:', error.message);
    }
  }

  logCurrentStatus(metric) {
    const heapUsedMB = (metric.memory.heapUsed / 1024 / 1024).toFixed(2);
    const heapTotalMB = (metric.memory.heapTotal / 1024 / 1024).toFixed(2);
    const rssMB = (metric.memory.rss / 1024 / 1024).toFixed(2);
    
    console.log(`📊 Memory: ${heapUsedMB}/${heapTotalMB}MB heap, ${rssMB}MB RSS | Uptime: ${metric.uptime.toFixed(0)}s`);
  }

  analyzeMemoryTrend() {
    if (this.metrics.length < 10) return null;

    const recent = this.metrics.slice(-10);
    const older = this.metrics.slice(-20, -10);

    const recentAvg = recent.reduce((sum, m) => sum + m.memory.heapUsed, 0) / recent.length;
    const olderAvg = older.length > 0 ? older.reduce((sum, m) => sum + m.memory.heapUsed, 0) / older.length : recentAvg;

    const trend = recentAvg - olderAvg;
    const trendPercentage = ((trend / olderAvg) * 100).toFixed(2);

    return {
      trend: trend > 0 ? 'increasing' : trend < 0 ? 'decreasing' : 'stable',
      change: trend,
      changePercentage: trendPercentage,
      recentAverage: recentAvg,
      olderAverage: olderAvg
    };
  }

  analyzeGCPattern() {
    if (this.gcMetrics.length === 0) return null;

    const totalGCTime = this.gcMetrics.reduce((sum, gc) => sum + gc.duration, 0);
    const avgGCTime = totalGCTime / this.gcMetrics.length;
    const gcFrequency = this.gcMetrics.length / (this.options.duration / 1000); // per second

    const gcTypes = this.gcMetrics.reduce((acc, gc) => {
      acc[gc.kind] = (acc[gc.kind] || 0) + 1;
      return acc;
    }, {});

    return {
      totalCollections: this.gcMetrics.length,
      totalTime: totalGCTime,
      averageTime: avgGCTime,
      frequency: gcFrequency,
      types: gcTypes
    };
  }

  generateReport() {
    console.log('📋 Generating Memory Profile Report...');

    const endTime = Date.now();
    const duration = endTime - this.startTime;

    // Calculate statistics
    const heapUsages = this.metrics.map(m => m.memory.heapUsed);
    const rssUsages = this.metrics.map(m => m.memory.rss);

    const stats = {
      heap: this.calculateStats(heapUsages),
      rss: this.calculateStats(rssUsages)
    };

    const report = {
      timestamp: new Date().toISOString(),
      duration: duration,
      samplesCollected: this.metrics.length,
      options: this.options,
      statistics: stats,
      memoryTrend: this.analyzeMemoryTrend(),
      garbageCollection: this.analyzeGCPattern(),
      peakMemory: {
        heap: Math.max(...heapUsages),
        rss: Math.max(...rssUsages),
        timestamp: this.metrics[heapUsages.indexOf(Math.max(...heapUsages))]?.timestamp
      },
      recommendations: this.generateRecommendations(stats)
    };

    // Save detailed report
    const reportPath = path.join(this.options.outputDir, `memory-report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    // Save raw metrics
    const metricsPath = path.join(this.options.outputDir, `memory-metrics-${Date.now()}.json`);
    fs.writeFileSync(metricsPath, JSON.stringify({
      metrics: this.metrics,
      gcMetrics: this.gcMetrics
    }, null, 2));

    this.printReport(report);
    console.log(`\n💾 Detailed report saved to: ${reportPath}`);
    console.log(`💾 Raw metrics saved to: ${metricsPath}`);
  }

  calculateStats(values) {
    const sorted = values.sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);

    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      average: sum / values.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }

  generateRecommendations(stats) {
    const recommendations = [];
    
    const heapAvgMB = stats.heap.average / 1024 / 1024;
    const heapMaxMB = stats.heap.max / 1024 / 1024;
    
    if (heapMaxMB > 512) {
      recommendations.push('High memory usage detected. Consider optimizing data structures and caching strategies.');
    }
    
    if (heapMaxMB - heapAvgMB > 200) {
      recommendations.push('Large memory spikes detected. Review memory allocation patterns and object lifecycle management.');
    }

    const trend = this.analyzeMemoryTrend();
    if (trend && trend.trend === 'increasing' && parseFloat(trend.changePercentage) > 10) {
      recommendations.push('Memory usage is trending upward. Investigate potential memory leaks.');
    }

    const gc = this.analyzeGCPattern();
    if (gc && gc.frequency > 5) {
      recommendations.push('High GC frequency detected. Consider reducing object allocation rate.');
    }

    if (recommendations.length === 0) {
      recommendations.push('Memory usage appears healthy. Continue monitoring in production.');
    }

    return recommendations;
  }

  printReport(report) {
    console.log('\n🧠 Memory Profile Report');
    console.log('=' .repeat(50));
    console.log(`Duration: ${(report.duration / 1000).toFixed(1)}s`);
    console.log(`Samples: ${report.samplesCollected}`);

    console.log('\nHeap Memory:');
    console.log(`  Average: ${(report.statistics.heap.average / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Peak: ${(report.statistics.heap.max / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  P95: ${(report.statistics.heap.p95 / 1024 / 1024).toFixed(2)} MB`);

    console.log('\nRSS Memory:');
    console.log(`  Average: ${(report.statistics.rss.average / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Peak: ${(report.statistics.rss.max / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  P95: ${(report.statistics.rss.p95 / 1024 / 1024).toFixed(2)} MB`);

    if (report.memoryTrend) {
      console.log(`\nMemory Trend: ${report.memoryTrend.trend} (${report.memoryTrend.changePercentage}%)`);
    }

    if (report.garbageCollection) {
      console.log(`\nGarbage Collection:`);
      console.log(`  Collections: ${report.garbageCollection.totalCollections}`);
      console.log(`  Frequency: ${report.garbageCollection.frequency.toFixed(2)}/s`);
      console.log(`  Avg Time: ${report.garbageCollection.averageTime.toFixed(2)}ms`);
    }

    console.log('\nRecommendations:');
    report.recommendations.forEach(rec => console.log(`  • ${rec}`));
  }
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};

  // Parse CLI arguments
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace('--', '');
    const value = args[i + 1];
    
    if (key === 'duration' || key === 'interval' || key === 'heapSnapshotInterval') {
      options[key] = parseInt(value) * 1000; // Convert seconds to milliseconds
    } else {
      options[key] = value;
    }
  }

  const profiler = new MemoryProfiler(options);
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nReceived SIGINT, stopping profiler...');
    profiler.stop();
    process.exit(0);
  });

  profiler.start();
}

module.exports = MemoryProfiler;