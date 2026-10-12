import { Client } from "pg";
import { readFileSync } from "fs";
import { resolve } from "path";

// Opt-in, disposable PostgreSQL only. Never use an application/Supabase database.
const url = process.env.VARIABLES_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("PostgreSQL variable revisions and RLS", () => {
  const database = new Client({ connectionString: url });
  const owner = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  beforeAll(async () => {
    if (!new URL(url!).pathname.endsWith("_variables_test")) throw new Error("A disposable database ending _variables_test is required");
    await database.connect();
    const tables = await database.query("select count(*) from information_schema.tables where table_schema in ('public','auth')");
    if (tables.rows[0].count !== "0") throw new Error("Variable integration database must be empty");
    await database.query("BEGIN");
    await database.query(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid primary key); CREATE TABLE public.workflow_runs(id uuid primary key);
      DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END $$;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.user',true),'')::uuid $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.role',true) $$;
      GRANT USAGE ON SCHEMA auth, public TO authenticated, service_role;
      INSERT INTO auth.users VALUES ('${owner}'), ('${other}');`);
    const migration = readFileSync(resolve(__dirname, "../../../supabase/migrations/20261012080000_workflow_variables.sql"), "utf8");
    await database.query(migration); await database.query(migration);
    await database.query("select set_config('test.role','service_role',true)");
  });
  afterAll(async () => { await database.query("ROLLBACK").catch(() => undefined); await database.end(); });
  const mutate = (revision: string, operation: string, key: string, value: unknown) => database.query("select mutate_workflow_variable($1,$2,$3,$4,$5::jsonb) as result", [owner, revision, operation, key, JSON.stringify(value)]);
  const rejected = async (operation: () => Promise<unknown>) => { await database.query("SAVEPOINT rejected"); try { await expect(operation()).rejects.toThrow(); } finally { await database.query("ROLLBACK TO SAVEPOINT rejected"); } };
  test("CRUD and deletions advance one scope revision and preserve scalar types", async () => {
    expect((await mutate("0", "create", "RISK", 5)).rows[0].result.revision).toBe("1");
    await rejected(() => mutate("0", "update", "RISK", 8));
    await mutate("1", "update", "RISK", 10);
    await mutate("2", "create", "EMPTY", null);
    const snapshot = (await database.query("select workflow_variables_snapshot($1) as result", [owner])).rows[0].result;
    expect(snapshot.revision).toBe("3"); expect(snapshot.entries.map((item: any) => item.value)).toEqual([null, 10]);
    await mutate("3", "delete", "RISK", null);
    expect((await database.query("select workflow_variables_snapshot($1) as result", [owner])).rows[0].result.revision).toBe("4");
  });
  test("unsafe names and non-scalars reject without changing revision", async () => {
    await rejected(() => mutate("4", "create", "__proto__", 1));
    await rejected(() => mutate("4", "create", "OBJECT", {}));
    expect((await database.query("select workflow_variables_revision($1) as result", [owner])).rows[0].result).toBe("4");
  });
  test("RLS and security-definer RPCs isolate authenticated owners", async () => {
    await database.query("select set_config('test.role','authenticated',true),set_config('test.user',$1,true)", [other]);
    await database.query("SET LOCAL ROLE authenticated");
    expect((await database.query("select * from workflow_variables")).rows).toHaveLength(0);
    expect((await database.query("select workflow_variables_snapshot($1) as result", [owner])).rows[0].result).toBeNull();
    await rejected(() => mutate("4", "delete", "EMPTY", null));
    await rejected(() => database.query("delete from workflow_variables"));
    await database.query("RESET ROLE");
  });
});

suite("Workflow-scoped persistent Edit transactions", () => {
  const database = new Client({ connectionString: url });
  const owner = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  const workflow = "33333333-3333-4333-8333-333333333333";
  const second = "44444444-4444-4444-8444-444444444444";
  const foreign = "55555555-5555-4555-8555-555555555555";
  beforeAll(async () => {
    if (!new URL(url!).pathname.endsWith("_variables_test")) throw new Error("A disposable database ending _variables_test is required");
    await database.connect();
    const tables = await database.query("select count(*) from information_schema.tables where table_schema in ('public','auth')");
    if (tables.rows[0].count !== "0") throw new Error("Variable integration database must be empty");
    await database.query("BEGIN");
    await database.query(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid primary key); CREATE TABLE public.workflows(id uuid primary key,user_id uuid REFERENCES auth.users);
      CREATE TABLE public.workflow_runs(id uuid primary key);
      DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END $$;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.user',true),'')::uuid $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.role',true) $$;
      GRANT USAGE ON SCHEMA auth,public TO authenticated,service_role; GRANT SELECT ON workflows TO authenticated;
      INSERT INTO auth.users VALUES('${owner}'),('${other}'); INSERT INTO workflows VALUES('${workflow}','${owner}'),('${second}','${owner}'),('${foreign}','${other}');`);
    for (const name of ["20261012080000_workflow_variables.sql", "20261012100000_edit_field_workflow_variables.sql"]) {
      const migration = readFileSync(resolve(__dirname, "../../../supabase/migrations", name), "utf8");
      await database.query(migration); await database.query(migration);
    }
  });
  afterAll(async () => { await database.query("ROLLBACK").catch(() => undefined); await database.end(); });
  beforeEach(async () => { await database.query("SAVEPOINT scoped_test"); await database.query("select set_config('test.role','service_role',true),set_config('test.user',$1,true)", [owner]); });
  afterEach(async () => { await database.query("RESET ROLE"); await database.query("ROLLBACK TO SAVEPOINT scoped_test"); });
  const commit = (revision: string, token: string, changes: unknown, id = workflow, scopeOwner = owner) => database.query("select commit_workflow_variables($1,$2,$3,$4,$5::jsonb) as result", [scopeOwner, id, revision, token, JSON.stringify(changes)]);
  const load = (id = workflow, scopeOwner = owner) => database.query("select scoped_workflow_variables_snapshot($1,$2) as result", [scopeOwner, id]);
  const rejected = async (operation: () => Promise<unknown>) => { await database.query("SAVEPOINT rejected"); try { await expect(operation()).rejects.toThrow(); } finally { await database.query("ROLLBACK TO SAVEPOINT rejected"); } };
  test("atomic scalar batch overwrites 10 with zero and restart reads committed revision", async () => {
    await commit("0", "first", [{ key: "bonus", value: 10 }]);
    const saved = (await commit("1", "second", [{ key: "bonus", value: 0 }, { key: "enabled", value: false }, { key: "text", value: "" }])).rows[0].result;
    expect(saved.revision).toBe("2"); expect(saved.entries.map((entry: any) => entry.value)).toEqual([0, false, ""]);
    expect((await load()).rows[0].result.entries).toEqual(saved.entries);
  });
  test("one invalid field or duplicate rolls back every staged change", async () => {
    await rejected(() => commit("0", "invalid", [{ key: "bonus", value: 0 }, { key: "bad", value: {} }]));
    await rejected(() => commit("0", "duplicate", [{ key: "bonus", value: 0 }, { key: "bonus", value: 1 }]));
    await rejected(() => commit("0", "unsafe", [{ key: "__proto__", value: 0 }]));
    expect((await load()).rows[0].result).toMatchObject({ revision: "0", entries: [] });
    expect((await database.query("select count(*) from workflow_variable_commits")).rows[0].count).toBe("0");
  });
  test("competing writers conflict; exact replay advances revision only once", async () => {
    const changes = [{ key: "bonus", value: 0 }];
    const first = (await commit("0", "event/node/0", changes)).rows[0].result;
    expect((await commit("0", "event/node/0", changes)).rows[0].result).toEqual(first);
    await rejected(() => commit("0", "other-worker", [{ key: "bonus", value: 10 }]));
    await rejected(() => commit("1", "event/node/0", [{ key: "bonus", value: 1 }]));
    expect((await load()).rows[0].result.revision).toBe("1");
    expect((await database.query("select count(*) from workflow_variable_commits")).rows[0].count).toBe("1");
  });
  test("workflow namespaces are isolated and service-role calls still require workflow ownership", async () => {
    await commit("0", "first", [{ key: "bonus", value: 10 }]);
    await commit("0", "second", [{ key: "bonus", value: -5 }], second);
    expect((await load()).rows[0].result.entries[0].value).toBe(10);
    expect((await load(second)).rows[0].result.entries[0].value).toBe(-5);
    await rejected(() => commit("0", "foreign", [{ key: "bonus", value: 0 }], foreign));
    await rejected(() => load(foreign));
  });
  test("authenticated SQL/RPC access cannot cross owners or bypass transactional writes", async () => {
    await commit("0", "own", [{ key: "bonus", value: 0 }]);
    await database.query("select set_config('test.role','authenticated',true),set_config('test.user',$1,true)", [other]);
    await database.query("SET LOCAL ROLE authenticated");
    expect((await database.query("select * from workflow_scoped_variables")).rows).toHaveLength(0);
    await rejected(() => load());
    await rejected(() => commit("1", "foreign-auth", [{ key: "bonus", value: 2 }]));
    await rejected(() => database.query("update workflow_scoped_variables set value='1'::jsonb"));
  });
  test("unknown fields and oversized snapshots reject without revision publication", async () => {
    await rejected(() => commit("0", "unknown", [{ key: "bonus", value: 0, unexpected: true }]));
    await rejected(() => commit("0", "oversize", [{ key: "bonus", value: "x".repeat(4097) }]));
    expect((await load()).rows[0].result.revision).toBe("0");
  });
});
