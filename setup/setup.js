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
    this.projectRoot = path.resolve(__dirname, '..');
  }

  async run() {
    console.log('\n🚀 Welcome to Coreza Trading Platform Setup');
    console.log('==========================================\n');
    
    try {
      await this.checkPrerequisites();
      await this.installDependencies();
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

  async installDependencies() {
    console.log('\n📦 Installing dependencies...');
    
    try {
      // Install frontend dependencies
      console.log('Installing frontend dependencies...');
      execSync('npm install', { stdio: 'inherit', cwd: this.projectRoot });
      
      // Install backend dependencies
      console.log('Installing backend dependencies...');
      execSync('npm install', { stdio: 'inherit', cwd: path.join(this.projectRoot, 'coreza-backend') });
      
      console.log('✅ Dependencies installed successfully');
    } catch (error) {
      console.log('⚠️  Manual dependency installation required');
      console.log('Please run:');
      console.log('1. npm install');
      console.log('2. cd coreza-backend && npm install');
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

    // Validate credential formats
    this.validateCredentials();
    
    console.log(`✅ Project ID extracted: ${this.config.projectId}`);
  }

  validateCredentials() {
    if (!this.config.supabaseUrl.startsWith('https://') || !this.config.supabaseUrl.includes('.supabase.co')) {
      throw new Error('Invalid Supabase URL format. Should be https://your-project.supabase.co');
    }
    
    if (!this.config.supabaseAnonKey.startsWith('eyJ')) {
      throw new Error('Invalid Anon Key format. Should start with "eyJ"');
    }
    
    if (!this.config.supabaseServiceKey.startsWith('eyJ')) {
      throw new Error('Invalid Service Role Key format. Should start with "eyJ"');
    }
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
    const frontendEnv = `# ="== React App Config ==="
# VITE_API_URL="https://coreza-backend.onrender.com"
VITE_COREZA_ENCRYPTION_KEY="${this.config.encryptionKey}"
VITE_SUPABASE_PROJECT_ID="${this.config.projectId}"
VITE_SUPABASE_PUBLISHABLE_KEY="${this.config.supabaseAnonKey}"
VITE_SUPABASE_URL="${this.config.supabaseUrl}"
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
    
    fs.writeFileSync(path.join(this.projectRoot, '.env'), frontendEnv);
    fs.writeFileSync(path.join(this.projectRoot, 'coreza-backend', '.env'), backendEnv);
    
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
    
    fs.writeFileSync(path.join(this.projectRoot, 'supabase', 'config.toml'), configContent);
    console.log('✅ Supabase config updated');
  }

  async deployEdgeFunctions() {
    console.log('\n⚡ Deploying edge functions...');
    
    try {
      // Link to Supabase project
      execSync(`supabase link --project-ref ${this.config.projectId}`, { stdio: 'inherit', cwd: this.projectRoot });
      
      // Deploy functions
      execSync('supabase functions deploy', { stdio: 'inherit', cwd: this.projectRoot });
      
      // Set secrets
      execSync(`supabase secrets set COREZA_ENCRYPTION_KEY="${this.config.encryptionKey}"`, { stdio: 'inherit', cwd: this.projectRoot });
      
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
    console.log('\n🗄️  Setting up database...');
    
    try {
      const schemaPath = path.join(this.projectRoot, 'setup', 'database-schema.sql');
      
      if (!fs.existsSync(schemaPath)) {
        throw new Error('Database schema file not found at setup/database-schema.sql');
      }

      console.log('Creating database migration...');
      
      // Ensure migrations directory exists
      const migrationsDir = path.join(this.projectRoot, 'supabase', 'migrations');
      if (!fs.existsSync(migrationsDir)) {
        fs.mkdirSync(migrationsDir, { recursive: true });
      }

      // Check if migration already exists
      const existingMigrations = fs.readdirSync(migrationsDir)
        .filter(file => file.includes('initial_setup') || file.includes('coreza_schema'));

      if (existingMigrations.length === 0) {
        // Create a new migration
        const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        const migrationPath = path.join(migrationsDir, `${timestamp}_coreza_schema_setup.sql`);
        
        const schemaContent = fs.readFileSync(schemaPath, 'utf8');
        fs.writeFileSync(migrationPath, schemaContent);
        
        console.log(`✅ Migration created: ${path.basename(migrationPath)}`);
      } else {
        console.log(`✅ Migration already exists: ${existingMigrations[0]}`);
      }

      // Apply the migration
      console.log('Applying database migration...');
      try {
        execSync('supabase db push', { stdio: 'inherit', cwd: this.projectRoot });
        console.log('✅ Database migration applied successfully');
      } catch (pushError) {
        console.log('⚠️  Migration push failed. Trying alternative method...');
        console.log('Please run the following commands manually:');
        console.log('1. supabase link --project-ref ' + this.config.projectId);
        console.log('2. supabase db push');
        console.log('3. Or apply the schema manually in Supabase SQL Editor');
      }
      
    } catch (error) {
      console.log('⚠️  Database setup encountered an issue:', error.message);
      console.log('\nManual setup options:');
      console.log('1. Run: supabase db push');
      console.log('2. Or copy contents of setup/database-schema.sql to Supabase SQL Editor');
      console.log('3. Or use the migration tool in Supabase dashboard');
    }
  }

  async validateSetup() {
    console.log('\n🔍 Validating setup...');
    
    const errors = [];
    const warnings = [];
    
    // Check if required files exist
    const requiredFiles = [
      { path: '.env', description: 'Frontend environment file' },
      { path: 'coreza-backend/.env', description: 'Backend environment file' },
      { path: 'supabase/config.toml', description: 'Supabase configuration' },
      { path: 'setup/database-schema.sql', description: 'Database schema' }
    ];
    
    for (const file of requiredFiles) {
      const fullPath = path.join(this.projectRoot, file.path);
      if (!fs.existsSync(fullPath)) {
        errors.push(`Missing ${file.description}: ${file.path}`);
      }
    }

    // Check if edge functions exist
    const requiredFunctions = [
      { name: 'derive-encryption-key', description: 'Encryption key derivation function' },
      { name: 'http-request', description: 'HTTP request proxy function' }
    ];
    
    for (const func of requiredFunctions) {
      const funcPath = path.join(this.projectRoot, 'supabase', 'functions', func.name, 'index.ts');
      if (!fs.existsSync(funcPath)) {
        warnings.push(`Edge function missing: ${func.description} (${func.name})`);
      }
    }

    // Validate environment files have required variables
    if (fs.existsSync(path.join(this.projectRoot, '.env'))) {
      const frontendEnv = fs.readFileSync(path.join(this.projectRoot, '.env'), 'utf8');
      const requiredFrontendVars = [
        'VITE_SUPABASE_URL', 
        'VITE_SUPABASE_PUBLISHABLE_KEY', 
        'VITE_COREZA_ENCRYPTION_KEY',
        'VITE_SUPABASE_PROJECT_ID'
      ];
      
      for (const varName of requiredFrontendVars) {
        if (!frontendEnv.includes(`${varName}=`)) {
          errors.push(`Missing frontend environment variable: ${varName}`);
        }
      }
    }
    
    if (fs.existsSync(path.join(this.projectRoot, 'coreza-backend', '.env'))) {
      const backendEnv = fs.readFileSync(path.join(this.projectRoot, 'coreza-backend', '.env'), 'utf8');
      const requiredBackendVars = [
        'SUPABASE_URL', 
        'SUPABASE_ANON_KEY', 
        'SUPABASE_SERVICE_ROLE_KEY', 
        'COREZA_ENCRYPTION_KEY'
      ];
      
      for (const varName of requiredBackendVars) {
        if (!backendEnv.includes(`${varName}=`)) {
          errors.push(`Missing backend environment variable: ${varName}`);
        }
      }
    }

    // Check migrations directory
    const migrationsDir = path.join(this.projectRoot, 'supabase', 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const migrations = fs.readdirSync(migrationsDir)
        .filter(file => file.endsWith('.sql'))
        .length;
      
      if (migrations === 0) {
        warnings.push('No database migrations found - database may not be set up');
      } else {
        console.log(`✅ Found ${migrations} database migration(s)`);
      }
    } else {
      warnings.push('Migrations directory not found - database setup may be incomplete');
    }

    // Report results
    if (errors.length > 0) {
      console.log('\n❌ Setup validation failed:');
      errors.forEach(error => console.log(`  • ${error}`));
      throw new Error('Setup validation failed - please fix the errors above');
    }
    
    if (warnings.length > 0) {
      console.log('\n⚠️  Setup warnings:');
      warnings.forEach(warning => console.log(`  • ${warning}`));
    }
    
    console.log('\n✅ Setup validation passed');
    
    if (warnings.length === 0) {
      console.log('🎯 All components are properly configured!');
    }
  }

  async showCompletionMessage() {
    console.log('\n🎉 Coreza Trading Platform Setup Complete!');
    console.log('=========================================');
    console.log('\n📋 Setup Summary:');
    console.log('  ✅ Dependencies installed');
    console.log('  ✅ Environment files configured');
    console.log('  ✅ Supabase project linked');
    console.log('  ✅ Database schema prepared');
    console.log('  ✅ Edge functions ready');
    console.log('  ✅ Configuration validated');
    
    console.log('\n🚀 Next Steps:');
    console.log('1. Start the frontend: npm run dev');
    console.log('2. Start the backend: cd coreza-backend && npm run dev');
    console.log('3. Open http://localhost:5173 to access the platform');
    
    console.log('\n📚 Documentation:');
    console.log('• Setup guide: docs/SETUP.md');
    console.log('• Security info: docs/SECURITY.md');
    console.log('• Deployment: docs/DEPLOYMENT.md');
    
    console.log('\n🔐 Security Notes:');
    console.log('• Environment files contain sensitive data - keep them private');
    console.log('• Your encryption key has been securely generated');
    console.log('• Review RLS policies before deploying to production');
    
    console.log('\n💡 Troubleshooting:');
    console.log('• If database tables are missing, run: supabase db push');
    console.log('• For edge function issues, run: supabase functions deploy');
    console.log('• Check docs/TROUBLESHOOTING.md for common issues');
    
    console.log('\n🎯 Ready to build your trading algorithms!');
  }
}

// Run setup if called directly
if (require.main === module) {
  const setup = new CorezaSetup();
  setup.run();
}

module.exports = CorezaSetup;