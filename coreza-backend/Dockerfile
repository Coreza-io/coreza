# syntax=docker/dockerfile:1

# Build with the repository root as context (as used by Compose).
# ---- Build stage ----
FROM node:20-bullseye AS build

WORKDIR /app

# Install dependencies (including dev dependencies for TypeScript compilation)
COPY coreza-backend/package*.json ./
RUN npm ci

# Copy the rest of the source code and build the project
COPY coreza-backend/tsconfig.json ./
COPY coreza-backend/src ./src
RUN npm run build

# ---- Production image ----
FROM node:20-bullseye-slim AS production
ENV NODE_ENV=production
WORKDIR /app

# Install only production dependencies
COPY coreza-backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the compiled output from the build stage
COPY --from=build /app/dist ./dist

# tsc does not copy CSV assets consumed by the broker data reader.
COPY coreza-backend/src/data ./dist/data
# The existing loader resolves ../../../src/nodes from /app/dist/nodes.
COPY src/nodes/*.json /src/nodes/
COPY docker/healthcheck.js ./healthcheck.js

# Expose the default port
EXPOSE 8000

CMD ["node", "dist/index.js"]
