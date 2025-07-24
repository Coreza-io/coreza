#!/bin/bash

# Comprehensive Performance Testing Suite
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Coreza Performance Testing Suite${NC}"

# =============================================================================
# Configuration
# =============================================================================
NODE_BACKEND_URL="${NODE_BACKEND_URL:-http://localhost:8000}"
TEST_DURATION="${TEST_DURATION:-300}" # 5 minutes
MEMORY_PROFILE_DURATION="${MEMORY_PROFILE_DURATION:-300}" # 5 minutes
RESULTS_DIR="${RESULTS_DIR:-./performance-results}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_DIR="$RESULTS_DIR/$TIMESTAMP"

# =============================================================================
# Functions
# =============================================================================
print_step() {
    echo -e "\n${YELLOW}==== $1 ====${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
    exit 1
}

print_info() {
    echo -e "${BLUE}ℹ️ $1${NC}"
}

# Create results directory
setup_directories() {
    mkdir -p "$REPORT_DIR"
    mkdir -p "$REPORT_DIR/benchmarks"
    mkdir -p "$REPORT_DIR/memory"
    mkdir -p "$REPORT_DIR/stress"
    mkdir -p "$REPORT_DIR/artillery"
    print_success "Created results directory: $REPORT_DIR"
}

# Check if backend is running
check_backend() {
    print_step "Checking Backend Availability"
    
    # Check Node.js backend
    if curl -f "$NODE_BACKEND_URL/health" >/dev/null 2>&1; then
        print_success "Node.js backend is running at $NODE_BACKEND_URL"
    else
        print_error "Node.js backend is not responding at $NODE_BACKEND_URL"
    fi
}

# Run comprehensive benchmark
run_benchmark() {
    print_step "Running Performance Benchmark"
    
    cd coreza-backend
    
    NODE_BACKEND_URL="$NODE_BACKEND_URL" \
    TEST_DURATION=$((TEST_DURATION * 1000)) \
    node tests/performance/benchmark.js > "$REPORT_DIR/benchmarks/benchmark-output.log" 2>&1
    
    # Move results
    if [ -f "tests/performance/benchmark-results.json" ]; then
        mv tests/performance/benchmark-results.json "$REPORT_DIR/benchmarks/"
        print_success "Benchmark completed - results saved"
    else
        print_error "Benchmark failed - no results file found"
    fi
    
    cd ..
}

# Run memory profiling
run_memory_profiling() {
    print_step "Running Memory Profiling"
    
    cd coreza-backend
    
    # Start memory profiler in background
    node tests/performance/memory-profiler.js \
        --duration $MEMORY_PROFILE_DURATION \
        --interval 5 \
        --outputDir "$REPORT_DIR/memory" \
        > "$REPORT_DIR/memory/memory-profiler.log" 2>&1 &
    
    MEMORY_PID=$!
    print_info "Memory profiler started (PID: $MEMORY_PID)"
    
    # Wait for profiling to complete
    wait $MEMORY_PID
    print_success "Memory profiling completed"
    
    cd ..
}

# Run stress testing
run_stress_test() {
    print_step "Running Stress Testing"
    
    cd coreza-backend
    
    BACKEND_URL="$NODE_BACKEND_URL" \
    MAX_CONCURRENCY=50 \
    RAMP_UP_DURATION=30000 \
    PLATEAU_DURATION=60000 \
    RAMP_DOWN_DURATION=15000 \
    OUTPUT_DIR="$REPORT_DIR/stress" \
    node tests/performance/stress-test.js > "$REPORT_DIR/stress/stress-test.log" 2>&1
    
    print_success "Stress testing completed"
    
    cd ..
}

# Run Artillery load testing
run_artillery_tests() {
    print_step "Running Artillery Load Tests"
    
    cd coreza-backend
    
    # Update artillery config for current test
    sed -i.bak "s|http://localhost:8000|$NODE_BACKEND_URL|g" tests/load/artillery-config.ts
    
    # Run artillery tests
    npm run test:load > "$REPORT_DIR/artillery/artillery-output.log" 2>&1 || true
    
    # Restore original config
    mv tests/load/artillery-config.ts.bak tests/load/artillery-config.ts
    
    print_success "Artillery load tests completed"
    
    cd ..
}

# Generate comparison report
generate_comparison_report() {
    print_step "Generating Performance Comparison Report"
    
    cat > "$REPORT_DIR/performance-summary.md" << EOF
# Coreza Backend Performance Report
Generated: $(date)

## Test Configuration
- Node.js Backend: $NODE_BACKEND_URL
- Test Duration: ${TEST_DURATION}s
- Memory Profile Duration: ${MEMORY_PROFILE_DURATION}s
- Results Directory: $REPORT_DIR

## Test Results Summary

### Benchmark Results
$([ -f "$REPORT_DIR/benchmarks/benchmark-results.json" ] && echo "✅ Benchmark completed successfully" || echo "❌ Benchmark failed")

### Memory Profiling
$([ -d "$REPORT_DIR/memory" ] && echo "✅ Memory profiling completed" || echo "❌ Memory profiling failed")

### Stress Testing
$([ -d "$REPORT_DIR/stress" ] && echo "✅ Stress testing completed" || echo "❌ Stress testing failed")

### Artillery Load Testing
$([ -f "$REPORT_DIR/artillery/artillery-output.log" ] && echo "✅ Artillery tests completed" || echo "❌ Artillery tests failed")

## Key Metrics
$(if [ -f "$REPORT_DIR/benchmarks/benchmark-results.json" ]; then
    echo "### Node.js Performance"
    node -e "
    const data = require('$REPORT_DIR/benchmarks/benchmark-results.json');
    console.log('- Requests/sec:', data.results.nodejs.requestsPerSecond);
    console.log('- Avg Response Time:', data.results.nodejs.avgResponseTime + 'ms');
    console.log('- Success Rate:', data.results.nodejs.successRate + '%');
    if (data.results.python) {
        console.log('\\n### Performance Comparison');
        console.log('- Node.js vs Python Performance Ratio:', data.comparison.performanceRatio);
        console.log('- Node.js vs Python Throughput Ratio:', data.comparison.throughputRatio);
    }
    " 2>/dev/null || echo "Could not parse benchmark results"
fi)

## Recommendations
$(if [ -f "$REPORT_DIR/memory/memory-report-"*".json" ]; then
    echo "### Memory Optimization"
    node -e "
    const fs = require('fs');
    const files = fs.readdirSync('$REPORT_DIR/memory').filter(f => f.startsWith('memory-report-'));
    if (files.length > 0) {
        const data = require('$REPORT_DIR/memory/' + files[0]);
        data.recommendations.forEach(rec => console.log('- ' + rec));
    }
    " 2>/dev/null || echo "Could not parse memory recommendations"
fi)

## Files Generated
- Benchmark Results: \`benchmarks/benchmark-results.json\`
- Memory Reports: \`memory/\`
- Stress Test Results: \`stress/\`
- Artillery Results: \`artillery/\`

EOF

    print_success "Performance summary report generated: $REPORT_DIR/performance-summary.md"
}

# Display final results
display_results() {
    print_step "Performance Test Results Summary"
    
    echo -e "${BLUE}📊 Results Location: $REPORT_DIR${NC}"
    echo ""
    
    if [ -f "$REPORT_DIR/performance-summary.md" ]; then
        cat "$REPORT_DIR/performance-summary.md"
    fi
    
    echo ""
    print_info "View detailed results in: $REPORT_DIR"
    print_info "Import Grafana dashboard: monitoring/grafana/dashboards/nodejs-performance.json"
}

# Cleanup function
cleanup() {
    if [ ! -z "$MEMORY_PID" ] && kill -0 $MEMORY_PID 2>/dev/null; then
        kill $MEMORY_PID
        print_info "Stopped memory profiler"
    fi
}

# =============================================================================
# Main execution
# =============================================================================
main() {
    echo "Starting comprehensive performance testing..."
    echo "Node.js Backend: $NODE_BACKEND_URL"
    echo "Python Backend: $PYTHON_BACKEND_URL"
    echo "Test Duration: ${TEST_DURATION}s"
    echo ""
    
    # Setup
    check_backend
    
    # Set cleanup trap
    trap cleanup EXIT
    
    # Run tests based on arguments
    case "${1:-all}" in
        "benchmark")
            run_benchmark
            ;;
        "memory")
            run_memory_profiling
            ;;
        "stress")
            run_stress_test
            ;;
        "artillery")
            run_artillery_tests
            ;;
        "all")
            run_benchmark
            run_memory_profiling
            run_stress_test
            run_artillery_tests
            generate_comparison_report
            ;;
        *)
            echo "Usage: $0 {benchmark|memory|stress|artillery|all}"
            echo ""
            echo "Commands:"
            echo "  benchmark - Run performance benchmarks"
            echo "  memory    - Run memory profiling"
            echo "  stress    - Run stress testing"
            echo "  artillery - Run Artillery load tests"
            echo "  all       - Run all tests (default)"
            exit 1
            ;;
    esac
    
    display_results
    print_success "Performance testing completed!"
}

# Run main function with all arguments
main "$@"