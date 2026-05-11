#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

class SetupValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  async validate() {
    console.log("🔍 Validating Coreza setup...\n");

    this.checkEnvironmentFiles();
    this.checkSetupLocalFile();
    this.checkSupabaseConfig();
    this.checkDatabaseSchema();
    this.checkEdgeFunctions();
    this.checkMarketStreamService();

    this.displayResults();

    if (this.errors.length > 0) {
      process.exit(1);
    }
  }

  checkEnvironmentFiles() {
    console.log("📝 Checking environment files...");

    // Frontend .env
    if (!fs.existsSync(".env")) {
      this.errors.push("Frontend .env file missing");
    } else {
      const frontendEnv = fs.readFileSync(".env", "utf8");
      for (const v of [
        "VITE_SUPABASE_URL",
        "VITE_SUPABASE_PROJECT_ID",
        "VITE_SUPABASE_PUBLISHABLE_KEY",
      ]) {
        if (!frontendEnv.includes(`${v}=`)) {
          this.errors.push(`${v} missing from .env`);
        }
      }
    }

    // Backend .env
    if (!fs.existsSync("coreza-backend/.env")) {
      this.errors.push("Backend .env file missing");
    } else {
      const backendEnv = fs.readFileSync("coreza-backend/.env", "utf8");
      for (const v of [
        "SUPABASE_URL",
        "SUPABASE_PROJECT_ID",
        "SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_SECRET_KEY",
        "COREZA_ENCRYPTION_KEY",
        "REDIS_QUEUE_URL",
      ]) {
        if (!backendEnv.includes(`${v}=`)) {
          this.errors.push(`${v} missing from coreza-backend/.env`);
        }
      }
    }

    if (this.errors.length === 0) {
      console.log("✅ Environment files configured correctly");
    }
  }

  checkSetupLocalFile() {
    console.log("🔐 Checking setup-only credentials (.env.setup.local)...");
    if (!fs.existsSync(".env.setup.local")) {
      this.warnings.push(
        ".env.setup.local missing — Supabase CLI commands (login/link/db push) require SUPABASE_ACCESS_TOKEN and SUPABASE_DB_PASSWORD.",
      );
      return;
    }
    const setupEnv = fs.readFileSync(".env.setup.local", "utf8");
    for (const v of [
      "SUPABASE_PROJECT_ID",
      "SUPABASE_ACCESS_TOKEN",
      "SUPABASE_DB_PASSWORD",
    ]) {
      if (!setupEnv.includes(`${v}=`)) {
        this.warnings.push(`${v} missing from .env.setup.local`);
      }
    }
  }

  checkSupabaseConfig() {
    console.log("🔧 Checking Supabase configuration...");

    if (!fs.existsSync("supabase/config.toml")) {
      this.errors.push("supabase/config.toml file missing");
    } else {
      const config = fs.readFileSync("supabase/config.toml", "utf8");
      if (!config.includes("project_id =")) {
        this.errors.push("project_id missing from supabase/config.toml");
      }
      if (!config.includes("[functions.derive-encryption-key]")) {
        this.errors.push("derive-encryption-key function config missing");
      }
      if (!config.includes("[functions.http-request]")) {
        this.errors.push("http-request function config missing");
      }
    }

    if (this.errors.length === 0) {
      console.log("✅ Supabase configuration is valid");
    }
  }

  checkDatabaseSchema() {
    console.log("🗄️ Checking database schema...");

    if (!fs.existsSync("setup/database-schema.sql")) {
      this.warnings.push(
        "Database schema file missing (setup/database-schema.sql)",
      );
    } else {
      const schema = fs.readFileSync("setup/database-schema.sql", "utf8");
      const requiredTables = [
        "users",
        "projects",
        "workflows",
        "workflow_versions",
        "workflow_runs",
        "node_executions",
        "user_credentials",
        "backtests",
        "backtest_results",
        "backtest_trades",
        "backtest_portfolio_snapshots",
        "live_fills",
        "live_trades",
        "cash_snapshots",
        "position_snapshots",
      ];

      for (const table of requiredTables) {
        const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const createTableRegex = new RegExp(
          `CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+public\\.${escaped}\\s*\\(`,
          "i",
        );
        if (!createTableRegex.test(schema)) {
          this.warnings.push(`Table ${table} not found in schema`);
        }
      }
    }

    if (this.warnings.length === 0) {
      console.log("✅ Database schema is complete");
    }
  }

  checkEdgeFunctions() {
    console.log("⚡ Checking edge functions...");

    // Check if edge function directories exist
    const functions = ["derive-encryption-key", "http-request"];

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
      console.log("✅ Edge functions are properly configured");
    }
  }

  checkMarketStreamService() {
    console.log("📡 Checking market-stream-service...");
    const svcPath = "coreza-backend/market-stream-service/package.json";
    if (!fs.existsSync(svcPath)) {
      this.errors.push(
        "market-stream-service missing: coreza-backend/market-stream-service",
      );
      return;
    }

    if (!fs.existsSync("coreza-backend/market-stream-service/node_modules")) {
      this.warnings.push(
        "market-stream-service dependencies not installed. Run: cd coreza-backend/market-stream-service && npm install",
      );
    }
  }

  displayResults() {
    console.log("\n📊 Validation Results");
    console.log("====================");

    if (this.errors.length === 0 && this.warnings.length === 0) {
      console.log("🎉 All checks passed! Your Coreza setup is ready.");
      console.log("\nNext steps:");
      console.log("1. npm install");
      console.log("2. cd coreza-backend && npm install");
      console.log("3. npm run dev (in one terminal)");
      console.log("4. cd coreza-backend && npm run dev (in another terminal)");
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
      console.log("\n🔧 To fix these issues:");
      console.log("1. Run the setup script again: node setup/setup.js");
      console.log("2. Or follow the manual setup guide: docs/SETUP.md");
    }
  }
}

// Run validation if called directly
if (require.main === module) {
  const validator = new SetupValidator();
  validator.validate();
}

module.exports = SetupValidator;
