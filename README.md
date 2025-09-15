# Coreza Trading Platform

An advanced, open-source trading platform with workflow automation and secure credential management.

## 🚀 Quick Start

Get up and running in minutes with our automated setup:

```bash
# Clone the repository
git clone https://github.com/Coreza-io/coreza.git
cd coreza

# Run the automated setup
node setup/setup.js
```

The setup script will:
- Install all dependencies (frontend & backend)  
- Configure your Supabase project
- Generate secure encryption keys
- Set up environment files
- Deploy edge functions
- Initialize the database schema
- Validate your installation

## 🏗️ Architecture

- **Frontend**: React + TypeScript + Vite
- **Backend**: Node.js + Express + TypeScript
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth with RLS
- **Encryption**: AES-256-GCM for credentials

## 🔐 Security Features

- **End-to-end encryption** for all sensitive credentials
- **Row Level Security (RLS)** policies for data isolation
- **JWT-based authentication** with automatic session management
- **Secure edge functions** for credential operations
- **Environment-based key management**

## ✨ Key Features

- **Multi-broker support** (Alpaca, Dhan, more coming)
- **Technical indicators** (RSI, MACD, Bollinger Bands, etc.)
- **Workflow automation** with visual editor
- **Risk management** tools

## 🛠️ Manual Setup

If you prefer manual setup or the automated setup fails:

### Prerequisites

- Node.js 18+ 
- A Supabase account and project
- Git

### 1. Environment Setup

```bash
# Copy and configure environment files
cp .env.example .env
cp coreza-backend/.env.example coreza-backend/.env

# Edit both files with your Supabase credentials
```

### 2. Install Dependencies

```bash
# Frontend dependencies
npm install

# Backend dependencies  
cd coreza-backend
npm install
cd ..
```

### 3. Database Setup

The database schema is already configured through migrations. If needed, you can apply it manually using the Supabase dashboard or CLI.

### 4. Start Development Servers

```bash
# Terminal 1: Frontend
npm run dev

# Terminal 2: Backend  
cd coreza-backend
npm run dev
```

## 📁 Project Structure

```
coreza/
├── src/                    # Frontend React application
├── coreza-backend/         # Backend Node.js application
├── supabase/              # Supabase configuration & functions
├── setup/                 # Setup and validation scripts
├── docs/                  # Documentation
└── tests/                 # Test suites
```

## 🔧 Development

```bash
# Validate your setup
node setup/validate.js

# Run tests
npm test

# Build for production
npm run build
```

## 📖 Documentation

- [Setup Guide](docs/SETUP.md) - Detailed setup instructions
- [Troubleshooting](docs/TROUBLESHOOTING.md) - Common issues and solutions
- [Deployment Guide](docs/DEPLOYMENT.md) - Production deployment
- [Security Guide](docs/SECURITY.md) - Security best practices

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: Check our comprehensive docs in `/docs`
- **Issues**: Report bugs via GitHub Issues
- **Community**: Join our discussions

---

**⚠️ Security Notice**: This platform handles financial data and trading credentials. Always:
- Keep your encryption keys secure
- Use HTTPS in production
- Regularly update dependencies
- Review access permissions

Happy trading! 🚀