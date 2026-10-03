import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {
  adminPgConfig,
  describeAdminPgTarget,
  ipv6UnreachableError,
  parseAdminDatabaseUrl,
  passwordRejectedError,
  toAdminPgUrl,
} from "../src/lib/server/live/adminPg.ts";

describe("admin postgres IPv4 connect", () => {
  it("strips wrapping quotes from DATABASE_URL", () => {
    assert.equal(
      parseAdminDatabaseUrl('"postgresql://u:p@127.0.0.1:5432/db"'),
      "postgresql://u:p@127.0.0.1:5432/db",
    );
  });

  it("accepts passwords with unencoded / @ and #", () => {
    const parsed = toAdminPgUrl(
      "postgresql://postgres:V/@p#ss@db.example.supabase.co:5432/postgres",
    );
    assert.equal(parsed.hostname, "db.example.supabase.co");
    assert.equal(parsed.port, "5432");
    assert.equal(parsed.username, "postgres");
    assert.equal(decodeURIComponent(parsed.password), "V/@p#ss");
    assert.doesNotThrow(() => new URL(parsed.href));
  });

  it("accepts the Supabase password shape V/@… and a pooler username", () => {
    const parsed = toAdminPgUrl(
      "postgresql://postgres.abcde:V/@tJzqEy4dG6Kk@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
    );
    assert.equal(parsed.hostname, "aws-0-eu-west-1.pooler.supabase.com");
    assert.equal(parsed.port, "5432");
    assert.equal(parsed.username, "postgres.abcde");
    assert.equal(decodeURIComponent(parsed.password), "V/@tJzqEy4dG6Kk");
    assert.doesNotThrow(() => new URL(parsed.href));
  });

  it("accepts libpq keyword/value strings with the same password", () => {
    const parsed = toAdminPgUrl(
      "host=db.example.supabase.co port=5432 dbname=postgres user=postgres password=V/@tJzqEy4dG6Kk sslmode=require",
    );
    assert.equal(parsed.hostname, "db.example.supabase.co");
    assert.equal(parsed.port, "5432");
    assert.equal(parsed.username, "postgres");
    assert.equal(decodeURIComponent(parsed.password), "V/@tJzqEy4dG6Kk");
    assert.equal(parsed.searchParams.get("sslmode"), "require");
  });

  it("rejects a pooler URL that uses user postgres without the project ref", () => {
    assert.throws(
      () =>
        toAdminPgUrl(
          "postgresql://postgres:V%2F%40secret@aws-1-eu-west-1.pooler.supabase.com:5432/postgres",
        ),
      /postgres\.<project-ref>/,
    );
  });

  it("rejects a password wrapped in the Supabase [YOUR-PASSWORD] placeholder", () => {
    assert.throws(
      () =>
        toAdminPgUrl(
          "postgresql://postgres.abcde:%5BV%2F%40secret%5D@aws-1-eu-west-1.pooler.supabase.com:5432/postgres",
        ),
      /wrapped in \[ \]/,
    );
  });

  it("describes the target without leaking the password", () => {
    const target = describeAdminPgTarget(
      "postgresql://postgres.abcde:V%2F%40secret@aws-1-eu-west-1.pooler.supabase.com:5432/postgres",
    );
    assert.equal(target.user, "postgres.abcde");
    assert.equal(target.host, "aws-1-eu-west-1.pooler.supabase.com");
    assert.equal(target.passwordLen, 9);
    assert.equal(target.slash, true);
    assert.equal(target.at, true);
    assert.equal(target.percent, false);
    assert.equal(target.brackets, false);
  });

  it("names the 28P01 failure without leaking the password", () => {
    const error = passwordRejectedError(
      "postgresql://postgres.abcde:V%2F%40secret@aws-1-eu-west-1.pooler.supabase.com:5432/postgres",
    );
    assert.match(error.message, /postgres\.abcde/);
    assert.match(error.message, /pooler\.supabase\.com/);
    assert.match(error.message, /TLSWrap/);
    assert.doesNotMatch(error.message, /secret/);
  });

  it("keeps already-encoded passwords and query params", () => {
    const parsed = toAdminPgUrl(
      "postgresql://postgres:V%2F%40secret@db.example.supabase.co:5432/postgres?sslmode=require",
    );
    assert.equal(parsed.hostname, "db.example.supabase.co");
    assert.equal(decodeURIComponent(parsed.password), "V/@secret");
    assert.equal(parsed.searchParams.get("sslmode"), "require");
  });

  it("rejects missing or non-postgres URLs without throwing Invalid URL", () => {
    assert.throws(() => toAdminPgUrl(""), /DATABASE_URL is not set/);
    assert.throws(() => toAdminPgUrl('""'), /DATABASE_URL is not set/);
    assert.throws(() => toAdminPgUrl("db.example.supabase.co"), /Percent-encode/);
    assert.throws(() => toAdminPgUrl("https://example.supabase.co"), /Percent-encode/);
  });

  it("leaves localhost and IPv4 hosts unchanged and skips SSL locally", async () => {
    const local = await adminPgConfig("postgresql://u:p@localhost:5432/db");
    assert.equal(local.connectionString, "postgresql://u:p@localhost:5432/db");
    assert.equal(local.ssl, undefined);

    const ipv4 = await adminPgConfig("postgresql://u:p@127.0.0.1:5432/db");
    assert.equal(ipv4.connectionString, "postgresql://u:p@127.0.0.1:5432/db");
    assert.equal(ipv4.ssl, undefined);
  });

  it("rewrites hosts even when the password has an unencoded slash", async () => {
    const config = await adminPgConfig(
      "postgresql://postgres:V/@secret@db.example.supabase.co:5432/postgres",
      async () => "3.4.5.6",
    );
    const rewritten = new URL(config.connectionString);
    assert.equal(rewritten.hostname, "3.4.5.6");
    assert.equal(decodeURIComponent(rewritten.password), "V/@secret");
    assert.deepEqual(config.ssl, {rejectUnauthorized: false, servername: "db.example.supabase.co"});
    assert.equal(config.host, "3.4.5.6");
    assert.equal(config.password, "V/@secret");
    assert.equal(config.user, "postgres");
  });

  it("rewrites a hostname to its A record and keeps SNI", async () => {
    const config = await adminPgConfig(
      "postgresql://user:p%40ss@db.example.supabase.co:5432/postgres?sslmode=require",
      async () => "3.4.5.6",
    );
    const rewritten = new URL(config.connectionString);
    assert.equal(rewritten.hostname, "3.4.5.6");
    assert.equal(rewritten.port, "5432");
    assert.equal(rewritten.username, "user");
    assert.equal(decodeURIComponent(rewritten.password), "p@ss");
    assert.equal(rewritten.searchParams.get("sslmode"), "require");
    assert.deepEqual(config.ssl, {rejectUnauthorized: false, servername: "db.example.supabase.co"});
  });

  it("rejects IPv6-only hosts with a pooler hint", async () => {
    await assert.rejects(
      () => adminPgConfig("postgresql://u:p@[2a05:d018::1]:5432/postgres"),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        assert.match((error as Error).message, /session pooler/);
        assert.match((error as Error).message, /2a05:d018::1/);
        return true;
      },
    );

    await assert.rejects(
      () =>
        adminPgConfig("postgresql://u:p@db.project.supabase.co:5432/postgres", async () => {
          const err = new Error("getaddrinfo ENOTFOUND") as Error & {code: string};
          err.code = "ENOTFOUND";
          throw err;
        }),
      (error: unknown) => {
        assert.match((error as Error).message, /db.project.supabase.co/);
        assert.match((error as Error).message, /pooler\.supabase\.com/);
        return true;
      },
    );
  });

  it("names the IPv6 failure the worker used to crash with", () => {
    assert.match(ipv6UnreachableError("db.project.supabase.co").message, /IPv6-only/);
  });

  it("worker and admin catalogue use the IPv4 helper", () => {
    const worker = readFileSync(join(process.cwd(), "src/worker/index.ts"), "utf8");
    const catalogue = readFileSync(
      join(process.cwd(), "src/lib/server/live/adminCatalogue.ts"),
      "utf8",
    );
    const adminPg = readFileSync(
      join(process.cwd(), "src/lib/server/live/adminPg.ts"),
      "utf8",
    );
    // The worker opens its pool through createAdminPool, which builds its
    // config with the IPv4 helper; it never hands pg a raw connection string.
    assert.match(worker, /createAdminPool\(/);
    assert.match(adminPg, /createAdminPool[\s\S]*await adminPgConfig\(\)/);
    assert.match(worker, /describeAdminPgTarget/);
    assert.match(worker, /passwordRejectedError/);
    assert.match(catalogue, /adminPgConfig/);
    assert.doesNotMatch(worker, /new pg\.(?:Client|Pool)\(\{[\s\S]*connectionString: url/);
  });
});
