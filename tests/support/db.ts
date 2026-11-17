/**
 * Test database: an in-process Postgres (PGlite) loaded with a Supabase
 * stand-in and Crate's real migrations. Tests run SQL as a given user so the
 * actual Row Level Security policies are what gets exercised.
 */
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(root, 'supabase', 'migrations');

export function migrationFiles(): string[] {
  return readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort().map((f) => join(migrationsDir, f));
}

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(root, 'tests', 'support', 'supabase-stub.sql'), 'utf8'));
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  return db;
}

export type Row = Record<string, any>;

export interface Session {
  /** Runs one statement as this user and returns the rows. */
  q: (sql: string, params?: unknown[]) => Promise<Row[]>;
  /** Runs a statement expected to fail and returns the error message. */
  fails: (sql: string, params?: unknown[]) => Promise<string>;
}

/** Creates a Supabase auth user (which creates the profile via trigger). */
export async function createUser(db: PGlite, name: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [`${name.toLowerCase()}@example.test`, JSON.stringify({ display_name: name })],
  );
  return result.rows[0]!.id;
}

/** A session that runs every statement as the given signed-in user. */
export function as(db: PGlite, userId: string | null): Session {
  const run = async (sql: string, params: unknown[] = []) =>
    db.transaction(async (tx) => {
      await tx.exec(`set local role ${userId ? 'authenticated' : 'anon'}`);
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
      return (await tx.query<Row>(sql, params)).rows;
    });
  return {
    q: run,
    fails: async (sql, params) => {
      try {
        await run(sql, params);
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error(`Expected this to fail but it succeeded: ${sql}`);
    },
  };
}
