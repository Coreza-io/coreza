# Multi-stage Docker build for Node.js backend
ARG NODE_VERSION=18-alpine

# =============================================================================
# Dependencies stage - Install dependencies
# =============================================================================
FROM node:${NODE_VERSION} AS dependencies

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY coreza-backend-node/package*.json ./coreza-backend-node/

# Install dependencies with cache optimization
RUN --mount=type=cache,target=/root/.npm \
    npm ci --only=production && \
    npm cache clean --force

# =============================================================================
# Build stage - Compile TypeScript
# =============================================================================
FROM node:${NODE_VERSION} AS builder

WORKDIR /app

# Copy package files and install all dependencies (including dev)
COPY package*.json ./
COPY coreza-backend-node/package*.json ./coreza-backend-node/
RUN --mount=type=cache,target=/root/.npm npm ci

# Copy source code
COPY coreza-backend-node/src ./coreza-backend-node/src
COPY coreza-backend-node/tsconfig.json ./coreza-backend-node/

# Build TypeScript
RUN cd coreza-backend-node && npm run build

# =============================================================================
# Production stage - Final optimized image
# =============================================================================
FROM node:${NODE_VERSION} AS production

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=8000

# Copy production dependencies
COPY --from=dependencies --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=dependencies --chown=nodejs:nodejs /app/coreza-backend-node/node_modules ./coreza-backend-node/node_modules

# Copy built application
COPY --from=builder --chown=nodejs:nodejs /app/coreza-backend-node/dist ./coreza-backend-node/dist
COPY --from=builder --chown=nodejs:nodejs /app/coreza-backend-node/package.json ./coreza-backend-node/

# Copy health check script
COPY --chown=nodejs:nodejs docker/healthcheck.js ./

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node healthcheck.js

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "coreza-backend-node/dist/index.js"]

# =============================================================================
# Development stage - For local development
# =============================================================================
FROM node:${NODE_VERSION} AS development

WORKDIR /app

# Install development dependencies
COPY package*.json ./
COPY coreza-backend-node/package*.json ./coreza-backend-node/
RUN npm ci

# Copy source code
COPY coreza-backend-node ./coreza-backend-node

# Install debugging tools
RUN npm install -g nodemon tsx

ENV NODE_ENV=development
EXPOSE 8000 9229

# Development command with hot reload
CMD ["npm", "run", "dev"]