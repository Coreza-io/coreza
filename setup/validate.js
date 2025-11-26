#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

class SetupValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  async validate() {
    console.log('🔍 Validating Coreza setup...\n');
    
    this.checkEnvironmentFiles();
    this.checkSupabaseConfig();
    this.checkDatabaseSchema();
    this.checkEdgeFunctions();
    
    this.displayResults();
    
    if (this.errors.length > 0) {
      process.exit(1);
    }
  }

  checkEnvironmentFiles() {
    console.log('📝 Checking environment files...');
    
    // Check frontend .env
    if (!fs.existsSync('.env')) {
      this.errors.push('Frontend .env file missing');
    } else {
      const frontendEnv = fs.readFileSync('.env', 'utf8');
      if (!frontendEnv.includes('VITE_SUPABASE_URL=')) {
        this.errors.push('VITE_SUPABASE_URL missing from .env');
      }
      if (!frontendEnv.includes('VITE_SUPABASE_ANON_KEY=')) {
        this.errors.push('VITE_SUPABASE_ANON_KEY missing from .env');
      }
      if (!frontendEnv.includes('VITE_COREZA_ENCRYPTION_KEY=')) {
        this.errors.push('VITE_COREZA_ENCRYPTION_KEY missing from .env');
      }
    }
    
    // Check backend .env
    if (!fs.existsSync('coreza-backend/.env')) {
      this.errors.push('Backend .env file missing');
    } else {
      const backendEnv = fs.readFileSync('coreza-backend/.env', 'utf8');
      if (!backendEnv.includes('SUPABASE_URL=')) {
        this.errors.push('SUPABASE_URL missing from coreza-backend/.env');
      }
      if (!backendEnv.includes('SUPABASE_SERVICE_ROLE_KEY=')) {
        this.errors.push('SUPABASE_SERVICE_ROLE_KEY missing from coreza-backend/.env');
      }
      if (!backendEnv.includes('COREZA_ENCRYPTION_KEY=')) {
        this.errors.push('COREZA_ENCRYPTION_KEY missing from coreza-backend/.env');
      }
    }
    
    if (this.errors.length === 0) {
      console.log('✅ Environment files configured correctly');
    }
  }

  checkSupabaseConfig() {
    console.log('🔧 Checking Supabase configuration...');
    
    if (!fs.existsSync('supabase/config.toml')) {
      this.errors.push('supabase/config.toml file missing');
    } else {
      const config = fs.readFileSync('supabase/config.toml', 'utf8');
      if (!config.includes('project_id =')) {
        this.errors.push('project_id missing from supabase/config.toml');
      }
      if (!config.includes('[functions.derive-encryption-key]')) {
        this.errors.push('derive-encryption-key function config missing');
      }
      if (!config.includes('[functions.http-request]')) {
        this.errors.push('http-request function config missing');
      }
    }
    
    if (this.errors.length === 0) {
      console.log('✅ Supabase configuration is valid');
    }
  }

  checkDatabaseSchema() {
    console.log('🗄️ Checking database schema...');
    
    if (!fs.existsSync('setup/database-schema.sql')) {
      this.warnings.push('Database schema file missing (setup/database-schema.sql)');
    } else {
      const schema = fs.readFileSync('setup/database-schema.sql', 'utf8');
      const requiredTables = [
        'users', 'projects', 'workflows', 
        'workflow_runs', 'node_executions', 'user_credentials'
      ];
      
      for (const table of requiredTables) {
        if (!schema.includes(`CREATE TABLE IF NOT EXISTS public.${table}`)) {
          this.warnings.push(`Table ${table} not found in schema`);
        }
      }
    }
    
    if (this.warnings.length === 0) {
      console.log('✅ Database schema is complete');
    }
  }

  checkEdgeFunctions() {
    console.log('⚡ Checking edge functions...');
    
    // Check if edge function directories exist
    const functions = ['derive-encryption-key', 'http-request'];
    
    for (const func of functions) {
      const funcPath = `supabase/functions/${func}`;
      if (!fs.existsSync(funcPath)) {
        this.errors.push(`Edge function directory missing: ${funcPath}`);
      } else {
        const indexPath = `${funcPath}/index.ts`;
        if (!fs.existsSync(indexPath)) {
          this.errors.push(`Edge function index.ts missing: ${indexPath}`);
        }
      }
    }
    
    if (this.errors.length === 0) {
      console.log('✅ Edge functions are properly configured');
    }
  }

  displayResults() {
    console.log('\n📊 Validation Results');
    console.log('====================');
    
    if (this.errors.length === 0 && this.warnings.length === 0) {
      console.log('🎉 All checks passed! Your Coreza setup is ready.');
      console.log('\nNext steps:');
      console.log('1. npm install');
      console.log('2. cd coreza-backend && npm install');
      console.log('3. npm run dev (in one terminal)');
      console.log('4. cd coreza-backend && npm run dev (in another terminal)');
      return;
    }
    
    if (this.errors.length > 0) {
      console.log(`\n❌ ${this.errors.length} Error(s) found:`);
      this.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }
    
    if (this.warnings.length > 0) {
      console.log(`\n⚠️  ${this.warnings.length} Warning(s):`);
      this.warnings.forEach((warning, index) => {
        console.log(`   ${index + 1}. ${warning}`);
      });
    }
    
    if (this.errors.length > 0) {
      console.log('\n🔧 To fix these issues:');
      console.log('1. Run the setup script again: node setup/setup.js');
      console.log('2. Or follow the manual setup guide: docs/SETUP.md');
    }
  }
}

// Run validation if called directly
if (require.main === module) {
  const validator = new SetupValidator();
  validator.validate();
}

module.exports = SetupValidator;