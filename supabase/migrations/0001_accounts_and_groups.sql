-- Crate migration 0001: accounts and family groups.
--
-- Every table has Row Level Security on. The helper functions below are
-- SECURITY DEFINER so policies can ask "do these two people share a group?"
-- without recursing into the group tables' own policies.

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Creates a profile whenever someone signs up.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), 'Someone'), 40)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------ groups
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  join_code text not null unique,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.groups enable row level security;

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
alter table public.group_members enable row level security;

-- First version: one family group per person. Drop this index to allow more
-- (for example when friends groups arrive).
create unique index group_members_one_group_per_user on public.group_members (user_id);

-- ----------------------------------------------------------------- helpers
create function public.is_group_member(p_group uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group and user_id = auth.uid()
  );
$$;

-- True for yourself and for anyone in a group with you.
create function public.shares_group_with(p_other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    p_other = auth.uid()
    or exists (
      select 1
      from public.group_members me
      join public.group_members them on them.group_id = me.group_id
      where me.user_id = auth.uid() and them.user_id = p_other
    )
  );
$$;

-- ---------------------------------------------------------------- policies
create policy "profiles: read yourself and your group" on public.profiles
  for select to authenticated using (public.shares_group_with(id));
create policy "profiles: update yourself" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "groups: members read" on public.groups
  for select to authenticated using (public.is_group_member(id));

create policy "group_members: members read" on public.group_members
  for select to authenticated using (public.is_group_member(group_id));

-- Groups are created, joined and left only through the functions below.

-- ------------------------------------------------------------------- RPCs
create function public.generate_join_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O or 1/I
  code text;
begin
  loop
    select string_agg(substr(alphabet, 1 + floor(random() * 32)::int, 1), '')
      into code from generate_series(1, 6);
    exit when not exists (select 1 from public.groups where join_code = code);
  end loop;
  return code;
end;
$$;

create function public.create_group(p_name text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare
  v_group public.groups;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from public.group_members where user_id = auth.uid()) then
    raise exception 'already_in_group' using hint = 'Leave your current group first.';
  end if;
  insert into public.groups (name, join_code, created_by)
  values (trim(p_name), public.generate_join_code(), auth.uid())
  returning * into v_group;
  insert into public.group_members (group_id, user_id) values (v_group.id, auth.uid());
  return v_group;
end;
$$;

create function public.join_group(p_code text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare
  v_group public.groups;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from public.group_members where user_id = auth.uid()) then
    raise exception 'already_in_group' using hint = 'Leave your current group first.';
  end if;
  select * into v_group from public.groups
  where join_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if not found then raise exception 'invalid_join_code'; end if;
  insert into public.group_members (group_id, user_id) values (v_group.id, auth.uid());
  return v_group;
end;
$$;

-- Leaving removes the membership and deletes the group once it is empty.
create function public.leave_group() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_group uuid;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  delete from public.group_members where user_id = auth.uid() returning group_id into v_group;
  if v_group is not null and not exists (select 1 from public.group_members where group_id = v_group) then
    delete from public.groups where id = v_group;
  end if;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.generate_join_code() from public, anon, authenticated;
revoke execute on function public.is_group_member(uuid) from public, anon;
revoke execute on function public.shares_group_with(uuid) from public, anon;
revoke execute on function public.create_group(text) from public, anon;
revoke execute on function public.join_group(text) from public, anon;
revoke execute on function public.leave_group() from public, anon;
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.shares_group_with(uuid) to authenticated;
grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.leave_group() to authenticated;
