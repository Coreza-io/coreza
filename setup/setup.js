#!/usr/bin/env node

const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");
const crypto = require("crypto");
const https = require("https");
const os = require("os");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

class CorezaSetup {
  constructor() {
    this.config = {};
    this.setupComplete = false;
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
      await this.setupSupabaseProject(); // init + link
      await this.deployEdgeFunctions(); // link (safe) + deploy + secrets
      await this.runDatabaseMigrations(); // link (safe) + db push
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
      // Install frontend dependencies
      console.log("Installing frontend dependencies...");
      execSync("npm install", {
        stdio: "inherit",
        cwd: this.projectRoot,
        shell: true,
      });

      // Install backend dependencies
      console.log("Installing backend dependencies...");
      execSync("npm install", {
        stdio: "inherit",
        cwd: path.join(this.projectRoot, "coreza-backend"),
        shell: true,
      });

      // Install market stream service dependencies
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
      console.log("⚠️  Manual dependency installation required");
      console.log("Please run:");
      console.log("1. npm install");
      console.log("2. cd coreza-backend && npm install");
    }
  }

  async checkPrerequisites() {
    console.log("🔍 Checking prerequisites...");

    // Check Node.js version
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

    // Ensure Supabase CLI is available via npx; install dev-dep if missing
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

      // Re-check availability
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
    if (!fs.existsSync(filePath)) {
      return {};
    }

    const env = {};
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex === -1) {
        continue;
      }

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
    if (this.loadedExistingCredentials) {
      return;
    }

    const frontendEnv = this.parseEnvFile(path.join(this.projectRoot, ".env"));
    const backendEnv = this.parseEnvFile(
      path.join(this.projectRoot, "coreza-backend", ".env"),
    );

    const pickValue = (...candidates) =>
      candidates.find(
        (candidate) =>
          typeof candidate === "string" && candidate.trim().length > 0,
      );

    this.config.supabaseUrl =
      this.config.supabaseUrl ||
      pickValue(
        backendEnv.SUPABASE_URL,
        frontendEnv.VITE_SUPABASE_URL,
        process.env.SUPABASE_URL,
      );

    this.config.supabasePublishableKey =
      this.config.supabasePublishableKey ||
      pickValue(
        backendEnv.SUPABASE_PUBLISHABLE_KEY,
        backendEnv.SUPABASE_ANON_KEY,
        frontendEnv.VITE_SUPABASE_PUBLISHABLE_KEY,
        process.env.SUPABASE_PUBLISHABLE_KEY,
        process.env.SUPABASE_ANON_KEY,
      );

    this.config.supabaseSecretKey =
      this.config.supabaseSecretKey ||
      pickValue(
        backendEnv.SUPABASE_SECRET_KEY,
        backendEnv.SUPABASE_SERVICE_ROLE_KEY,
        process.env.SUPABASE_SECRET_KEY,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      );

    this.config.supabaseAccessToken =
      this.config.supabaseAccessToken ||
      pickValue(
        backendEnv.SUPABASE_ACCESS_TOKEN,
        process.env.SUPABASE_ACCESS_TOKEN,
      );

    this.config.supabaseDbPassword =
      this.config.supabaseDbPassword ||
      pickValue(
        backendEnv.SUPABASE_DB_PASSWORD,
        process.env.SUPABASE_DB_PASSWORD,
      );

    this.config.projectId =
      this.config.projectId ||
      pickValue(
        frontendEnv.VITE_SUPABASE_PROJECT_ID,
        process.env.SUPABASE_PROJECT_ID,
      );
    this.config.encryptionKey =
      this.config.encryptionKey ||
      pickValue(
        backendEnv.COREZA_ENCRYPTION_KEY,
        process.env.COREZA_ENCRYPTION_KEY,
      );

    this.loadedExistingCredentials = true;
  }
  async collectSupabaseCredentials() {
    console.log("\n🔑 Supabase Configuration");
    console.log("Please provide your Supabase project credentials:");
    console.log("(You can find these in your Supabase project settings)\n");

    this.loadExistingCredentials();

    if (this.config.supabaseUrl) {
      console.log(
        "Using existing Supabase Project URL from environment files.",
      );
    } else {
      this.config.supabaseUrl = (
        await question("Supabase Project URL: ")
      ).trim();
    }

    if (this.config.supabasePublishableKey) {
      console.log("Using existing Supabase Publishable Key (sb_publishable_…) from environment files.");
    } else {
      this.config.supabasePublishableKey = (
        await question("Supabase Publishable Key (sb_publishable_…): ")
      ).trim();
    }

    if (this.config.supabaseSecretKey) {
      console.log(
        "Using existing Supabase Secret Key (sb_secret_…) from environment files.",
      );
    } else {
      this.config.supabaseSecretKey = (
        await question("Supabase Secret Key (sb_secret_…): ")
      ).trim();
    }

    // if (this.config.supabaseAccessToken) {
    //   console.log(
    //     "Using existing Supabase Personal Access Token from environment files.",
    //   );
    // } else {
    //   this.config.supabaseAccessToken = (
    //     await question("Supabase Personal Access Token: ")
    //   ).trim();
    // }

    // if (this.config.supabaseDbPassword) {
    //   console.log(
    //     "Using existing Supabase database password from environment files.",
    //   );
    // } else {
    //   this.config.supabaseDbPassword = (
    //     await question("Supabase database password: ")
    //   ).trim();
    // }

    this.config.projectId = this.extractProjectId(this.config.supabaseUrl);
    if (!this.config.projectId) {
      throw new Error("Invalid Supabase URL format");
    }

    // Validate credential formats
    this.validateCredentials();

    console.log(`✅ Project ID extracted: ${this.config.projectId}`);
  }

  validateCredentials() {
    if (
      !this.config.supabaseUrl.startsWith("https://") ||
      !this.config.supabaseUrl.includes(".supabase.co")
    ) {
      throw new Error(
        "Invalid Supabase URL format. Should be https://your-project.supabase.co",
      );
    }

    const isPublishable = this.config.supabasePublishableKey.startsWith("sb_publishable_");
    const isLegacyPublishable = this.config.supabasePublishableKey.startsWith("eyJ");
    if (!isPublishable && !isLegacyPublishable) {
      throw new Error('Invalid Supabase Publishable Key format. Expected prefix sb_publishable_ (legacy eyJ accepted temporarily).');
    }
    if (isLegacyPublishable) {
      console.warn('⚠️ Legacy anon JWT key detected for publishable key. Please migrate to sb_publishable_ format.');
    }

    const isSecret = this.config.supabaseSecretKey.startsWith("sb_secret_");
    const isLegacySecret = this.config.supabaseSecretKey.startsWith("eyJ");
    if (!isSecret && !isLegacySecret) {
      throw new Error('Invalid Supabase Secret Key format. Expected prefix sb_secret_ (legacy eyJ accepted temporarily).');
    }
    if (isLegacySecret) {
      console.warn('⚠️ Legacy service role JWT key detected. Please migrate to sb_secret_ format.');
    }

    // NEW: require personal access token
    // if (!this.config.supabaseAccessToken) {
    //   throw new Error("Supabase Personal Access Token is required");
    // }

    // if (!this.config.supabaseDbPassword) {
    //   throw new Error("Supabase database password is required");
    // }
  }

  extractProjectId(url) {
    const match = url.match(/https:\/\/([a-zA-Z0-9]+)\.supabase\.co/);
    return match ? match[1] : null;
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

    // Frontend .env
    const frontendEnv = `# ="== React App Config ==="
VITE_API_URL="http://localhost:8000"
VITE_SUPABASE_PROJECT_ID="${this.config.projectId}"
VITE_SUPABASE_PUBLISHABLE_KEY="${this.config.supabasePublishableKey}"
VITE_SUPABASE_URL="${this.config.supabaseUrl}"
`;

    // Backend .env
    const backendEnv = `# Supabase Configuration
SUPABASE_URL=${this.config.supabaseUrl}
SUPABASE_PUBLISHABLE_KEY=${this.config.supabasePublishableKey}
SUPABASE_SECRET_KEY=${this.config.supabaseSecretKey}
SUPABASE_ACCESS_TOKEN=${this.config.supabaseAccessToken}
SUPABASE_DB_PASSWORD=${this.config.supabaseDbPassword}

# Encryption Configuration
COREZA_ENCRYPTION_KEY=${this.config.encryptionKey}
REDIS_QUEUE_URL=redis://localhost:6379
PORT=8000
WEBSOCKET_PORT=8081
MARKET_STREAM_PORT=8090
WORKFLOW_JOB_ATTEMPTS=0
BACKTEST_EXECUTION_MODE=auto
ALPACA_REDIRECT_URI=http://localhost:8000/api/oauth/alpaca/callback
BINANCE_REDIRECT_URI=http://localhost:8000/api/oauth/binance/callback
SCHWAB_REDIRECT_URI=http://localhost:8000/api/oauth/schwab/callback
`;

    fs.writeFileSync(path.join(this.projectRoot, ".env"), frontendEnv);
    fs.writeFileSync(
      path.join(this.projectRoot, "coreza-backend", ".env"),
      backendEnv,
    );

    const streamEnv = `SUPABASE_URL=${this.config.supabaseUrl}
SUPABASE_SECRET_KEY=${this.config.supabaseSecretKey}
COREZA_ENCRYPTION_KEY=${this.config.encryptionKey}
REDIS_QUEUE_URL=redis://localhost:6379
MARKET_STREAM_PORT=8090
`;
    fs.writeFileSync(
      path.join(
        this.projectRoot,
        "coreza-backend",
        "market-stream-service",
        ".env",
      ),
      streamEnv,
    );

    console.log("✅ Environment files created");
  }

  // Helper: env with access token for Supabase CLI
  supabaseEnv() {
    return {
      ...process.env,
      SUPABASE_ACCESS_TOKEN: this.config.supabaseAccessToken,
    };
  }

  async setupSupabaseProject() {
    console.log("\n🏗️  Setting up Supabase project...");

    try {
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

      // Link to your remote project so db push/deploy knows the project ref
      execSync(`npx supabase link --project-ref ${this.config.projectId}`, {
        stdio: "inherit",
        cwd: this.projectRoot,
        shell: true,
        env: this.supabaseEnv(),
      });

      console.log("✅ Supabase initialized and linked");
    } catch (err) {
      console.log("⚠️  Could not initialize/link automatically.");
      console.log(`   Try: npx supabase init --force`);
      console.log(
        `        npx supabase link --project-ref ${this.config.projectId}`,
      );
    }
  }

  async deployEdgeFunctions() {
    console.log("\n? Deploying edge functions...");

    try {
      // Ensure linked (safe if already linked)
      execSync(`npx supabase link --project-ref ${this.config.projectId}`, {
        stdio: "inherit",
        cwd: this.projectRoot,
        shell: true,
        env: this.supabaseEnv(),
      });

      // Deploy functions
      execSync("npx supabase functions deploy", {
        stdio: "inherit",
        cwd: this.projectRoot,
        shell: true,
        env: this.supabaseEnv(),
      });

      // Set secrets
      execSync(
        `npx supabase secrets set COREZA_ENCRYPTION_KEY="${this.config.encryptionKey}"`,
        {
          stdio: "inherit",
          cwd: this.projectRoot,
          shell: true,
          env: this.supabaseEnv(),
        },
      );

      console.log("✅ Edge functions deployed and secrets configured");
    } catch (error) {
      console.log("??  Manual setup required for edge functions");
      console.log("Please run the following commands manually:");
      console.log(`npx supabase link --project-ref ${this.config.projectId}`);
      console.log("npx supabase functions deploy");
      console.log(
        `npx supabase secrets set COREZA_ENCRYPTION_KEY="${this.config.encryptionKey}"`,
      );
    }
  }

  runSupabaseDbPush({ directDbUrl } = {}) {
    const command = directDbUrl
      ? `npx supabase db push --db-url "${directDbUrl}"`
      : "npx supabase db push";

    const result = spawnSync(command, {
      shell: true,
      cwd: this.projectRoot,
      env: this.supabaseEnv(),
      encoding: "utf8",
      input: "Y\n",
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }

    const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();

    return {
      success: result.status === 0,
      output,
    };
  }

  async handleMigrationPushError(commandOutput) {
    if (!commandOutput) {
      return false;
    }

    if (
      commandOutput.includes(
        "Remote migration versions not found in local migrations directory",
      )
    ) {
      const versionMatch = commandOutput.match(
        /supabase migration repair --status reverted (\d+)/,
      );
      const version = versionMatch ? versionMatch[1] : null;

      if (!version) {
        return false;
      }

      try {
        console.log(`?? Repairing migration history for version ${version}...`);
        const repairResult = spawnSync(
          `npx supabase migration repair --status reverted ${version}`,
          {
            shell: true,
            cwd: this.projectRoot,
            env: this.supabaseEnv(),
            encoding: "utf8",
            stdio: "inherit",
            maxBuffer: 10 * 1024 * 1024,
          },
        );

        if (repairResult.status !== 0) {
          console.log(
            "? Migration repair command failed. Please run it manually.",
          );
          return false;
        }
      } catch (repairError) {
        console.log("? Automatic repair failed:", repairError.message);
        return false;
      }

      this.removeLocalMigrationVersion(version);

      const retry = this.runSupabaseDbPush();
      if (retry.success) {
        console.log("? Migration applied successfully after repair.");
        return true;
      }

      console.log("? Retry after repair failed. Output:");
      console.log(retry.output);
      return false;
    }

    return false;
  }

  removeLocalMigrationVersion(version) {
    try {
      const migrationsDir = path.join(
        this.projectRoot,
        "supabase",
        "migrations",
      );
      if (!fs.existsSync(migrationsDir)) {
        return;
      }

      const files = fs.readdirSync(migrationsDir);
      for (const file of files) {
        if (file.startsWith(version)) {
          try {
            fs.unlinkSync(path.join(migrationsDir, file));
            console.log(`Removed local migration after repair: ${file}`);
          } catch (removeError) {
            console.log(
              `Could not remove local migration ${file}: ${removeError.message}`,
            );
          }
        }
      }
    } catch (cleanupError) {
      console.log(
        `Encountered an issue while cleaning up local migrations: ${cleanupError.message}`,
      );
    }
  }

  async runDatabaseMigrations() {
    console.log("\n🗄️  Setting up database...");

    try {
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

      console.log("Creating database migration...");

      // Ensure migrations directory exists
      const migrationsDir = path.join(
        this.projectRoot,
        "supabase",
        "migrations",
      );
      if (!fs.existsSync(migrationsDir)) {
        fs.mkdirSync(migrationsDir, { recursive: true });
      }

      const schemaContent = fs.readFileSync(schemaPath, "utf8");
      const migrationFiles = fs
        .readdirSync(migrationsDir)
        .filter((file) => file.endsWith(".sql"))
        .sort();
      const latestMigration = migrationFiles[migrationFiles.length - 1];

      let shouldCreateMigration = true;
      if (latestMigration) {
        const latestContent = fs.readFileSync(
          path.join(migrationsDir, latestMigration),
          "utf8",
        );
        if (latestContent.trim() === schemaContent.trim()) {
          shouldCreateMigration = false;
          console.log(
            `✅ Latest migration (${latestMigration}) already matches setup/database-schema.sql; skipping migration file creation.`,
          );
        }
      }

      if (shouldCreateMigration) {
        const timestamp = new Date()
          .toISOString()
          .replace(/[-:T]/g, "")
          .slice(0, 14);
        const migrationPath = path.join(
          migrationsDir,
          `${timestamp}_coreza_schema_setup.sql`,
        );
        fs.writeFileSync(migrationPath, schemaContent);
        console.log(`✅ Migration created: ${path.basename(migrationPath)}`);
      }
      // Ensure CLI reachable (already checked earlier, but re-ensure)
      try {
        execSync("npx supabase --version", {
          stdio: "ignore",
          cwd: this.projectRoot,
          shell: true,
          env: this.supabaseEnv(),
        });
      } catch {
        console.log("📦 Installing Supabase CLI (dev dependency)...");
        execSync("npm install -D supabase", {
          stdio: "inherit",
          cwd: this.projectRoot,
          shell: true,
        });
      }

      // Ensure project is linked before pushing
      try {
        execSync(`npx supabase link --project-ref ${this.config.projectId}`, {
          stdio: "inherit",
          cwd: this.projectRoot,
          shell: true,
          env: this.supabaseEnv(),
        });
      } catch {
        // If already linked or pushing to local, proceed
      }

      // Apply the migration
      console.log("Applying database migration...");
      try {
        execSync("npx supabase db push", {
          stdio: "inherit",
          cwd: this.projectRoot,
          shell: true,
          env: this.supabaseEnv(),
        });
        console.log("✅ Database migration applied successfully");
      } catch (pushError) {
        console.log("??  Migration push failed. Trying alternative method...");

        const repaired = await this.handleMigrationPushError(
          pushError.stderr || pushError.stdout || pushError.message || "",
        );
        if (repaired) {
          return;
        }

        try {
          if (!this.config.supabaseDbPassword) {
            this.config.supabaseDbPassword = (
              await question("Supabase DB Password (postgres role): ")
            ).trim();
          }

          if (!this.config.supabaseDbPassword) {
            throw new Error(
              "Supabase database password is required for direct push",
            );
          }

          const encodedPassword = encodeURIComponent(
            this.config.supabaseDbPassword,
          );
          const directDbUrl = `postgresql://postgres:${encodedPassword}@db.${this.config.projectId}.supabase.co:5432/postgres?sslmode=require`;

          console.log(
            "Attempting direct database push using db.<project>.supabase.co...",
          );
          execSync(`npx supabase db push --db-url "${directDbUrl}"`, {
            stdio: "inherit",
            cwd: this.projectRoot,
            shell: true,
            env: this.supabaseEnv(),
          });
          console.log("? Direct database migration applied successfully");
          return;
        } catch (directError) {
          console.log("??  Direct push attempt failed:", directError.message);
        }

        console.log("Please run the following commands manually:");
        console.log(
          "1. npx supabase link --project-ref " + this.config.projectId,
        );
        console.log("2. npx supabase db push");
        console.log("3. Or apply the schema manually in Supabase SQL Editor");
      }
    } catch (error) {
      console.log("⚠️  Database setup encountered an issue:", error.message);
      console.log("\nManual setup options:");
      console.log("1. Run: npx supabase db push");
      console.log(
        "2. Or copy contents of setup/database-schema.sql to Supabase SQL Editor",
      );
      console.log("3. Or use the migration tool in Supabase dashboard");
    }
  }

  async validateSetup() {
    console.log("\n🔍 Validating setup...");

    const errors = [];
    const warnings = [];

    // Check if required files exist
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

    // Check if edge functions exist
    const requiredFunctions = [
      {
        name: "derive-encryption-key",
        description: "Encryption key derivation function",
      },
      { name: "http-request", description: "HTTP request proxy function" },
    ];

    for (const func of requiredFunctions) {
      const funcPath = path.join(
        this.projectRoot,
        "supabase",
        "functions",
        func.name,
        "index.ts",
      );
      if (!fs.existsSync(funcPath)) {
        warnings.push(
          `Edge function missing: ${func.description} (${func.name})`,
        );
      }
    }

    // Validate environment files have required variables
    if (fs.existsSync(path.join(this.projectRoot, ".env"))) {
      const frontendEnv = fs.readFileSync(
        path.join(this.projectRoot, ".env"),
        "utf8",
      );
      const requiredFrontendVars = [
        "VITE_SUPABASE_URL",
        "VITE_SUPABASE_PUBLISHABLE_KEY",
        "VITE_SUPABASE_PROJECT_ID",
      ];

      for (const varName of requiredFrontendVars) {
        if (!frontendEnv.includes(`${varName}=`)) {
          errors.push(`Missing frontend environment variable: ${varName}`);
        }
      }
    }

    if (fs.existsSync(path.join(this.projectRoot, "coreza-backend", ".env"))) {
      const backendEnv = fs.readFileSync(
        path.join(this.projectRoot, "coreza-backend", ".env"),
        "utf8",
      );
      const requiredBackendVars = [
        "SUPABASE_URL",
        "SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_SECRET_KEY",
        "COREZA_ENCRYPTION_KEY",
        "SUPABASE_ACCESS_TOKEN",
        "SUPABASE_DB_PASSWORD",
      ];

      for (const varName of requiredBackendVars) {
        if (!backendEnv.includes(`${varName}=`)) {
          errors.push(`Missing backend environment variable: ${varName}`);
        }
      }
    }

    // Check migrations directory
    const migrationsDir = path.join(this.projectRoot, "supabase", "migrations");
    if (fs.existsSync(migrationsDir)) {
      const migrations = fs
        .readdirSync(migrationsDir)
        .filter((file) => file.endsWith(".sql")).length;

      if (migrations === 0) {
        warnings.push(
          "No database migrations found - database may not be set up",
        );
      } else {
        console.log(`✅ Found ${migrations} database migration(s)`);
      }
    } else {
      warnings.push(
        "Migrations directory not found - database setup may be incomplete",
      );
    }

    // Report results
    if (errors.length > 0) {
      console.log("\n❌ Setup validation failed:");
      errors.forEach((error) => console.log(`  • ${error}`));
      throw new Error("Setup validation failed - please fix the errors above");
    }

    if (warnings.length > 0) {
      console.log("\n⚠️  Setup warnings:");
      warnings.forEach((warning) => console.log(`  • ${warning}`));
    }

    console.log("\n✅ Setup validation passed");

    if (warnings.length === 0) {
      console.log("🎯 All components are properly configured!");
    }
  }

  async showCompletionMessage() {
    console.log("\n🎉 Coreza Trading Platform Setup Complete!");
    console.log("=========================================");
    console.log("\n📋 Setup Summary:");
    console.log("  ✅ Dependencies installed");
    console.log("  ✅ Environment files configured");
    console.log("  ✅ Supabase project linked");
    console.log("  ✅ Database schema prepared");
    console.log("  ✅ Edge functions ready");
    console.log("  ✅ Configuration validated");

    console.log("\n🚀 Next Steps:");
    console.log("1. Start the frontend: npm run dev");
    console.log("2. Start the backend: cd coreza-backend && npm run dev");
    console.log(
      "3. Start market-stream-service: cd coreza-backend/market-stream-service && npm run dev",
    );
    console.log("4. Open http://localhost:5173 to access the platform");

    console.log("\n📚 Documentation:");
    console.log("• Setup guide: docs/SETUP.md");
    console.log("• Security info: docs/SECURITY.md");
    console.log("• Deployment: docs/DEPLOYMENT.md");

    console.log("\n🔐 Security Notes:");
    console.log(
      "• Environment files contain sensitive data - keep them private",
    );
    console.log("• Your encryption key has been securely generated");
    console.log("• Review RLS policies before deploying to production");

    console.log("\n💡 Troubleshooting:");
    console.log("• If database tables are missing, run: npx supabase db push");
    console.log(
      "• For edge function issues, run: npx supabase functions deploy",
    );
    console.log("• Check docs/TROUBLESHOOTING.md for common issues");

    console.log("\n🎯 Ready to build your trading algorithms!");
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
        return; // stop here if start was successful
      } catch (err) {
        console.log(
          "⚠️ Failed to start Redis automatically. Please start two instances manually on ports 6379.",
        );
        return;
      }
    }

    // Only prints if not installed
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
    console.log("🚀 Starting Redis queue/cache instances in background...");
    this.startRedis(binaryPath, 6379);
    console.log("✅ Redis instances started on ports 6379");
  }

  startRedis(binaryPath, port) {
    console.log(`Starting Redis on port ${port}...`);

    const { spawn } = require("child_process");

    const redis = spawn(binaryPath, ["--port", String(port)], {
      detached: true,
      stdio: "ignore", // don’t keep logs open
      shell: true,
    });

    redis.unref(); // allow parent (setup) to exit independently

    console.log(`✅ Redis server started on port ${port} (detached)`);
  }
} // <-- closes the class properly!

// Run setup if called directly
if (require.main === module) {
  const setup = new CorezaSetup();
  setup.run();
}

module.exports = CorezaSetup;
