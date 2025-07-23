# Coreza

Professional Trading Workflow Platform

## Project Structure

```
coreza/
├── coreza-frontend/    # React/TypeScript frontend
│   ├── src/           # Frontend source code
│   ├── public/        # Static assets
│   ├── supabase/      # Supabase configuration
│   └── ...            # Frontend config files
├── backend/           # Python backend (to be added)
└── README.md         # This file
```

## Getting Started

### Frontend Development

```bash
cd coreza-frontend
npm install
npm run dev
```

### Backend Development

Add your Python backend files to the `backend/` directory.

## Technologies

- **Frontend**: React, TypeScript, Vite, Tailwind CSS, Supabase
- **Backend**: Python (your implementation)
- **Database**: Supabase/PostgreSQL
- **Deployment**: Frontend can be deployed to Vercel/Netlify, backend separately

## Development Workflow

1. Frontend and backend can be developed independently
2. Frontend uses Supabase for database operations
3. Clear separation allows for team collaboration
4. Easy deployment and scaling