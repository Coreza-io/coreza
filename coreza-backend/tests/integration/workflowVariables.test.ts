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
