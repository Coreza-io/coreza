#!/usr/bin/env node

/**
 * Stress Test Suite for Node.js Backend
 * Tests system under extreme load conditions
 */

const axios = require('axios');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  baseUrl: process.env.BACKEND_URL || 'http://localhost:8000',
  maxConcurrency: parseInt(process.env.MAX_CONCURRENCY) || 100,
  rampUpDuration: parseInt(process.env.RAMP_UP_DURATION) || 60000, // 1 minute
  plateauDuration: parseInt(process.env.PLATEAU_DURATION) || 120000, // 2 minutes
  rampDownDuration: parseInt(process.env.RAMP_DOWN_DURATION) || 30000, // 30 seconds
  requestsPerWorker: parseInt(process.env.REQUESTS_PER_WORKER) || 1000,
  outputDir: process.env.OUTPUT_DIR || path.join(__dirname, 'stress-results')
};

// Test scenarios
const SCENARIOS = {
  indicatorStorm: {
    name: 'Technical Indicator Storm',
    endpoint: '/api/indicators/rsi',
    method: 'POST',
    data: () => ({
      prices: Array.from({ length: 200 }, () => Math.random() * 100 + 50),
      period: Math.floor(Math.random() * 20) + 5
    })
  },
  
  marketDataFlood: {
    name: 'Market Data Flood',
    endpoint: '/api/market/quote',
    method: 'POST',
    data: () => {
      const symbols = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN', 'META', 'NVDA'];
      return {
        symbol: symbols[Math.floor(Math.random() * symbols.length)],
        exchange: 'NASDAQ'
      };
    }
  },

  workflowBarrage: {
    name: 'Workflow Execution Barrage',
    endpoint: '/api/workflow/stress-test-user/execute',
    method: 'POST',
    data: () => ({
      workflow_id: 'stress-test-workflow',
      input_data: {
        symbol: 'STRESS',
        test: true,
        complexity: Math.floor(Math.random() * 10) + 1
      }
    })
  },

  mixedLoad: {
    name: 'Mixed Load Pattern',
    endpoint: null, // Will be randomly selected
    method: null,
    data: () => {
      const scenarios = [SCENARIOS.indicatorStorm, SCENARIOS.marketDataFlood, SCENARIOS.workflowBarrage];
      const scenario = scenarios[Math.floor(Math.random() * scenarios.length)];
      return {
        endpoint: scenario.endpoint,
        method: scenario.method,
        data: scenario.data()
      };
    }
  }
};

class StressTestWorker {
  constructor(workerId, scenario, duration) {
    this.workerId = workerId;
    this.scenario = scenario;
    this.duration = duration;
    this.results = {
      requests: 0,
      successes: 0,
      failures: 0,
      totalResponseTime: 0,
      errors: {},
      responseTimes: []
    };
  }

  async run() {
    const startTime = Date.now();
    const endTime = startTime + this.duration;

    console.log(`Worker ${this.workerId} starting stress test: ${this.scenario.name}`);

    while (Date.now() < endTime) {
      await this.makeRequest();
      
      // Small delay to prevent overwhelming the event loop
      if (this.results.requests % 10 === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }

    return this.results;
  }

  async makeRequest() {
    const requestStart = Date.now();
    
    try {
      let url, method, data;
      
      if (this.scenario.name === 'Mixed Load Pattern') {
        const mixed = this.scenario.data();
        url = CONFIG.baseUrl + mixed.endpoint;
        method = mixed.method;
        data = mixed.data;
      } else {
        url = CONFIG.baseUrl + this.scenario.endpoint;
        method = this.scenario.method;
        data = this.scenario.data();
      }

      const response = await axios({
        method,
        url,
        data,
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' }
      });

      const responseTime = Date.now() - requestStart;
      
      this.results.requests++;
      this.results.successes++;
      this.results.totalResponseTime += responseTime;
      this.results.responseTimes.push(responseTime);

      // Keep only recent response times to manage memory
      if (this.results.responseTimes.length > 1000) {
        this.results.responseTimes = this.results.responseTimes.slice(-500);
      }

    } catch (error) {
      const responseTime = Date.now() - requestStart;
      
      this.results.requests++;
      this.results.failures++;
      this.results.totalResponseTime += responseTime;
      
      const errorType = error.code || error.response?.status || 'unknown';
      this.results.errors[errorType] = (this.results.errors[errorType] || 0) + 1;
    }
  }
}

class StressTestCoordinator {
  constructor() {
    this.results = [];
    this.startTime = null;
    this.ensureOutputDir();
  }

  ensureOutputDir() {
    if (!fs.existsSync(CONFIG.outputDir)) {
      fs.mkdirSync(CONFIG.outputDir, { recursive: true });
    }
  }

  async runStressTest() {
    console.log('🔥 Starting Stress Test Suite');
    console.log(`Target: ${CONFIG.baseUrl}`);
    console.log(`Max Concurrency: ${CONFIG.maxConcurrency}`);
    console.log(`Test Duration: ${(CONFIG.rampUpDuration + CONFIG.plateauDuration + CONFIG.rampDownDuration) / 1000}s`);
    console.log('=' .repeat(60));

    this.startTime = Date.now();

    // Test each scenario
    for (const [key, scenario] of Object.entries(SCENARIOS)) {
      console.log(`\n🎯 Testing: ${scenario.name}`);
      await this.runScenario(key, scenario);
    }

    // Generate comprehensive report
    await this.generateReport();
  }

  async runScenario(scenarioKey, scenario) {
    const phases = [
      { name: 'Ramp Up', duration: CONFIG.rampUpDuration, maxWorkers: CONFIG.maxConcurrency },
      { name: 'Plateau', duration: CONFIG.plateauDuration, maxWorkers: CONFIG.maxConcurrency },
      { name: 'Ramp Down', duration: CONFIG.rampDownDuration, maxWorkers: Math.floor(CONFIG.maxConcurrency / 4) }
    ];

    const scenarioResults = {
      scenario: scenario.name,
      phases: [],
      totalResults: {
        requests: 0,
        successes: 0,
        failures: 0,
        totalResponseTime: 0,
        errors: {},
        duration: 0
      }
    };

    for (const phase of phases) {
      console.log(`  Phase: ${phase.name} (${phase.duration}ms, ${phase.maxWorkers} workers)`);
      
      const phaseStart = Date.now();
      const workers = [];
      
      // Create workers
      for (let i = 0; i < phase.maxWorkers; i++) {
        if (isMainThread) {
          workers.push(this.createWorker(i, scenario, phase.duration));
        }
      }

      // Wait for all workers to complete
      const phaseResults = await Promise.all(workers);
      const phaseDuration = Date.now() - phaseStart;
      
      // Aggregate phase results
      const aggregated = this.aggregateResults(phaseResults);
      aggregated.duration = phaseDuration;
      aggregated.phase = phase.name;
      aggregated.workers = phase.maxWorkers;

      scenarioResults.phases.push(aggregated);
      
      // Add to total
      scenarioResults.totalResults.requests += aggregated.requests;
      scenarioResults.totalResults.successes += aggregated.successes;
      scenarioResults.totalResults.failures += aggregated.failures;
      scenarioResults.totalResults.totalResponseTime += aggregated.totalResponseTime;
      scenarioResults.totalResults.duration += aggregated.duration;
      
      // Merge errors
      Object.entries(aggregated.errors).forEach(([error, count]) => {
        scenarioResults.totalResults.errors[error] = (scenarioResults.totalResults.errors[error] || 0) + count;
      });

      console.log(`    Completed: ${aggregated.requests} requests, ${aggregated.successes} successes, ${aggregated.failures} failures`);
      console.log(`    Avg Response Time: ${(aggregated.avgResponseTime || 0).toFixed(2)}ms`);
      console.log(`    Requests/sec: ${(aggregated.requestsPerSecond || 0).toFixed(2)}`);
    }

    this.results.push(scenarioResults);
  }

  async createWorker(workerId, scenario, duration) {
    return new Promise((resolve) => {
      if (isMainThread) {
        // In main thread, simulate worker
        const worker = new StressTestWorker(workerId, scenario, duration);
        worker.run().then(resolve);
      } else {
        // This would be worker thread code
        const worker = new StressTestWorker(workerId, scenario, duration);
        worker.run().then(result => {
          parentPort.postMessage(result);
          resolve(result);
        });
      }
    });
  }

  aggregateResults(workerResults) {
    const aggregated = {
      requests: 0,
      successes: 0,
      failures: 0,
      totalResponseTime: 0,
      errors: {},
      responseTimes: []
    };

    workerResults.forEach(result => {
      aggregated.requests += result.requests;
      aggregated.successes += result.successes;
      aggregated.failures += result.failures;
      aggregated.totalResponseTime += result.totalResponseTime;
      aggregated.responseTimes.push(...result.responseTimes);

      Object.entries(result.errors).forEach(([error, count]) => {
        aggregated.errors[error] = (aggregated.errors[error] || 0) + count;
      });
    });

    // Calculate derived metrics
    aggregated.successRate = aggregated.requests > 0 ? (aggregated.successes / aggregated.requests * 100) : 0;
    aggregated.avgResponseTime = aggregated.requests > 0 ? (aggregated.totalResponseTime / aggregated.requests) : 0;
    aggregated.requestsPerSecond = aggregated.duration > 0 ? (aggregated.requests / (aggregated.duration / 1000)) : 0;

    // Calculate percentiles
    if (aggregated.responseTimes.length > 0) {
      const sorted = aggregated.responseTimes.sort((a, b) => a - b);
      aggregated.p50 = sorted[Math.floor(sorted.length * 0.5)];
      aggregated.p95 = sorted[Math.floor(sorted.length * 0.95)];
      aggregated.p99 = sorted[Math.floor(sorted.length * 0.99)];
      aggregated.min = sorted[0];
      aggregated.max = sorted[sorted.length - 1];
    }

    return aggregated;
  }

  async generateReport() {
    const totalDuration = Date.now() - this.startTime;
    
    console.log('\n🔥 Stress Test Report');
    console.log('=' .repeat(60));

    const report = {
      timestamp: new Date().toISOString(),
      configuration: CONFIG,
      totalDuration,
      scenarios: this.results,
      summary: this.generateSummary()
    };

    // Print summary
    this.printSummary(report.summary);

    // Save detailed report
    const reportPath = path.join(CONFIG.outputDir, `stress-test-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    console.log(`\n💾 Detailed report saved to: ${reportPath}`);
  }

  generateSummary() {
    const summary = {
      totalRequests: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      overallSuccessRate: 0,
      avgResponseTime: 0,
      maxRequestsPerSecond: 0,
      scenarios: {}
    };

    this.results.forEach(scenario => {
      const total = scenario.totalResults;
      summary.totalRequests += total.requests;
      summary.totalSuccesses += total.successes;
      summary.totalFailures += total.failures;

      const scenarioAvgResponseTime = total.requests > 0 ? (total.totalResponseTime / total.requests) : 0;
      const scenarioRps = total.duration > 0 ? (total.requests / (total.duration / 1000)) : 0;

      summary.scenarios[scenario.scenario] = {
        requests: total.requests,
        successRate: total.requests > 0 ? (total.successes / total.requests * 100) : 0,
        avgResponseTime: scenarioAvgResponseTime,
        requestsPerSecond: scenarioRps
      };

      summary.maxRequestsPerSecond = Math.max(summary.maxRequestsPerSecond, scenarioRps);
    });

    summary.overallSuccessRate = summary.totalRequests > 0 ? (summary.totalSuccesses / summary.totalRequests * 100) : 0;

    return summary;
  }

  printSummary(summary) {
    console.log(`Total Requests: ${summary.totalRequests}`);
    console.log(`Overall Success Rate: ${summary.overallSuccessRate.toFixed(2)}%`);
    console.log(`Max Requests/sec: ${summary.maxRequestsPerSecond.toFixed(2)}`);
    
    console.log('\nBy Scenario:');
    Object.entries(summary.scenarios).forEach(([name, stats]) => {
      console.log(`  ${name}:`);
      console.log(`    Requests: ${stats.requests}`);
      console.log(`    Success Rate: ${stats.successRate.toFixed(2)}%`);
      console.log(`    Avg Response Time: ${stats.avgResponseTime.toFixed(2)}ms`);
      console.log(`    Requests/sec: ${stats.requestsPerSecond.toFixed(2)}`);
    });
  }
}

// Run stress test if called directly
if (require.main === module) {
  const coordinator = new StressTestCoordinator();
  coordinator.runStressTest().catch(console.error);
}

module.exports = { StressTestCoordinator, StressTestWorker };
