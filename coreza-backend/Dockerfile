# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:20-bullseye AS build

WORKDIR /app

# Install dependencies (including dev dependencies for TypeScript compilation)
COPY package*.json ./
RUN npm ci

# Copy the rest of the source code and build the project
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Production image ----
FROM node:20-bullseye-slim AS production
ENV NODE_ENV=production
WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the compiled output from the build stage
COPY --from=build /app/dist ./dist

# Expose the default port
EXPOSE 8000

CMD ["node", "dist/index.js"]
