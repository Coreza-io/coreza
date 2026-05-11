#!/usr/bin/env node

const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");
const crypto = require("crypto");
const os = require("os");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

function mask(value) {
  if (!value || typeof value !== "string") return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, Math.min(14, value.length - 4))}****${value.slice(-4)}`;
}

class CorezaSetup {
  constructor() {
    this.config = {};
    this.status = {
      linked: false,
      migrated: false,
      functionsDeployed: false,
      secretsSet: false,
    };
    this.projectRoot = path.resolve(__dirname, "..");
  }

  async run() {
    console.log("\n🚀 Welcome to Coreza Trading Platform Setup");
    console.log("==========================================\n");

    try {
      await this.checkPrerequisites();
      await this.installDependencies();
      await this.collectSupabaseCredentials();
      await this.generateEncryptionKey();
      await this.setupEnvironmentFiles();
      await this.runSupabaseCli();
      await this.checkAndStartRedis();
      await this.validateSetup();
      await this.showCompletionMessage();
    } catch (error) {
      console.error("\n❌ Setup failed:", error.message);
      process.exit(1);
    } finally {
      rl.close();
    }
  }

  async installDependencies() {
    console.log("\n📦 Installing dependencies...");

    try {
      console.log("Installing frontend dependencies...");
      execSync("npm install", {
        stdio: "inherit",
        cwd: this.projectRoot,
        shell: true,
      });

      console.log("Installing backend dependencies...");
      execSync("npm install", {
        stdio: "inherit",
        cwd: path.join(this.projectRoot, "coreza-backend"),
        shell: true,
      });

      console.log("Installing market-stream-service dependencies...");
      execSync("npm install", {
        stdio: "inherit",
        cwd: path.join(
          this.projectRoot,
          "coreza-backend",
          "market-stream-service",
        ),
        shell: true,
      });

      console.log("✅ Dependencies installed successfully");
    } catch (error) {
      throw new Error(
        "Dependency installation failed. Run npm install in project root, coreza-backend, and coreza-backend/market-stream-service.",
      );
    }
  }

  async checkPrerequisites() {
    console.log("🔍 Checking prerequisites...");

    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split(".")[0]);
    if (majorVersion < 18) {
      throw new Error("Node.js 18 or higher is required");
    }

    const backendPath = path.join(this.projectRoot, "coreza-backend");
    if (!fs.existsSync(backendPath)) {
      throw new Error(
        "Missing ./coreza-backend directory. Clone https://github.com/Coreza-io/coreza-backend into ./coreza-backend and rerun setup.",
      );
    }

    try {
      execSync("npx supabase --version", {
        stdio: "ignore",
        cwd: this.projectRoot,
        shell: true,
      });
    } catch (error) {
      console.log("\n📦 Installing Supabase CLI (dev dependency)...");
      execSync("npm install -D supabase", {
        stdio: "inherit",
        cwd: this.projectRoot,
        shell: true,
      });

      try {
        execSync("npx supabase --version", {
          stdio: "ignore",
          cwd: this.projectRoot,
          shell: true,
        });
      } catch {
        throw new Error(
          "Supabase CLI is not available even after installing dev dependency.",
        );
      }
    }

    console.log("✅ Prerequisites check passed");
  }

  parseEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return {};
    const env = {};
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex === -1) continue;
      const key = trimmed.slice(0, equalsIndex).trim();
      let value = trimmed.slice(equalsIndex + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
    return env;
  }

  loadExistingCredentials() {
    if (this.loadedExistingCredentials) return;

    const frontendEnv = this.parseEnvFile(path.join(this.projectRoot, ".env"));
    const backendEnv = this.parseEnvFile(
      path.join(this.projectRoot, "coreza-backend", ".env"),
    );
    const setupLocal = this.parseEnvFile(
      path.join(this.projectRoot, ".env.setup.local"),
    );

    const pick = (...candidates) =>
      candidates.find(
        (c) => typeof c === "string" && c.trim().length > 0,
      );

    this.config.supabaseUrl = pick(
      backendEnv.SUPABASE_URL,
      frontendEnv.VITE_SUPABASE_URL,
      process.env.SUPABASE_URL,
    );
    this.config.supabasePublishableKey = pick(
      backendEnv.SUPABASE_PUBLISHABLE_KEY,
      frontendEnv.VITE_SUPABASE_PUBLISHABLE_KEY,
      process.env.SUPABASE_PUBLISHABLE_KEY,
    );
    this.config.supabaseSecretKey = pick(
      backendEnv.SUPABASE_SECRET_KEY,
      process.env.SUPABASE_SECRET_KEY,
    );
    this.config.supabaseAccessToken = pick(
      setupLocal.SUPABASE_ACCESS_TOKEN,
      process.env.SUPABASE_ACCESS_TOKEN,
    );
    this.config.supabaseDbPassword = pick(
      setupLocal.SUPABASE_DB_PASSWORD,
      process.env.SUPABASE_DB_PASSWORD,
    );
    this.config.projectId = pick(
      setupLocal.SUPABASE_PROJECT_ID,
      backendEnv.SUPABASE_PROJECT_ID,
      frontendEnv.VITE_SUPABASE_PROJECT_ID,
      process.env.SUPABASE_PROJECT_ID,
    );
    this.config.encryptionKey = pick(
      backendEnv.COREZA_ENCRYPTION_KEY,
      process.env.COREZA_ENCRYPTION_KEY,
    );

    this.loadedExistingCredentials = true;
  }

  async collectSupabaseCredentials() {
    console.log("\n🔑 Supabase Configuration");
    console.log("Provide your Supabase project credentials.");
    console.log(
      "Note: Do not paste anon, service_role, publishable, or secret keys as SUPABASE_ACCESS_TOKEN.",
    );
    console.log(
      "      The access token must start with sbp_ and is created from Supabase Account → Access Tokens.\n",
    );

    this.loadExistingCredentials();

    // 1. Project URL
    if (this.config.supabaseUrl) {
      console.log(`Using existing Supabase Project URL: ${this.config.supabaseUrl}`);
    } else {
      this.config.supabaseUrl = (
        await question("Supabase Project URL: ")
      ).trim();
    }
    const urlMatch = this.config.supabaseUrl.match(
      /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/,
    );
    if (!urlMatch) {
      throw new Error(
        "Invalid Supabase URL. Expected format: https://<project-ref>.supabase.co",
      );
    }
    this.config.projectId = urlMatch[1];
    console.log(`✅ Project ID: ${this.config.projectId}`);

    // 2. Publishable key
    if (this.config.supabasePublishableKey) {
      console.log(
        `Using existing Publishable Key: ${mask(this.config.supabasePublishableKey)}`,
      );
    } else {
      this.config.supabasePublishableKey = (
        await question("Supabase Publishable Key (sb_publishable_...): ")
      ).trim();
    }
    if (!this.config.supabasePublishableKey.startsWith("sb_publishable_")) {
      throw new Error(
        "Invalid publishable key. Expected key starting with sb_publishable_.",
      );
    }

    // 3. Secret key
    if (this.config.supabaseSecretKey) {
      console.log(
        `Using existing Secret Key: ${mask(this.config.supabaseSecretKey)}`,
      );
    } else {
      this.config.supabaseSecretKey = (
        await question("Supabase Secret Key (sb_secret_...) [backend only]: ")
      ).trim();
    }
    if (!this.config.supabaseSecretKey.startsWith("sb_secret_")) {
      throw new Error(
        "Invalid secret key. Expected key starting with sb_secret_.",
      );
    }
    console.warn(
      "⚠️  SUPABASE_SECRET_KEY is backend-only. Never expose it in frontend files.",
    );

    // 4. Access token
    if (this.config.supabaseAccessToken) {
      console.log(
        `Using existing Access Token: ${mask(this.config.supabaseAccessToken)}`,
      );
    } else {
      this.config.supabaseAccessToken = (
        await question("Supabase Access Token (sbp_...) [CLI setup only]: ")
      ).trim();
    }
    if (!this.config.supabaseAccessToken.startsWith("sbp_")) {
      throw new Error(
        "Invalid Supabase access token. Expected personal access token starting with sbp_.\n" +
          "Do not use publishable, secret, anon, or service-role keys here.",
      );
    }

    // 5. DB password
    if (this.config.supabaseDbPassword) {
      console.log("Using existing Supabase DB password: ********");
    } else {
      this.config.supabaseDbPassword = (
        await question(
          "Supabase DB Password (postgres role) [used for db push]: ",
        )
      ).trim();
    }
    if (!this.config.supabaseDbPassword) {
      throw new Error(
        "Missing SUPABASE_DB_PASSWORD. This is required for non-interactive db push.",
      );
    }
  }

  async generateEncryptionKey() {
    console.log("\n🔐 Setting up encryption key...");
    if (this.config.encryptionKey) {
      console.log("✅ Using existing encryption key from environment files.");
      return;
    }
    this.config.encryptionKey = crypto.randomBytes(32).toString("base64");
    console.log("✅ Encryption key generated");
  }

  async setupEnvironmentFiles() {
    console.log("\n📝 Setting up environment files...");

    const frontendEnv = `# === React App Config ===
VITE_BACKEND_URL=http://localhost:8000
VITE_SUPABASE_URL=${this.config.supabaseUrl}
VITE_SUPABASE_PROJECT_ID=${this.config.projectId}
VITE_SUPABASE_PUBLISHABLE_KEY=${this.config.supabasePublishableKey}
WEBSOCKET_PORT=8081
VITE_BACKEND_WS_URL=ws://localhost:8081
VITE_INACTIVITY_TIMEOUT=600000
`;

    const backendEnv = `# Supabase Configuration (runtime — backend only)
SUPABASE_URL=${this.config.supabaseUrl}
SUPABASE_PROJECT_ID=${this.config.projectId}
SUPABASE_PUBLISHABLE_KEY=${this.config.supabasePublishableKey}
SUPABASE_ANON_KEY=${this.config.supabasePublishableKey}
SUPABASE_SECRET_KEY=${this.config.supabaseSecretKey}

# Encryption
COREZA_ENCRYPTION_KEY=${this.config.encryptionKey}

# Redis
REDIS_QUEUE_URL=redis://localhost:6379
REDIS_CACHE_URL=redis://localhost:6379

# Runtime ports
PORT=8000
WEBSOCKET_PORT=8081
MARKET_STREAM_PORT=8090

# Workflow
WORKFLOW_JOB_ATTEMPTS=0
BACKTEST_EXECUTION_MODE=auto

# Broker OAuth callback URLs
ALPACA_REDIRECT_URI=http://localhost:8000/api/oauth/alpaca/callback
BINANCE_REDIRECT_URI=http://localhost:8000/api/oauth/binance/callback
SCHWAB_REDIRECT_URI=http://localhost:8000/api/oauth/schwab/callback
`;

    const streamEnv = `SUPABASE_URL=${this.config.supabaseUrl}
SUPABASE_SECRET_KEY=${this.config.supabaseSecretKey}
COREZA_ENCRYPTION_KEY=${this.config.encryptionKey}
REDIS_QUEUE_URL=redis://localhost:6379
REDIS_CACHE_URL=redis://localhost:6379
MARKET_STREAM_PORT=8090
`;

    const setupLocalEnv = `# Setup/CI-only — never commit
# Used by Supabase CLI for non-interactive login, link, and db push.
SUPABASE_PROJECT_ID=${this.config.projectId}
SUPABASE_ACCESS_TOKEN=${this.config.supabaseAccessToken}
SUPABASE_DB_PASSWORD=${this.config.supabaseDbPassword}
`;

    fs.writeFileSync(path.join(this.projectRoot, ".env"), frontendEnv);
    fs.writeFileSync(
      path.join(this.projectRoot, "coreza-backend", ".env"),
      backendEnv,
    );
    fs.writeFileSync(
      path.join(
        this.projectRoot,
        "coreza-backend",
        "market-stream-service",
        ".env",
      ),
      streamEnv,
    );
    fs.writeFileSync(
      path.join(this.projectRoot, ".env.setup.local"),
      setupLocalEnv,
    );

    this.ensureGitignoreEntry(".env.setup.local");

    console.log("✅ Environment files created (secrets redacted in logs)");
  }

  ensureGitignoreEntry(entry) {
    const gitignorePath = path.join(this.projectRoot, ".gitignore");
    let contents = "";
    if (fs.existsSync(gitignorePath)) {
      contents = fs.readFileSync(gitignorePath, "utf8");
    }
    const lines = contents.split(/\r?\n/).map((l) => l.trim());
    if (lines.includes(entry)) return;
    const updated =
      (contents.endsWith("\n") || contents.length === 0 ? contents : contents + "\n") +
      `${entry}\n`;
    fs.writeFileSync(gitignorePath, updated);
  }

  supabaseEnv() {
    return {
      ...process.env,
      SUPABASE_ACCESS_TOKEN: this.config.supabaseAccessToken,
      SUPABASE_DB_PASSWORD: this.config.supabaseDbPassword,
    };
  }

  runOrThrow(label, command, friendlyError) {
    console.log(`\n▶  ${label}`);
    const result = spawnSync(command, {
      shell: true,
      cwd: this.projectRoot,
      env: this.supabaseEnv(),
      stdio: "inherit",
    });
    if (result.status !== 0) {
      console.error(`\n❌ ${friendlyError}`);
      throw new Error(`${label} failed`);
    }
  }

  async runSupabaseCli() {
    console.log("\n🏗️  Running Supabase CLI flow...");

    // 1. Preflight
    this.runOrThrow(
      "Verify Supabase CLI",
      "npx supabase --version",
      "Supabase CLI is not available. Install with: npm install -D supabase",
    );

    // 2. Login
    this.runOrThrow(
      "Supabase CLI login",
      `npx supabase login --token "${this.config.supabaseAccessToken}"`,
      "Supabase CLI login failed.\n" +
        "Check SUPABASE_ACCESS_TOKEN.\n" +
        "It must be a personal access token starting with sbp_.",
    );

    // 3. Generate config.toml from template
    const templatePath = path.join(
      this.projectRoot,
      "supabase",
      "config.template.toml",
    );
    const configPath = path.join(this.projectRoot, "supabase", "config.toml");
    if (fs.existsSync(templatePath)) {
      const template = fs.readFileSync(templatePath, "utf8");
      fs.writeFileSync(
        configPath,
        template.replace(/\{\{PROJECT_ID\}\}/g, this.config.projectId),
      );
      console.log("✅ Generated supabase/config.toml from template");
    }

    // 4. Link
    this.runOrThrow(
      "Link Supabase project",
      `npx supabase link --project-ref ${this.config.projectId}`,
      "Supabase project linking failed.\n" +
        "Check:\n" +
        "1. Project ref is correct.\n" +
        "2. The project exists.\n" +
        "3. Your access token belongs to an Owner/Admin of the Supabase organization.",
    );
    this.status.linked = true;

    // 5. Prepare migration file
    this.prepareMigrationFile();

    // 6. db push (non-interactive — env carries SUPABASE_DB_PASSWORD)
    try {
      this.runOrThrow(
        "Apply database migrations (db push)",
        "npx supabase db push",
        "Database migration push failed.\n" +
          "Check:\n" +
          "1. SUPABASE_DB_PASSWORD is correct.\n" +
          "2. Project is linked.\n" +
          "3. Your database is active and reachable.",
      );
      this.status.migrated = true;
    } catch (err) {
      // Attempt repair-then-retry once
      const repaired = await this.tryMigrationRepair();
      if (!repaired) throw err;
      this.runOrThrow(
        "Re-apply database migrations after repair",
        "npx supabase db push",
        "Database migration push failed after repair.\n" +
          "Check SUPABASE_DB_PASSWORD and project link state.",
      );
      this.status.migrated = true;
    }

    // 7. Functions deploy
    this.runOrThrow(
      "Deploy edge functions",
      "npx supabase functions deploy",
      "Edge function deployment failed.\n" +
        "Check:\n" +
        "1. Supabase CLI login.\n" +
        "2. Project link.\n" +
        "3. Function folders exist under supabase/functions.",
    );
    this.status.functionsDeployed = true;

    // 8. Set encryption secret
    this.runOrThrow(
      "Set Supabase secret COREZA_ENCRYPTION_KEY",
      `npx supabase secrets set COREZA_ENCRYPTION_KEY="${this.config.encryptionKey}"`,
      "Failed to set Supabase secret COREZA_ENCRYPTION_KEY.\n" +
        "Check Supabase CLI login and project link.",
    );
    this.status.secretsSet = true;
  }

  prepareMigrationFile() {
    const schemaPath = path.join(
      this.projectRoot,
      "setup",
      "database-schema.sql",
    );
    if (!fs.existsSync(schemaPath)) {
      throw new Error(
        "Database schema file not found at setup/database-schema.sql",
      );
    }

    const migrationsDir = path.join(
      this.projectRoot,
      "supabase",
      "migrations",
    );
    if (!fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
    }

    const managedName = "00000000000000_coreza_initial_schema.sql";
    // Filenames matching this pattern are considered "Lovable-generated history"
    // (timestamp-prefixed) and are safe to wipe on self-host install.
    const lovableHistoryPattern = /^\d{14}_.+\.sql$/;
    const force = process.argv.includes("--force-reset-migrations");

    const existing = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"));

    const unexpected = existing.filter(
      (f) => f !== managedName && !lovableHistoryPattern.test(f),
    );
    if (unexpected.length > 0 && !force) {
      throw new Error(
        `Refusing to wipe supabase/migrations/: unexpected files present:\n  - ${unexpected.join(
          "\n  - ",
        )}\nMove them aside or re-run with --force-reset-migrations.`,
      );
    }

    for (const f of existing) {
      fs.unlinkSync(path.join(migrationsDir, f));
    }
    if (existing.length > 0) {
      console.log(
        `🧹 Removed ${existing.length} existing migration file(s) from supabase/migrations/.`,
      );
    }

    const schemaContent = fs.readFileSync(schemaPath, "utf8");
    const migrationPath = path.join(migrationsDir, managedName);
    fs.writeFileSync(migrationPath, schemaContent);
    console.log(`✅ Migration created: ${managedName}`);
  }

  async tryMigrationRepair() {
    // Best-effort: if remote has migration versions not in local, mark them reverted.
    const probe = spawnSync("npx supabase db push --dry-run", {
      shell: true,
      cwd: this.projectRoot,
      env: this.supabaseEnv(),
      encoding: "utf8",
    });
    const output = `${probe.stdout || ""}\n${probe.stderr || ""}`;
    const versionMatch = output.match(
      /supabase migration repair --status reverted (\d+)/,
    );
    if (!versionMatch) return false;
    const version = versionMatch[1];
    console.log(`🔧 Repairing migration history for version ${version}...`);
    const repair = spawnSync(
      `npx supabase migration repair --status reverted ${version}`,
      {
        shell: true,
        cwd: this.projectRoot,
        env: this.supabaseEnv(),
        stdio: "inherit",
      },
    );
    return repair.status === 0;
  }

  async validateSetup() {
    console.log("\n🔍 Validating setup...");
    const errors = [];
    const warnings = [];

    const requiredFiles = [
      { path: ".env", description: "Frontend environment file" },
      { path: "coreza-backend/.env", description: "Backend environment file" },
      { path: "supabase/config.toml", description: "Supabase configuration" },
      { path: "setup/database-schema.sql", description: "Database schema" },
    ];

    for (const file of requiredFiles) {
      const fullPath = path.join(this.projectRoot, file.path);
      if (!fs.existsSync(fullPath)) {
        errors.push(`Missing ${file.description}: ${file.path}`);
      }
    }

    const requiredFunctions = ["derive-encryption-key", "http-request"];
    for (const name of requiredFunctions) {
      const funcPath = path.join(
        this.projectRoot,
        "supabase",
        "functions",
        name,
        "index.ts",
      );
      if (!fs.existsSync(funcPath)) {
        warnings.push(`Edge function missing: ${name}`);
      }
    }

    if (fs.existsSync(path.join(this.projectRoot, ".env"))) {
      const env = fs.readFileSync(path.join(this.projectRoot, ".env"), "utf8");
      for (const v of [
        "VITE_SUPABASE_URL",
        "VITE_SUPABASE_PROJECT_ID",
        "VITE_SUPABASE_PUBLISHABLE_KEY",
      ]) {
        if (!env.includes(`${v}=`)) errors.push(`Missing frontend var: ${v}`);
      }
    }

    if (fs.existsSync(path.join(this.projectRoot, "coreza-backend", ".env"))) {
      const env = fs.readFileSync(
        path.join(this.projectRoot, "coreza-backend", ".env"),
        "utf8",
      );
      for (const v of [
        "SUPABASE_URL",
        "SUPABASE_PROJECT_ID",
        "SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_SECRET_KEY",
        "COREZA_ENCRYPTION_KEY",
      ]) {
        if (!env.includes(`${v}=`)) errors.push(`Missing backend var: ${v}`);
      }
    }

    const migrationsDir = path.join(this.projectRoot, "supabase", "migrations");
    if (fs.existsSync(migrationsDir)) {
      const migrations = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql")).length;
      if (migrations === 0) {
        warnings.push("No database migrations found");
      } else {
        console.log(`✅ Found ${migrations} database migration(s)`);
      }
    } else {
      warnings.push("Migrations directory not found");
    }

    if (errors.length > 0) {
      console.log("\n❌ Setup validation failed:");
      errors.forEach((e) => console.log(`  • ${e}`));
      throw new Error("Setup validation failed");
    }
    if (warnings.length > 0) {
      console.log("\n⚠️  Setup warnings:");
      warnings.forEach((w) => console.log(`  • ${w}`));
    }
    console.log("\n✅ Setup validation passed");
  }

  async showCompletionMessage() {
    console.log("\n🎉 Coreza Trading Platform Setup Complete!");
    console.log("=========================================");
    console.log("\n📋 Setup Summary:");
    console.log("  ✅ Dependencies installed");
    console.log("  ✅ Environment files configured");
    if (this.status.linked) console.log("  ✅ Supabase project linked");
    if (this.status.migrated) console.log("  ✅ Database schema applied");
    if (this.status.functionsDeployed)
      console.log("  ✅ Edge functions deployed");
    if (this.status.secretsSet)
      console.log("  ✅ Supabase secrets configured");

    console.log("\n🚀 Next Steps:");
    console.log("1. Start the frontend: npm run dev");
    console.log("2. Start the backend: cd coreza-backend && npm run dev");
    console.log(
      "3. Start market-stream-service: cd coreza-backend/market-stream-service && npm run dev",
    );
    console.log("4. Open http://localhost:5173 to access the platform");

    console.log("\n🔐 Security Notes:");
    console.log("• .env.setup.local contains your access token + DB password — keep it private (gitignored).");
    console.log("• SUPABASE_SECRET_KEY is in coreza-backend/.env only — never expose to frontend.");
    console.log("• If a secret was pasted into logs/chat, rotate it from the Supabase dashboard.");
  }

  async checkAndStartRedis() {
    console.log("\n🟥 Checking for Redis...");
    const check = spawnSync("redis-server", ["--version"], {
      shell: true,
      encoding: "utf8",
    });

    if (check.status === 0 && /Redis/i.test(check.stdout)) {
      console.log("✅ Redis is installed.");
      try {
        this.startRedisInstances("redis-server");
        return;
      } catch {
        console.log(
          "⚠️ Failed to start Redis automatically. Please start manually on port 6379.",
        );
        return;
      }
    }

    console.log("⚠️ Redis is not installed on this system.");
    if (os.platform() === "win32") {
      console.log("👉 Windows: https://github.com/tporadowski/redis/releases");
    } else if (os.platform() === "linux") {
      console.log("👉 Linux (Debian/Ubuntu): sudo apt install redis-server -y");
    } else if (os.platform() === "darwin") {
      console.log("👉 macOS: brew install redis");
    }
  }

  startRedisInstances(binaryPath) {
    console.log("🚀 Starting Redis in background...");
    this.startRedis(binaryPath, 6379);
    console.log("✅ Redis started on port 6379");
  }

  startRedis(binaryPath, port) {
    const { spawn } = require("child_process");
    const redis = spawn(binaryPath, ["--port", String(port)], {
      detached: true,
      stdio: "ignore",
      shell: true,
    });
    redis.unref();
    console.log(`✅ Redis server started on port ${port} (detached)`);
  }
}

if (require.main === module) {
  const setup = new CorezaSetup();
  setup.run();
}

module.exports = CorezaSetup;
