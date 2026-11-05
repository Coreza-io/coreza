#!/usr/bin/env node

const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { execSync, spawn, spawnSync } = require("child_process");
const crypto = require("crypto");
const os = require("os");

// Pin the CLI target/flag contract used by this installer.
const SUPABASE_CLI = "npx --yes supabase@3.0.0";

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
      schemaVerified: false,
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

    const targets = [
      ["frontend", this.projectRoot],
      ["backend", path.join(this.projectRoot, "coreza-backend")],
      [
        "market-stream-service",
        path.join(this.projectRoot, "coreza-backend", "market-stream-service"),
      ],
    ];

    let retryCache;
    let npmEnv = process.env;
    try {
      for (const [name, cwd] of targets) {
        console.log(`Installing ${name} dependencies...`);
        let result = await this.runNpmInstall(cwd, npmEnv);
        if (!retryCache && result.code !== 0 && result.cacheFileMissing) {
          console.warn("npm could not read a cached package. Retrying with a fresh temporary cache...");
          retryCache = fs.mkdtempSync(path.join(os.tmpdir(), "coreza-npm-cache-"));
          npmEnv = { ...process.env };
          for (const key of Object.keys(npmEnv)) {
            if (key.toLowerCase() === "npm_config_cache") delete npmEnv[key];
          }
          npmEnv.npm_config_cache = retryCache;
          result = await this.runNpmInstall(cwd, npmEnv);
        }

        if (result.code !== 0) {
          const status = result.signal ? `signal ${result.signal}` : `exit code ${result.code}`;
          throw new Error(`Dependency installation failed for ${name} (npm ${status}). See the npm error above.`);
        }
      }
      console.log("✅ Dependencies installed successfully");
    } finally {
      if (retryCache) {
        try {
          fs.rmSync(retryCache, { recursive: true, force: true });
        } catch (error) {
          console.warn(`Could not remove temporary npm cache at ${retryCache}: ${error.message}`);
        }
      }
    }
  }

  runNpmInstall(cwd, env) {
    return new Promise((resolve, reject) => {
      const npm = spawn("npm install", {
        cwd,
        env,
        shell: true,
        stdio: ["inherit", "inherit", "pipe"],
      });

      let stderrTail = "";
      npm.stderr.setEncoding("utf8");
      npm.stderr.on("data", (chunk) => {
        process.stderr.write(chunk);
        stderrTail = (stderrTail + chunk).slice(-16384);
      });
      npm.once("error", reject);
      npm.once("close", (code, signal) => {
        const cacheFileMissing =
          /npm (?:error|ERR!) code ENOENT\b/i.test(stderrTail) &&
          /npm (?:error|ERR!) (?:path|enoent) [^\r\n]*[\\/]_cacache[\\/]/i.test(stderrTail);
        resolve({ code, signal, cacheFileMissing });
      });
    });
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
      execSync(`${SUPABASE_CLI} --version`, {
        stdio: "ignore",
        cwd: this.projectRoot,
        shell: true,
      });
    } catch {
      throw new Error("Supabase CLI 3.0.0 is unavailable. Check npm and network access.");
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
      candidates.find((c) => typeof c === "string" && c.trim().length > 0);

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
      console.log(
        `Using existing Supabase Project URL: ${this.config.supabaseUrl}`,
      );
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
      (contents.endsWith("\n") || contents.length === 0
        ? contents
        : contents + "\n") + `${entry}\n`;
    fs.writeFileSync(gitignorePath, updated);
  }

  supabaseEnv() {
    return {
      ...process.env,
      SUPABASE_ACCESS_TOKEN: this.config.supabaseAccessToken,
      SUPABASE_DB_PASSWORD: this.config.supabaseDbPassword,
    };
  }

  runOrThrow(label, command, friendlyError, cwd = this.projectRoot) {
    console.log(`\n▶  ${label}`);
    const result = spawnSync(command, {
      shell: true,
      cwd,
      env: this.supabaseEnv(),
      stdio: "inherit",
    });
    if (result.status !== 0) {
      console.error(`\n❌ ${friendlyError}`);
      throw new Error(`${label} failed`);
    }
  }

  async inspectDatabase() {
    const query = fs.readFileSync(path.join(this.projectRoot, "setup", "database-contract.sql"), "utf8");
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${this.config.projectId}/database/query/read-only`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.supabaseAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok) {
      throw new Error(`Database preflight failed (HTTP ${response.status}). Check project access; no schema changes were attempted by this check.`);
    }
    const rows = await response.json();
    const state = Array.isArray(rows) ? rows[0] : undefined;
    if (!state || !Number.isInteger(state.public_objects) || typeof state.history_present !== "boolean" || !Array.isArray(state.missing)) {
      throw new Error("Unrecognized database preflight response; refusing schema changes.");
    }
    return state;
  }

  verifyDatabaseContract(state) {
    if (state.missing.length) {
      throw new Error(`Database schema is not current: ${state.missing.join(", ")}. Follow docs/SETUP.md for an existing-project upgrade. Migration history was not repaired or rewritten.`);
    }
    this.status.schemaVerified = true;
    console.log("✅ Current database contract verified");
  }

  async runSupabaseCli() {
    console.log("\n🏗️  Configuring Supabase...");
    const template = fs.readFileSync(path.join(this.projectRoot, "supabase", "config.template.toml"), "utf8");
    const config = template.replace(/\{\{PROJECT_ID\}\}/g, this.config.projectId);
    fs.writeFileSync(path.join(this.projectRoot, "supabase", "config.toml"), config);
    this.runOrThrow(
      "Link Supabase project",
      `${SUPABASE_CLI} link --project-ref ${this.config.projectId}`,
      "Supabase project linking failed. Check project ref, access token and database password.",
    );
    this.status.linked = true;

    const state = await this.inspectDatabase();
    if (state.public_objects > 0 || state.history_present) {
      this.verifyDatabaseContract(state);
      console.log("Existing project: schema and migration history left unchanged. See docs/SETUP.md for upgrades.");
      return;
    }

    // Only an empty project receives a bootstrap. Never replay repository history
    // or retirement migrations during installation, and never mutate those files.
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "coreza-setup-"));
    try {
      const stagedSupabase = path.join(workDir, "supabase");
      const migrationsDir = path.join(stagedSupabase, "migrations");
      fs.mkdirSync(migrationsDir, { recursive: true });
      fs.writeFileSync(path.join(stagedSupabase, "config.toml"), config);
      fs.copyFileSync(
        path.join(this.projectRoot, "setup", "database-schema.sql"),
        path.join(migrationsDir, "00000000000000_coreza_initial_schema.sql"),
      );
      const beforePush = await this.inspectDatabase();
      if (beforePush.public_objects > 0 || beforePush.history_present) {
        throw new Error("Project changed during setup; refusing to apply the fresh-install schema. Rerun setup to inspect the existing project.");
      }
      this.runOrThrow(
        "Apply current fresh-install schema",
        `${SUPABASE_CLI} db push --remote=${this.config.projectId} --yes --skip-vault`,
        "Fresh schema application failed. Inspect the error and docs/SETUP.md; setup will not repair migration history or retry DDL automatically.",
        workDir,
      );
      this.status.migrated = true;
      this.verifyDatabaseContract(await this.inspectDatabase());
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
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
      { path: "setup/database-contract.sql", description: "Database contract" },
    ];

    for (const file of requiredFiles) {
      const fullPath = path.join(this.projectRoot, file.path);
      if (!fs.existsSync(fullPath)) {
        errors.push(`Missing ${file.description}: ${file.path}`);
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

    if (!this.status.schemaVerified) {
      errors.push("Current database contract has not been verified");
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
    if (this.status.migrated) console.log("  ✅ Fresh database schema applied");
    if (this.status.schemaVerified) console.log("  ✅ Current database schema verified");

    console.log("\n🚀 Next Steps:");
    console.log("1. Start the frontend: npm run dev");
    console.log("2. Start the backend: cd coreza-backend && npm run dev");
    console.log(
      "3. Start market-stream-service: cd coreza-backend/market-stream-service && npm run dev",
    );
    console.log("4. Open http://localhost:5173 to access the platform");

    console.log("\n🔐 Security Notes:");
    console.log(
      "• .env.setup.local contains your access token + DB password — keep it private (gitignored).",
    );
    console.log(
      "• SUPABASE_SECRET_KEY is in coreza-backend/.env only — never expose to frontend.",
    );
    console.log(
      "• If a secret was pasted into logs/chat, rotate it from the Supabase dashboard.",
    );
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
