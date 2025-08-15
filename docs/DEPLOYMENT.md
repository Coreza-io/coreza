# Deployment Guide

This guide covers deploying the Coreza Trading Platform to various hosting providers.

## Production Checklist

Before deploying to production:

- [ ] All environment variables are set
- [ ] Database migrations are applied
- [ ] Edge functions are deployed
- [ ] Encryption keys are properly configured
- [ ] RLS policies are enabled
- [ ] SSL certificates are configured
- [ ] Monitoring is set up

## Deployment Options

### Option 1: Render (Recommended)

Render provides easy deployment for both frontend and backend.

#### Frontend Deployment

1. Connect your GitHub repository to Render
2. Create a new Static Site
3. Configure build settings:
   - **Build Command**: `npm run build`
   - **Publish Directory**: `dist`
4. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_COREZA_ENCRYPTION_KEY`

#### Backend Deployment

1. Create a new Web Service on Render
2. Configure settings:
   - **Runtime**: Node
   - **Build Command**: `cd coreza-backend && npm install && npm run build`
   - **Start Command**: `cd coreza-backend && npm start`
3. Add environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `COREZA_ENCRYPTION_KEY`
   - `PORT=10000`
   - `NODE_ENV=production`

### Option 2: Vercel (Frontend) + Railway (Backend)

#### Frontend on Vercel

1. Connect repository to Vercel
2. Configure build settings:
   - **Framework Preset**: Vite
   - **Root Directory**: `/`
3. Add environment variables in Vercel dashboard

#### Backend on Railway

1. Connect repository to Railway
2. Configure settings:
   - **Root Directory**: `coreza-backend`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
3. Add environment variables

### Option 3: Docker Deployment

Use the provided Docker configuration:

```bash
# Build and run with Docker Compose
docker-compose up -d

# Or build manually
docker build -t coreza-backend ./coreza-backend
docker run -p 3001:3001 --env-file coreza-backend/.env coreza-backend
```

## Environment Configuration

### Production Environment Variables

#### Frontend (.env.production)
```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_production_anon_key
VITE_COREZA_ENCRYPTION_KEY=your_production_encryption_key
```

#### Backend (.env.production)
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_production_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_production_service_key
COREZA_ENCRYPTION_KEY=your_production_encryption_key
NODE_ENV=production
PORT=3001
```

## Database Configuration

### Production Database Setup

1. **Create Production Supabase Project**
   ```bash
   # Create new project for production
   supabase projects create coreza-prod
   ```

2. **Deploy Schema**
   ```bash
   # Link to production project
   supabase link --project-ref your-prod-project-id
   
   # Deploy schema
   supabase db push
   ```

3. **Configure RLS Policies**
   - All RLS policies are included in the schema
   - Verify policies are active in Supabase dashboard

### Edge Functions Deployment

```bash
# Deploy to production
supabase functions deploy --project-ref your-prod-project-id

# Set production secrets
supabase secrets set COREZA_ENCRYPTION_KEY="your_prod_encryption_key" --project-ref your-prod-project-id
```

## Security Hardening

### Production Security Checklist

- [ ] **HTTPS Only**: Ensure all traffic uses HTTPS
- [ ] **Secure Headers**: Configure security headers
- [ ] **Rate Limiting**: Implement API rate limiting
- [ ] **CORS Configuration**: Restrict CORS to your domains
- [ ] **Input Validation**: Validate all user inputs
- [ ] **Audit Logging**: Enable comprehensive logging
- [ ] **Backup Strategy**: Implement database backups
- [ ] **Monitoring**: Set up error tracking and monitoring

### Supabase Security Settings

1. **Auth Settings**:
   - Disable email confirmations for faster testing (optional)
   - Configure allowed redirect URLs
   - Set appropriate JWT expiry times

2. **RLS Policies**:
   - Review all Row Level Security policies
   - Ensure no data leakage between users
   - Test with different user roles

3. **API Limits**:
   - Configure appropriate rate limits
   - Monitor API usage
   - Set up alerts for unusual activity

## Monitoring and Logging

### Application Monitoring

```bash
# Add monitoring dependencies
npm install --save @sentry/node @sentry/react
```

Configure error tracking:

```javascript
// In your React app
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: "YOUR_SENTRY_DSN",
  environment: process.env.NODE_ENV,
});
```

### Database Monitoring

- Monitor Supabase logs in dashboard
- Set up alerts for failed queries
- Track API usage and performance

### Performance Monitoring

- Monitor response times
- Track error rates
- Set up uptime monitoring

## Backup and Recovery

### Database Backups

Supabase provides automatic backups, but consider:

1. **Regular Database Dumps**:
   ```bash
   # Export database
   supabase db dump --file backup.sql
   ```

2. **Backup Strategy**:
   - Daily automated backups
   - Weekly full system backups
   - Test restore procedures regularly

### Application Backups

- Code is backed up in Git repository
- Environment configurations should be documented
- Keep copies of encryption keys secure

## Scaling Considerations

### Horizontal Scaling

- Frontend: Use CDN for static assets
- Backend: Deploy multiple instances behind load balancer
- Database: Utilize Supabase read replicas

### Performance Optimization

- Implement caching strategies
- Optimize database queries
- Use connection pooling
- Minimize bundle sizes

## Troubleshooting Production Issues

### Common Issues

1. **Environment Variables**:
   - Verify all variables are set correctly
   - Check variable names match exactly
   - Ensure no trailing spaces

2. **Database Connections**:
   - Test connectivity from deployment environment
   - Verify Supabase project is active
   - Check connection limits

3. **Edge Functions**:
   - Verify functions are deployed
   - Check function logs for errors
   - Ensure secrets are configured

### Debugging Tools

- Supabase dashboard logs
- Application error tracking
- Network monitoring tools
- Performance profiling

## Support

For deployment issues:
- Check logs in your hosting provider's dashboard
- Review Supabase project logs
- Consult hosting provider documentation
- Join community forums for help

Remember to test your deployment thoroughly before going live with real trading data!