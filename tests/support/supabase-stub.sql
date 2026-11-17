-- A minimal stand-in for the parts of Supabase the migrations rely on:
-- the auth schema, auth.uid(), and the anon / authenticated roles. It grants
-- no table access by default, so the tests prove that Crate's own grants
-- (migration 0006) are enough on their own. Used only by tests and the local dev backend.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
