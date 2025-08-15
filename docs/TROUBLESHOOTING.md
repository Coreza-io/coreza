# Troubleshooting Guide

This guide helps you resolve common issues when setting up and running the Coreza Trading Platform.

## Setup Issues

### Setup Script Fails

**Problem**: The automated setup script encounters errors.

**Solutions**:
1. Check Node.js version: `node --version` (requires 18+)
2. Verify Supabase credentials are correct
3. Ensure you have internet connectivity
4. Run manual setup steps from [SETUP.md](SETUP.md)

```bash
# If setup fails, try manual approach
npm install -g supabase
supabase link --project-ref YOUR_PROJECT_ID
supabase db push
supabase functions deploy
```

### Environment Variables Not Loading

**Problem**: Application can't find environment variables.

**Solutions**:
1. Check `.env` files exist in correct locations:
   - `.env` (frontend root)
   - `coreza-backend/.env` (backend)
2. Verify variable names are correct (frontend needs `VITE_` prefix)
3. Restart development servers after changing `.env` files
4. Check for typos in variable names

```bash
# Verify environment files
ls -la .env
ls -la coreza-backend/.env

# Check for proper format
cat .env | grep VITE_SUPABASE_URL
```

### Database Connection Issues

**Problem**: Cannot connect to Supabase database.

**Solutions**:
1. Verify Supabase project is active
2. Check project URL format: `https://your-project.supabase.co`
3. Confirm anon and service role keys are correct
4. Test connection in Supabase dashboard

```bash
# Test Supabase CLI connection
supabase projects list
supabase link --project-ref YOUR_PROJECT_ID
```

## Development Issues

### Frontend Won't Start

**Problem**: `npm run dev` fails or frontend won't load.

**Solutions**:
1. Clear node_modules and reinstall:
```bash
rm -rf node_modules package-lock.json
npm install
```

2. Check for port conflicts (default: 3000)
3. Verify all dependencies are installed
4. Check browser console for errors

### Backend Won't Start

**Problem**: Backend server fails to start.

**Solutions**:
1. Check backend dependencies:
```bash
cd coreza-backend
rm -rf node_modules package-lock.json
npm install
```

2. Verify port availability (default: 3001)
3. Check backend environment variables
4. Review server logs for specific errors

### TypeScript Errors

**Problem**: TypeScript compilation errors.

**Solutions**:
1. Update Supabase types:
```bash
supabase gen types typescript --project-id YOUR_PROJECT_ID > src/integrations/supabase/types.ts
```

2. Clear TypeScript cache:
```bash
rm -rf .tsc-cache
rm -rf dist
```

3. Restart TypeScript language server in your IDE

## Database Issues

### RLS Policy Errors

**Problem**: "Row Level Security policy violation" errors.

**Solutions**:
1. Ensure user is authenticated
2. Check RLS policies in Supabase dashboard
3. Verify user IDs match in policies
4. Review table permissions

```sql
-- Check if RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';

-- View existing policies
SELECT * FROM pg_policies 
WHERE schemaname = 'public';
```

### Migration Failures

**Problem**: Database migrations fail to apply.

**Solutions**:
1. Check migration syntax for errors
2. Ensure proper permissions
3. Run migrations manually:
```bash
supabase db reset
supabase db push
```

4. Check Supabase logs for specific errors

### Missing Tables

**Problem**: Application reports missing database tables.

**Solutions**:
1. Run the setup script again
2. Apply database schema manually:
```bash
supabase db push --include-all
```

3. Check if migrations were applied:
```bash
supabase migration list
```

## Authentication Issues

### Login/Signup Fails

**Problem**: Users can't authenticate.

**Solutions**:
1. Check auth configuration in Supabase dashboard
2. Verify redirect URLs are set correctly
3. Ensure email confirmation is disabled for testing
4. Check browser network tab for auth errors

### Session Not Persisting

**Problem**: Users get logged out frequently.

**Solutions**:
1. Check JWT expiry settings in Supabase
2. Verify auth state management in React
3. Ensure localStorage is working
4. Check for auth token refresh issues

## Edge Functions Issues

### Functions Not Deploying

**Problem**: Supabase edge functions fail to deploy.

**Solutions**:
1. Check Supabase CLI authentication:
```bash
supabase login
supabase projects list
```

2. Verify function syntax and dependencies
3. Check function logs:
```bash
supabase functions logs function-name
```

4. Manual deployment:
```bash
supabase functions deploy function-name
```

### Function Execution Errors

**Problem**: Edge functions return errors when called.

**Solutions**:
1. Check function logs in Supabase dashboard
2. Verify environment variables/secrets are set
3. Test function locally if possible
4. Check CORS configuration

## Encryption Issues

### Credential Encryption Fails

**Problem**: Cannot encrypt/decrypt trading credentials.

**Solutions**:
1. Verify encryption key is set:
```bash
supabase secrets list
```

2. Check key format (base64, 32 bytes)
3. Ensure edge function has access to secrets
4. Test encryption/decryption manually

### Invalid Encryption Format

**Problem**: Stored credentials have wrong format.

**Solutions**:
1. Clear existing credentials and recreate
2. Check IV and auth tag lengths (12 and 16 bytes)
3. Verify base64 encoding/decoding
4. Update encryption implementation if needed

## Network Issues

### API Calls Failing

**Problem**: Frontend can't reach backend or Supabase.

**Solutions**:
1. Check network connectivity
2. Verify API URLs are correct
3. Check CORS configuration
4. Test API endpoints manually:
```bash
curl -X GET "YOUR_BACKEND_URL/health"
```

### CORS Errors

**Problem**: Cross-origin request blocked.

**Solutions**:
1. Check CORS headers in edge functions
2. Verify allowed origins in Supabase
3. Ensure proper request headers
4. Test from same origin first

## Performance Issues

### Slow Loading

**Problem**: Application loads slowly.

**Solutions**:
1. Check network tab in browser dev tools
2. Optimize bundle size
3. Implement lazy loading
4. Check database query performance
5. Use Supabase connection pooling

### Memory Issues

**Problem**: High memory usage or crashes.

**Solutions**:
1. Check for memory leaks in React components
2. Implement proper cleanup in useEffect
3. Optimize large data operations
4. Monitor browser/Node.js memory usage

## Production Issues

### Build Failures

**Problem**: Production build fails.

**Solutions**:
1. Test build locally:
```bash
npm run build
```

2. Check for environment-specific issues
3. Verify all dependencies are production-ready
4. Check TypeScript configuration

### Deployment Issues

**Problem**: Deployed application doesn't work.

**Solutions**:
1. Check environment variables on hosting platform
2. Verify Supabase configuration for production
3. Check production logs
4. Test database connectivity from production

## Getting Help

### Debugging Tools

1. **Browser DevTools**: Network, Console, Application tabs
2. **Supabase Dashboard**: Logs, API explorer, database viewer
3. **Node.js Debugging**: Use `--inspect` flag
4. **Network Testing**: curl, Postman, or similar tools

### Log Collection

Before seeking help, collect these logs:
- Browser console errors
- Network request failures
- Supabase function logs
- Backend server logs
- Database error messages

### Support Channels

1. **GitHub Issues**: For bugs and feature requests
2. **Community Forums**: For general questions
3. **Documentation**: Check all docs in `/docs` folder
4. **Supabase Support**: For platform-specific issues

### Common Commands Reference

```bash
# Setup and installation
node setup/setup.js
npm install
cd coreza-backend && npm install

# Development
npm run dev
cd coreza-backend && npm run dev

# Supabase operations
supabase login
supabase link --project-ref PROJECT_ID
supabase db push
supabase functions deploy
supabase secrets set KEY=value

# Debugging
npm run build
npm run test
supabase status
supabase logs
```

Remember: Most issues can be resolved by carefully checking configuration files, environment variables, and following the setup steps exactly as documented.