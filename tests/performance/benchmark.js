#!/usr/bin/env node

/**
 * Performance Benchmark Suite
 * Compares Node.js backend performance with Python backend
 */

const { performance } = require('perf_hooks');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  nodeBackend: process.env.NODE_BACKEND_URL || 'http://localhost:8000',
  testDuration: parseInt(process.env.TEST_DURATION) || 60000, // 1 minute
  concurrency: parseInt(process.env.CONCURRENCY) || 10,
  warmupRequests: parseInt(process.env.WARMUP_REQUESTS) || 50
};

// Test data
const TEST_DATA = {
  indicators: {
    rsi: {
      prices: Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i * 0.1) * 10),
      period: 14
    },
    ema: {
      prices: Array.from({ length: 100 }, (_, i) => 100 + Math.cos(i * 0.1) * 15),
      period: 20
    },
    macd: {
      prices: Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i * 0.2) * 8),
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9
    }
  },
  market: {
    symbols: ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN']
  }
};

class PerformanceBenchmark {
  constructor() {
    this.results = {
      node: { requests: 0, totalTime: 0, errors: 0, responses: [] },
      python: { requests: 0, totalTime: 0, errors: 0, responses: [] }
    };
  }

  async runBenchmark() {
    console.log('🚀 Starting Performance Benchmark Suite');
    console.log(`Duration: ${CONFIG.testDuration}ms, Concurrency: ${CONFIG.concurrency}`);
    console.log(`Node.js Backend: ${CONFIG.nodeBackend}`);
    console.log(`Python Backend: ${CONFIG.pythonBackend}`);
    console.log('=' .repeat(50));

    // Warmup
    await this.warmup();

    // Run benchmarks
    const benchmarks = [
      () => this.benchmarkIndicators(),
      () => this.benchmarkMarketData(),
      () => this.benchmarkWorkflowExecution()
    ];

    for (const benchmark of benchmarks) {
      await benchmark();
    }

    // Generate report
    await this.generateReport();
  }

  async warmup() {
    console.log('🔥 Warming up servers...');
    const warmupPromises = [];

    for (let i = 0; i < CONFIG.warmupRequests; i++) {
      warmupPromises.push(
        this.makeRequest(CONFIG.nodeBackend + '/health'),
        this.makeRequest(CONFIG.pythonBackend + '/health')
      );
    }

    await Promise.allSettled(warmupPromises);
    console.log('✅ Warmup completed\n');
  }

  async benchmarkIndicators() {
    console.log('📊 Benchmarking Technical Indicators...');
    
    const tests = [
      { endpoint: '/api/indicators/rsi', data: TEST_DATA.indicators.rsi },
      { endpoint: '/api/indicators/ema', data: TEST_DATA.indicators.ema },
      { endpoint: '/api/indicators/macd', data: TEST_DATA.indicators.macd }
    ];

    for (const test of tests) {
      console.log(`  Testing ${test.endpoint}...`);
      await Promise.all([
        this.runLoadTest('node', CONFIG.nodeBackend + test.endpoint, test.data),
        this.runLoadTest('python', CONFIG.pythonBackend + test.endpoint, test.data)
      ]);
    }
  }

  async benchmarkMarketData() {
    console.log('📈 Benchmarking Market Data...');
    
    const symbols = TEST_DATA.market.symbols;
    for (const symbol of symbols) {
      console.log(`  Testing market data for ${symbol}...`);
      const data = { symbol, exchange: 'NASDAQ' };
      
      await Promise.all([
        this.runLoadTest('node', CONFIG.nodeBackend + '/api/market/quote', data),
        this.runLoadTest('python', CONFIG.pythonBackend + '/api/market/quote', data)
      ]);
    }
  }

  async benchmarkWorkflowExecution() {
    console.log('⚙️ Benchmarking Workflow Execution...');
    
    const workflowData = {
      workflow_id: 'benchmark-test',
      input_data: { symbol: 'AAPL', test: true }
    };

    await Promise.all([
      this.runLoadTest('node', CONFIG.nodeBackend + '/api/workflow/test-user/execute', workflowData),
      this.runLoadTest('python', CONFIG.pythonBackend + '/api/workflow/test-user/execute', workflowData)
    ]);
  }

  async runLoadTest(backend, url, data) {
    const startTime = performance.now();
    const endTime = startTime + CONFIG.testDuration;
    const promises = [];

    while (performance.now() < endTime) {
      for (let i = 0; i < CONFIG.concurrency; i++) {
        promises.push(this.measureRequest(backend, url, data));
      }
      
      // Wait for current batch to complete before starting next
      await Promise.allSettled(promises.splice(0, CONFIG.concurrency));
    }

    // Wait for remaining requests
    await Promise.allSettled(promises);
  }

  async measureRequest(backend, url, data) {
    const startTime = performance.now();
    
    try {
      const response = await this.makeRequest(url, data);
      const endTime = performance.now();
      const responseTime = endTime - startTime;

      this.results[backend].requests++;
      this.results[backend].totalTime += responseTime;
      this.results[backend].responses.push({
        time: responseTime,
        status: response.status,
        size: JSON.stringify(response.data).length
      });

    } catch (error) {
      const endTime = performance.now();
      const responseTime = endTime - startTime;

      this.results[backend].errors++;
      this.results[backend].responses.push({
        time: responseTime,
        status: error.response?.status || 0,
        error: error.message
      });
    }
  }

  async makeRequest(url, data = null) {
    if (data) {
      return axios.post(url, data, {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      return axios.get(url, { timeout: 10000 });
    }
  }

  calculateStatistics(responses) {
    const times = responses.map(r => r.time).sort((a, b) => a - b);
    const successful = responses.filter(r => r.status >= 200 && r.status < 300);
    
    return {
      count: responses.length,
      successRate: (successful.length / responses.length * 100).toFixed(2),
      avgResponseTime: (times.reduce((a, b) => a + b, 0) / times.length).toFixed(2),
      medianResponseTime: times.length > 0 ? times[Math.floor(times.length / 2)].toFixed(2) : 0,
      p95ResponseTime: times.length > 0 ? times[Math.floor(times.length * 0.95)].toFixed(2) : 0,
      p99ResponseTime: times.length > 0 ? times[Math.floor(times.length * 0.99)].toFixed(2) : 0,
      minResponseTime: times.length > 0 ? times[0].toFixed(2) : 0,
      maxResponseTime: times.length > 0 ? times[times.length - 1].toFixed(2) : 0
    };
  }

  async generateReport() {
    console.log('\n📊 Performance Benchmark Report');
    console.log('=' .repeat(50));

    const nodeStats = this.calculateStatistics(this.results.node.responses);
    const pythonStats = this.calculateStatistics(this.results.python.responses);

    const report = {
      timestamp: new Date().toISOString(),
      configuration: CONFIG,
      results: {
        nodejs: {
          ...nodeStats,
          requestsPerSecond: (this.results.node.requests / (CONFIG.testDuration / 1000)).toFixed(2),
          errors: this.results.node.errors
        },
        python: {
          ...pythonStats,
          requestsPerSecond: (this.results.python.requests / (CONFIG.testDuration / 1000)).toFixed(2),
          errors: this.results.python.errors
        }
      },
      comparison: {
        performanceRatio: (parseFloat(pythonStats.avgResponseTime) / parseFloat(nodeStats.avgResponseTime)).toFixed(2),
        throughputRatio: (this.results.node.requests / this.results.python.requests).toFixed(2)
      }
    };

    // Console output
    console.log('\nNode.js Backend:');
    console.log(`  Requests: ${nodeStats.count} (${report.results.nodejs.requestsPerSecond} req/s)`);
    console.log(`  Success Rate: ${nodeStats.successRate}%`);
    console.log(`  Avg Response Time: ${nodeStats.avgResponseTime}ms`);
    console.log(`  P95 Response Time: ${nodeStats.p95ResponseTime}ms`);
    console.log(`  Errors: ${this.results.node.errors}`);

    console.log('\nPython Backend:');
    console.log(`  Requests: ${pythonStats.count} (${report.results.python.requestsPerSecond} req/s)`);
    console.log(`  Success Rate: ${pythonStats.successRate}%`);
    console.log(`  Avg Response Time: ${pythonStats.avgResponseTime}ms`);
    console.log(`  P95 Response Time: ${pythonStats.p95ResponseTime}ms`);
    console.log(`  Errors: ${this.results.python.errors}`);

    console.log('\nComparison:');
    console.log(`  Node.js is ${report.comparison.performanceRatio}x ${parseFloat(report.comparison.performanceRatio) > 1 ? 'slower' : 'faster'} than Python`);
    console.log(`  Node.js has ${report.comparison.throughputRatio}x ${parseFloat(report.comparison.throughputRatio) > 1 ? 'higher' : 'lower'} throughput than Python`);

    // Save detailed report
    const reportPath = path.join(__dirname, 'benchmark-results.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n💾 Detailed report saved to: ${reportPath}`);
  }
}

// Run benchmark if called directly
if (require.main === module) {
  const benchmark = new PerformanceBenchmark();
  benchmark.runBenchmark().catch(console.error);
}

module.exports = PerformanceBenchmark;