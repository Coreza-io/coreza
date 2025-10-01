# Coreza Trading Platform

![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)

An advanced, open-source trading platform that combines powerful workflow automation with institutional-level security. Built for traders, by traders - featuring multi-broker integration, real-time market data, technical analysis, and visual workflow orchestration.

## 🌟 What Makes Coreza Different

- **Visual Workflow Builder**: Design complex trading strategies without code using our intuitive node-based editor
- **Multi-Broker Support**: Trade seamlessly across Alpaca, Dhan, and more brokers from a single platform
- **Enterprise Security**: Bank-grade AES-256-GCM encryption and Row Level Security for credential management
- **Real-Time Analytics**: Live market data, technical indicators, and risk management in one unified interface
- **100% Open Source**: Fully transparent codebase under Apache 2.0 license - audit, customize, and extend freely

## 🚀 Quick Start

Get up and running in minutes with our automated setup:

```bash
# Clone the repository
git clone https://github.com/Coreza-io/coreza.git
cd coreza

# Run the automated setup
node setup/setup.js

# ⚠️ IMPORTANT: Start Redis server manually in a separate (cmd/shell)

# On Windows (cmd or PowerShell):
redis-server.exe

# On Linux:
sudo service redis-server start
# OR
redis-server --daemonize yes

# On macOS:
brew services start redis

# Once Redis is running, start the frontend:
npm run dev

# In another terminal, start the backend:
cd coreza-backend
npm run dev
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

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

```
Copyright 2024 Coreza Trading Platform

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

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
