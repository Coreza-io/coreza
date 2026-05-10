# Self-Hosting Coreza

This guide covers running Coreza on your own infrastructure for production or advanced staging.

## Prerequisites
- Node.js 18+
- Docker and Docker Compose (recommended)
- Redis (for session and workflow queues)
- PostgreSQL/Supabase access
- Domain with TLS certificates for production

## Quick Start (Docker)
1. Copy environment templates:
   ```bash
   cp .env.example .env
   cp coreza-backend/.env.example coreza-backend/.env
   cp coreza-backend/market-stream-service/.env.example coreza-backend/market-stream-service/.env
   ```
2. Update both files with your Supabase, Redis, and broker credentials.
3. Start the stack:
   ```bash
   docker-compose up --build
   ```
4. Access the frontend at `http://localhost:5173` and backend APIs at `http://localhost:3000`.

## Manual Deployment
1. Install dependencies:
   ```bash
   npm install
   cd coreza-backend && npm install && cd ..
   ```
2. Generate production keys using `node setup/setup.js` or your secret management workflow.
3. Apply database migrations via Supabase SQL or the CLI.
4. Start services:
   ```bash
   npm run build && npm run preview
   cd coreza-backend && npm run build && npm run start
   ```

## Production Hardening
- Run behind HTTPS with a reverse proxy (nginx or equivalent).
- Configure environment secrets via your cloud provider (AWS Secrets Manager, GCP Secret Manager, etc.).
- Enable Row Level Security policies in Supabase.
- Rotate encryption keys regularly and audit access logs.
- Monitor Redis, database performance, and worker queues.

## Troubleshooting
- Review application logs from frontend, backend, and docker services.
- Confirm Redis and database connectivity for workflow execution.
- Use `npm run lint` and backend diagnostics before deploying changes.


### Required backend env vars for docker-compose
Ensure `coreza-backend/.env` includes at least: `DATABASE_URL`, `OPENAI_API_KEY`, `JWT_SECRET`, and `GRAFANA_PASSWORD`.
