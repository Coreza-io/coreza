# Coreza Trading Platform Setup Guide

Welcome to the Coreza Trading Platform! This guide will help you set up your own instance of the platform.

## Prerequisites

Before you begin, ensure you have:

- **Node.js 18+** installed on your system
- A **Supabase account** and project
- **Git** for cloning the repository

## Quick Setup

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/coreza-trading-platform.git
cd coreza-trading-platform
```

### 2. Run the Setup Script

```bash
npm install
node setup/setup.js
```

The setup script will:
- Check prerequisites
- Collect your Supabase credentials
- Generate encryption keys
- Configure environment files
- Deploy edge functions
- Run database migrations
- Validate the setup

### 3. Install Dependencies

```bash
# Frontend dependencies
npm install

# Backend dependencies
cd coreza-backend
npm install
cd ..
```

### 4. Start the Application

```bash
# Terminal 1: Start the frontend
npm run dev

# Terminal 2: Start the backend
cd coreza-backend
npm run dev
```

## Manual Setup (Advanced)

If you prefer to set up manually or the automatic setup fails:

### 1. Supabase Project Setup

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Note your project URL, anon key, and service role key

### 2. Environment Configuration

Copy the example files and fill in your credentials:

```bash
cp .env.example .env
cp coreza-backend/.env.example coreza-backend/.env
```

Edit both `.env` files with your Supabase credentials.

### 3. Database Setup

Run the database schema setup:

```bash
# Install Supabase CLI
npm install -g supabase

# Link to your project
supabase link --project-ref YOUR_PROJECT_ID

# Run migrations
supabase db push
```

### 4. Edge Functions Deployment

```bash
# Deploy edge functions
supabase functions deploy

# Set encryption key secret
supabase secrets set COREZA_ENCRYPTION_KEY="your_generated_encryption_key"
```

### 5. Update Supabase Configuration

Update `supabase/config.toml` with your project ID:

```toml
project_id = "your_project_id_here"
```

## Verification

After setup, verify everything is working:

1. **Frontend**: Visit `http://localhost:3000`
2. **Backend**: Check `http://localhost:3001/health`
3. **Database**: Ensure all tables are created in Supabase dashboard
4. **Edge Functions**: Check functions are deployed in Supabase dashboard

## Common Issues

### Setup Script Fails

If the automatic setup fails:
1. Run the manual setup steps
2. Check your Supabase credentials
3. Ensure you have the necessary permissions
4. Check the console output for specific error messages

### Database Connection Issues

- Verify your Supabase URL and keys are correct
- Check that your Supabase project is active
- Ensure RLS policies are properly configured

### Edge Functions Not Working

- Verify functions are deployed: `supabase functions list`
- Check function logs in Supabase dashboard
- Ensure secrets are set: `supabase secrets list`

### Environment Variables

- Double-check all environment variables are set correctly
- Restart the development servers after changing environment files
- Ensure frontend variables start with `VITE_`

## Security Notes

🔐 **Important Security Considerations:**

1. **Encryption Keys**: Each deployment generates a unique encryption key
2. **Supabase Keys**: Keep your service role key secret and secure
3. **Production Deployment**: Use environment-specific configurations
4. **RLS Policies**: All tables have Row Level Security enabled

## Next Steps

Once your setup is complete:

1. Create your first user account
2. Set up trading credentials (Alpaca, etc.)
3. Create your first trading workflow
4. Explore the available nodes and indicators

## Support

For additional help:
- Check the [Troubleshooting Guide](TROUBLESHOOTING.md)
- Review the [Deployment Guide](DEPLOYMENT.md)
- Visit the [Security Documentation](SECURITY.md)

## Development

For development information:
- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + TypeScript
- Database: Supabase (PostgreSQL)
- Authentication: Supabase Auth
- Real-time: Supabase Realtime

Happy trading! 🚀