#!/bin/bash

# Docker optimization and deployment script
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🐳 Coreza Backend - Docker Optimization Script${NC}"

# =============================================================================
# Configuration
# =============================================================================
IMAGE_NAME="coreza-backend-node"
IMAGE_TAG="${IMAGE_TAG:-latest}"
FULL_IMAGE_NAME="$IMAGE_NAME:$IMAGE_TAG"
REGISTRY="${REGISTRY:-}"
ENVIRONMENT="${ENVIRONMENT:-development}"

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

# Check if Docker is running
check_docker() {
    if ! docker info >/dev/null 2>&1; then
        print_error "Docker is not running. Please start Docker first."
    fi
    print_success "Docker is running"
}

# Build optimized Docker image
build_image() {
    print_step "Building optimized Docker image"
    
    # Build multi-stage image
    docker build \
        --target production \
        --tag "$FULL_IMAGE_NAME" \
        --build-arg NODE_VERSION=18-alpine \
        --build-arg BUILDKIT_INLINE_CACHE=1 \
        -f coreza-backend-node/Dockerfile \
        .
    
    print_success "Image built: $FULL_IMAGE_NAME"
}

# Analyze image for optimization
analyze_image() {
    print_step "Analyzing Docker image"
    
    # Get image size
    IMAGE_SIZE=$(docker images "$FULL_IMAGE_NAME" --format "table {{.Size}}" | tail -n 1)
    echo "Image size: $IMAGE_SIZE"
    
    # Show layers
    echo "Image layers:"
    docker history "$FULL_IMAGE_NAME" --format "table {{.CreatedBy}}\t{{.Size}}" | head -20
    
    # Security scan (if available)
    if command -v docker scan &> /dev/null; then
        echo "Running security scan..."
        docker scan "$FULL_IMAGE_NAME" || echo "Security scan completed with warnings"
    fi
}

# Run container health checks
health_check() {
    print_step "Running health checks"
    
    # Start container in background
    CONTAINER_ID=$(docker run -d \
        --name "test-$IMAGE_NAME" \
        -p 8001:8000 \
        -e NODE_ENV=production \
        -e REDIS_HOST=localhost \
        "$FULL_IMAGE_NAME")
    
    # Wait for container to start
    echo "Waiting for container to start..."
    sleep 10
    
    # Check health endpoint
    for i in {1..30}; do
        if curl -f http://localhost:8001/health >/dev/null 2>&1; then
            print_success "Health check passed"
            break
        fi
        if [ $i -eq 30 ]; then
            print_error "Health check failed after 30 attempts"
        fi
        sleep 2
    done
    
    # Show container logs
    echo "Container logs:"
    docker logs "test-$IMAGE_NAME" | tail -20
    
    # Cleanup
    docker stop "test-$IMAGE_NAME" >/dev/null 2>&1 || true
    docker rm "test-$IMAGE_NAME" >/dev/null 2>&1 || true
}

# Performance benchmarks
performance_test() {
    print_step "Running performance tests"
    
    # Memory usage
    echo "Container resource usage:"
    docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" 2>/dev/null || echo "No running containers"
    
    # Startup time test
    echo "Testing startup time..."
    START_TIME=$(date +%s)
    
    CONTAINER_ID=$(docker run -d \
        --name "perf-test-$IMAGE_NAME" \
        -e NODE_ENV=production \
        "$FULL_IMAGE_NAME")
    
    # Wait for health check to pass
    for i in {1..60}; do
        if docker exec "$CONTAINER_ID" node healthcheck.js >/dev/null 2>&1; then
            END_TIME=$(date +%s)
            STARTUP_TIME=$((END_TIME - START_TIME))
            echo "Startup time: ${STARTUP_TIME}s"
            break
        fi
        sleep 1
    done
    
    # Cleanup
    docker stop "perf-test-$IMAGE_NAME" >/dev/null 2>&1 || true
    docker rm "perf-test-$IMAGE_NAME" >/dev/null 2>&1 || true
}

# Push to registry
push_image() {
    if [ -n "$REGISTRY" ]; then
        print_step "Pushing to registry"
        
        # Tag for registry
        REGISTRY_IMAGE="$REGISTRY/$FULL_IMAGE_NAME"
        docker tag "$FULL_IMAGE_NAME" "$REGISTRY_IMAGE"
        
        # Push
        docker push "$REGISTRY_IMAGE"
        print_success "Pushed to registry: $REGISTRY_IMAGE"
    else
        echo "No registry configured, skipping push"
    fi
}

# Cleanup old images
cleanup() {
    print_step "Cleaning up old images"
    
    # Remove dangling images
    docker image prune -f
    
    # Remove old versions (keep last 3)
    docker images "$IMAGE_NAME" --format "{{.Tag}}" | grep -v latest | sort -V | head -n -3 | xargs -r docker rmi "$IMAGE_NAME:" 2>/dev/null || true
    
    print_success "Cleanup completed"
}

# =============================================================================
# Main execution
# =============================================================================
main() {
    echo "Environment: $ENVIRONMENT"
    echo "Image: $FULL_IMAGE_NAME"
    echo "Registry: ${REGISTRY:-'None'}"
    echo ""
    
    check_docker
    
    case "${1:-all}" in
        "build")
            build_image
            ;;
        "analyze")
            analyze_image
            ;;
        "test")
            health_check
            performance_test
            ;;
        "push")
            push_image
            ;;
        "cleanup")
            cleanup
            ;;
        "all")
            build_image
            analyze_image
            health_check
            performance_test
            push_image
            cleanup
            ;;
        *)
            echo "Usage: $0 {build|analyze|test|push|cleanup|all}"
            echo ""
            echo "Commands:"
            echo "  build    - Build optimized Docker image"
            echo "  analyze  - Analyze image size and security"
            echo "  test     - Run health and performance tests"
            echo "  push     - Push image to registry"
            echo "  cleanup  - Clean up old images"
            echo "  all      - Run all commands"
            exit 1
            ;;
    esac
    
    print_success "Docker optimization completed!"
}

# Run main function with all arguments
main "$@"