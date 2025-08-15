#!/usr/bin/env node

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

class CorezaSetup {
  constructor() {
    this.config = {};
    this.setupComplete = false;
  }

  async run() {
    console.log('\n🚀 Welcome to Coreza Trading Platform Setup');
    console.log('==========================================\n');
    
    try {
      await this.checkPrerequisites();
      await this.collectSupabaseCredentials();
      await this.generateEncryptionKey();
      await this.setupEnvironmentFiles();
      await this.setupSupabaseProject();
      await this.deployEdgeFunctions();
      await this.runDatabaseMigrations();
      await this.validateSetup();
      await this.showCompletionMessage();
    } catch (error) {
      console.error('\n❌ Setup failed:', error.message);
      process.exit(1);
    } finally {
      rl.close();
    }
  }

  async checkPrerequisites() {
    console.log('🔍 Checking prerequisites...');
    
    // Check Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    if (majorVersion < 18) {
      throw new Error('Node.js 18 or higher is required');
    }
    
    // Check if Supabase CLI is installed
    try {
      execSync('supabase --version', { stdio: 'ignore' });
    } catch (error) {
      console.log('\n📦 Installing Supabase CLI...');
      execSync('npm install -g supabase', { stdio: 'inherit' });
    }
    
    console.log('✅ Prerequisites check passed');
  }

  async collectSupabaseCredentials() {
    console.log('\n🔑 Supabase Configuration');
    console.log('Please provide your Supabase project credentials:');
    console.log('(You can find these in your Supabase project settings)\n');
    
    this.config.supabaseUrl = await question('Supabase Project URL: ');
    this.config.supabaseAnonKey = await question('Supabase Anon Key: ');
    this.config.supabaseServiceKey = await question('Supabase Service Role Key: ');
    this.config.projectId = this.extractProjectId(this.config.supabaseUrl);
    
    if (!this.config.projectId) {
      throw new Error('Invalid Supabase URL format');
    }
    
    console.log(`✅ Project ID extracted: ${this.config.projectId}`);
  }

  extractProjectId(url) {
    const match = url.match(/https:\/\/([a-zA-Z0-9]+)\.supabase\.co/);
    return match ? match[1] : null;
  }

  async generateEncryptionKey() {
    console.log('\n🔐 Generating encryption key...');
    this.config.encryptionKey = crypto.randomBytes(32).toString('base64');
    console.log('✅ Encryption key generated');
  }

  async setupEnvironmentFiles() {
    console.log('\n📝 Setting up environment files...');
    
    // Frontend .env
    const frontendEnv = `# Supabase Configuration
VITE_SUPABASE_URL=${this.config.supabaseUrl}
VITE_SUPABASE_ANON_KEY=${this.config.supabaseAnonKey}

# Encryption Configuration
VITE_COREZA_ENCRYPTION_KEY=${this.config.encryptionKey}
`;
    
    // Backend .env
    const backendEnv = `# Supabase Configuration
SUPABASE_URL=${this.config.supabaseUrl}
SUPABASE_ANON_KEY=${this.config.supabaseAnonKey}
SUPABASE_SERVICE_ROLE_KEY=${this.config.supabaseServiceKey}

# Encryption Configuration
COREZA_ENCRYPTION_KEY=${this.config.encryptionKey}

# Server Configuration
PORT=3001
NODE_ENV=development
`;
    
    fs.writeFileSync('.env', frontendEnv);
    fs.writeFileSync('coreza-backend/.env', backendEnv);
    
    console.log('✅ Environment files created');
  }

  async setupSupabaseProject() {
    console.log('\n🏗️  Setting up Supabase project...');
    
    // Update supabase config
    const configContent = `project_id = "${this.config.projectId}"

[api]
enabled = true
port = 54321
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[auth]
enabled = true
site_url = "http://127.0.0.1:3000"
additional_redirect_urls = ["https://127.0.0.1:3000"]
jwt_expiry = 3600
enable_signup = true
enable_confirmations = false

[edge_functions]
enabled = true

[functions.derive-encryption-key]
verify_jwt = false

[functions.http-request]
verify_jwt = false
`;
    
    fs.writeFileSync('supabase/config.toml', configContent);
    console.log('✅ Supabase config updated');
  }

  async deployEdgeFunctions() {
    console.log('\n⚡ Deploying edge functions...');
    
    try {
      // Link to Supabase project
      execSync(`supabase link --project-ref ${this.config.projectId}`, { stdio: 'inherit' });
      
      // Deploy functions
      execSync('supabase functions deploy', { stdio: 'inherit' });
      
      // Set secrets
      execSync(`supabase secrets set COREZA_ENCRYPTION_KEY="${this.config.encryptionKey}"`, { stdio: 'inherit' });
      
      console.log('✅ Edge functions deployed and secrets configured');
    } catch (error) {
      console.log('⚠️  Manual setup required for edge functions');
      console.log('Please run the following commands manually:');
      console.log(`supabase link --project-ref ${this.config.projectId}`);
      console.log('supabase functions deploy');
      console.log(`supabase secrets set COREZA_ENCRYPTION_KEY="${this.config.encryptionKey}"`);
    }
  }

  async runDatabaseMigrations() {
    console.log('\n🗄️  Running database migrations...');
    
    try {
      execSync('supabase db push', { stdio: 'inherit' });
      console.log('✅ Database migrations completed');
    } catch (error) {
      console.log('⚠️  Manual migration required');
      console.log('Please run: supabase db push');
    }
  }

  async validateSetup() {
    console.log('\n🔍 Validating setup...');
    
    // Check if files exist
    const requiredFiles = ['.env', 'coreza-backend/.env', 'supabase/config.toml'];
    for (const file of requiredFiles) {
      if (!fs.existsSync(file)) {
        throw new Error(`Required file missing: ${file}`);
      }
    }
    
    console.log('✅ Setup validation passed');
  }

  async showCompletionMessage() {
    console.log('\n🎉 Setup Complete!');
    console.log('==================');
    console.log('\nNext steps:');
    console.log('1. Install dependencies: npm install');
    console.log('2. Install backend dependencies: cd coreza-backend && npm install');
    console.log('3. Start the frontend: npm run dev');
    console.log('4. Start the backend: cd coreza-backend && npm run dev');
    console.log('\nYour Coreza Trading Platform is ready to use!');
    console.log('\n📚 For more information, see docs/SETUP.md');
  }
}

// Run setup if called directly
if (require.main === module) {
  const setup = new CorezaSetup();
  setup.run();
}

module.exports = CorezaSetup;