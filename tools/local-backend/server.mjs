#!/usr/bin/env node
/**
 * Local stand-in for Supabase, for development and end-to-end tests only.
 *
 * It runs Crate's real migrations in an in-process Postgres (PGlite) and
 * answers the small part of the Supabase HTTP API that the app uses:
 *   /auth/v1/*   email + password sign-up and sign-in (no email is sent)
 *   /rest/v1/*   table reads and writes with simple filters, and /rpc/ calls
 * Every request runs as the signed-in user, so the real Row Level Security
 * policies apply.
 *
 * It is NOT Supabase. Passwords are kept in memory in plain text, tokens are
 * not signed, and only the query features Crate uses are supported. Never
 * expose it to a network or use it for real data.
 *
 *   node tools/local-backend/server.mjs            (data is lost on exit)
 *   CRATE_LOCAL_DATA=.local-data node tools/...    (data kept in a folder)
 */
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = Number(process.env.PORT ?? 54321);
const dataDir = process.env.CRATE_LOCAL_DATA;

const db = dataDir ? new PGlite(dataDir) : new PGlite();
const fresh = (await db.query(`select 1 from pg_roles where rolname = 'authenticated'`)).rows.length === 0;
if (fresh) {
  await db.exec(readFileSync(join(root, 'tests', 'support', 'supabase-stub.sql'), 'utf8'));
  await db.exec(`create table auth.local_passwords (user_id uuid primary key, password text not null)`);
  const dir = join(root, 'supabase', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, file), 'utf8'));
  }
}

// ----------------------------------------------------------------- helpers
const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (name) => {
  if (!IDENT.test(name)) throw httpError(400, `Bad identifier: ${name}`);
  return `"${name}"`;
};
const httpError = (status, message, code = 'LOCAL') => Object.assign(new Error(message), { status, code });
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function makeSession(user) {
  const now = Math.floor(Date.now() / 1000);
  const expires_in = 60 * 60 * 24 * 7;
  const payload = { sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + expires_in };
  return {
    access_token: `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.local`,
    token_type: 'bearer',
    expires_in,
    expires_at: now + expires_in,
    refresh_token: `local-${user.id}`,
    user: publicUser(user),
  };
}
const publicUser = (user) => ({
  id: user.id,
  aud: 'authenticated',
  role: 'authenticated',
  email: user.email,
  email_confirmed_at: user.created_at,
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: user.raw_user_meta_data ?? {},
  identities: [],
  created_at: user.created_at,
  updated_at: user.created_at,
});

function userIdFrom(req) {
  const header = req.headers.authorization ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload.role === 'authenticated' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : null;
}

/** Runs SQL as the request's user so Row Level Security applies. */
async function asUser(userId, sql, params) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${userId ? 'authenticated' : 'anon'}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
    return tx.query(sql, params);
  });
}

// -------------------------------------------------------------------- auth
async function handleAuth(req, url, body) {
  const path = url.pathname.replace('/auth/v1', '');
  if (path === '/signup' && req.method === 'POST') {
    const email = String(body?.email ?? '').trim().toLowerCase();
    const password = String(body?.password ?? '');
    if (!email.includes('@')) throw httpError(422, 'Unable to validate email address: invalid format', 'validation_failed');
    if (password.length < 6) throw httpError(422, 'Password should be at least 6 characters.', 'weak_password');
    const existing = await db.query(`select 1 from auth.users where email = $1`, [email]);
    if (existing.rows.length) throw httpError(422, 'User already registered', 'user_already_exists');
    const created = await db.query(
      `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning *`,
      [email, JSON.stringify(body?.data ?? {})],
    );
    await db.query(`insert into auth.local_passwords values ($1, $2)`, [created.rows[0].id, password]);
    return makeSession(created.rows[0]);
  }
  if (path === '/token' && req.method === 'POST') {
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password') {
      const found = await db.query(
        `select u.* from auth.users u join auth.local_passwords p on p.user_id = u.id where u.email = $1 and p.password = $2`,
        [String(body?.email ?? '').trim().toLowerCase(), String(body?.password ?? '')],
      );
      if (!found.rows.length) throw httpError(400, 'Invalid login credentials', 'invalid_credentials');
      return makeSession(found.rows[0]);
    }
    if (grant === 'refresh_token') {
      const id = String(body?.refresh_token ?? '').replace(/^local-/, '');
      const found = await db.query(`select * from auth.users where id::text = $1`, [id]);
      if (!found.rows.length) throw httpError(400, 'Invalid Refresh Token', 'refresh_token_not_found');
      return makeSession(found.rows[0]);
    }
  }
  if (path === '/user' && req.method === 'GET') {
    const found = await db.query(`select * from auth.users where id::text = $1`, [userIdFrom(req) ?? '']);
    if (!found.rows.length) throw httpError(401, 'Invalid JWT', 'bad_jwt');
    return publicUser(found.rows[0]);
  }
  if (path === '/logout') return undefined;
  throw httpError(404, `Local backend does not support ${req.method} ${url.pathname}`);
}

// -------------------------------------------------------------------- rest
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };

function buildWhere(url, params) {
  const clauses = [];
  for (const [key, raw] of url.searchParams) {
    if (RESERVED.has(key)) continue;
    const column = ident(key);
    let value = raw;
    let negate = false;
    if (value.startsWith('not.')) {
      negate = true;
      value = value.slice(4);
    }
    const dot = value.indexOf('.');
    const op = dot === -1 ? value : value.slice(0, dot);
    const operand = dot === -1 ? '' : value.slice(dot + 1);
    let clause;
    if (op === 'is') {
      if (!['null', 'true', 'false'].includes(operand)) throw httpError(400, `Unsupported is.${operand}`);
      clause = `${column} is ${operand}`;
    } else if (op === 'in') {
      const list = operand.replace(/^\(|\)$/g, '').split(',').filter(Boolean).map((v) => v.replace(/^"|"$/g, ''));
      params.push(list);
      clause = `${column}::text = any($${params.length}::text[])`;
    } else if (OPS[op]) {
      params.push(operand);
      clause = `${column} ${OPS[op]} $${params.length}`;
    } else {
      throw httpError(400, `Local backend does not support filter "${raw}"`);
    }
    clauses.push(negate ? `not (${clause})` : clause);
  }
  return clauses.length ? ` where ${clauses.join(' and ')}` : '';
}

function buildOrder(url) {
  const order = url.searchParams.get('order');
  if (!order) return '';
  const parts = order.split(',').map((part) => {
    const [column, ...flags] = part.split('.');
    const direction = flags.includes('desc') ? 'desc' : 'asc';
    const nulls = flags.includes('nullsfirst') ? ' nulls first' : flags.includes('nullslast') ? ' nulls last' : '';
    return `${ident(column)} ${direction}${nulls}`;
  });
  return ` order by ${parts.join(', ')}`;
}

function buildColumns(url) {
  const select = url.searchParams.get('select');
  if (!select || select === '*') return '*';
  return select.split(',').map((c) => ident(c.trim())).join(', ');
}

async function handleRest(req, url, body) {
  const userId = userIdFrom(req);
  const path = url.pathname.replace('/rest/v1/', '');
  const prefer = String(req.headers.prefer ?? '');
  const wantsObject = String(req.headers.accept ?? '').includes('vnd.pgrst.object');
  const wantsRows = prefer.includes('return=representation');

  if (path.startsWith('rpc/')) {
    const fn = ident(path.slice(4));
    const args = body ?? {};
    const names = Object.keys(args);
    const params = names.map((n) => (args[n] !== null && typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n]));
    const call = names.map((n, i) => `${ident(n)} => $${i + 1}`).join(', ');
    const result = await asUser(userId, `select to_json(public.${fn}(${call})) as j`, params);
    return { status: 200, json: result.rows[0].j };
  }

  const table = `public.${ident(path)}`;
  const params = [];
  let sql;
  let status = 200;

  if (req.method === 'GET') {
    const where = buildWhere(url, params);
    const limit = url.searchParams.get('limit');
    sql = `select ${buildColumns(url)} from ${table}${where}${buildOrder(url)}${limit ? ` limit ${Number(limit)}` : ''}`;
    sql = `select coalesce(json_agg(r), '[]'::json) as j from (${sql}) r`;
  } else if (req.method === 'POST') {
    const rows = Array.isArray(body) ? body : [body];
    if (!rows.length) return { status: 201, json: [] };
    const columns = Object.keys(rows[0]).map(ident);
    params.push(JSON.stringify(rows));
    let conflict = '';
    const onConflict = url.searchParams.get('on_conflict');
    if (prefer.includes('resolution=merge-duplicates') && onConflict) {
      const keys = onConflict.split(',').map((c) => ident(c.trim()));
      const updates = columns.filter((c) => !keys.includes(c)).map((c) => `${c} = excluded.${c}`);
      conflict = ` on conflict (${keys.join(', ')}) do ${updates.length ? `update set ${updates.join(', ')}` : 'nothing'}`;
    } else if (prefer.includes('resolution=ignore-duplicates')) {
      conflict = ' on conflict do nothing';
    }
    sql = `insert into ${table} (${columns.join(', ')}) select ${columns.join(', ')} from jsonb_populate_recordset(null::${table}, $1::jsonb)${conflict}`;
    status = 201;
  } else if (req.method === 'PATCH') {
    const columns = Object.keys(body ?? {}).map(ident);
    if (!columns.length) throw httpError(400, 'Nothing to update');
    params.push(JSON.stringify(body));
    const sets = columns.map((c) => `${c} = (select ${c} from jsonb_populate_record(null::${table}, $1::jsonb))`);
    sql = `update ${table} set ${sets.join(', ')}${buildWhere(url, params)}`;
  } else if (req.method === 'DELETE') {
    sql = `delete from ${table}${buildWhere(url, params)}`;
  } else {
    throw httpError(405, 'Method not allowed');
  }

  if (req.method !== 'GET') {
    if (!wantsRows) {
      await asUser(userId, sql, params);
      return { status: status === 201 ? 201 : 204, json: undefined };
    }
    sql = `with changed as (${sql} returning *) select coalesce(json_agg(changed), '[]'::json) as j from changed`;
  }

  const result = await asUser(userId, sql, params);
  const rows = result.rows[0].j;
  if (wantsObject) {
    if (rows.length !== 1) {
      throw Object.assign(httpError(406, 'JSON object requested, multiple (or no) rows returned', 'PGRST116'), {
        details: `The result contains ${rows.length} rows`,
      });
    }
    return { status, json: rows[0] };
  }
  return { status, json: rows };
}

// ------------------------------------------------------------------ server
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-expose-headers': 'content-range',
};

const server = http.createServer(async (req, res) => {
  const send = (status, json) => {
    res.writeHead(status, { ...cors, 'content-type': 'application/json' });
    res.end(json === undefined ? '' : JSON.stringify(json));
  };
  if (req.method === 'OPTIONS') return send(204);
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : null;
    if (url.pathname.startsWith('/auth/v1/')) return send(200, await handleAuth(req, url, body));
    if (url.pathname.startsWith('/rest/v1/')) {
      const { status, json } = await handleRest(req, url, body);
      return send(status, json);
    }
    return send(404, { message: 'Not found' });
  } catch (error) {
    // Postgres errors carry a five character SQLSTATE in `code`.
    const pg = typeof error.code === 'string' && error.code.length === 5;
    const status = error.status ?? (error.code === '42501' ? 403 : error.code === '23505' ? 409 : 400);
    if (process.env.CRATE_LOCAL_DEBUG) console.error(`${req.method} ${req.url} -> ${status}: ${error.message}`);
    send(status, {
      code: pg ? error.code : (error.code ?? 'LOCAL'),
      message: error.message,
      msg: error.message,
      error_code: error.code,
      details: error.detail ?? error.details ?? null,
      hint: error.hint ?? null,
    });
  }
});

server.listen(port, () => {
  console.log(`Crate local backend on http://localhost:${port} (${dataDir ? `data in ${dataDir}` : 'in-memory, data is lost on exit'})`);
});
