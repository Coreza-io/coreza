# Coreza Trading Platform

An advanced, open-source trading platform with workflow automation, real-time market data, and secure credential management.

## 🚀 Quick Start

Get your own instance running in minutes:

```bash
# Clone the repository
git clone https://github.com/your-username/coreza-trading-platform.git
cd coreza-trading-platform

# Run the automated setup
npm install
npm run setup

# Start the application
npm run dev
```

The setup script will:
- Collect your Supabase credentials
- Generate encryption keys
- Configure environment files
- Deploy edge functions
- Set up the database schema

## 📋 Prerequisites

- **Node.js 18+**
- **Supabase account** (free tier works)
- **Git** for cloning

## 🏗️ Architecture

- **Frontend**: React + TypeScript + Vite
- **Backend**: Node.js + Express
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth with RLS
- **Encryption**: AES-256-GCM for credentials
- **Real-time**: WebSocket connections
- **Deployment**: Edge functions + static hosting

## 🔐 Security Features

- **End-to-end encryption** for trading credentials
- **Row Level Security** on all database tables
- **User-specific key derivation** with HKDF-SHA256
- **Enterprise-grade** authentication
- **Audit logging** for all operations

## 📊 Trading Features

- **Multi-broker support** (Alpaca, Dhan, more coming)
- **Technical indicators** (RSI, MACD, Bollinger Bands, etc.)
- **Workflow automation** with visual editor
- **Real-time market data** integration
- **Risk management** tools
- **Backtesting** capabilities

## 🛠️ Manual Setup

If you prefer manual setup or need to troubleshoot:

1. **Create Supabase Project**
2. **Configure Environment Variables**
3. **Run Database Migrations**
4. **Deploy Edge Functions**
5. **Set Encryption Secrets**

See [docs/SETUP.md](docs/SETUP.md) for detailed instructions.

## 📚 Documentation

- [🚀 Setup Guide](docs/SETUP.md) - Complete setup instructions
- [🌐 Deployment Guide](docs/DEPLOYMENT.md) - Production deployment
- [🔒 Security Documentation](docs/SECURITY.md) - Security architecture
- [🔧 Troubleshooting](docs/TROUBLESHOOTING.md) - Common issues

## 🤝 Contributing

We welcome contributions! Please see our contributing guidelines and code of conduct.

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

## 🆘 Support

- 📖 [Documentation](docs/)
- 🐛 [GitHub Issues](https://github.com/your-username/coreza-trading-platform/issues)
- 💬 [Community Discussions](https://github.com/your-username/coreza-trading-platform/discussions)

## ⚠️ Disclaimer

This platform is for educational and development purposes. Always test thoroughly before using with real trading accounts. We are not responsible for any financial losses.
