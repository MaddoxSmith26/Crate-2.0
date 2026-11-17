-- Crate migration 0005: now playing and listening history.
--
-- A listen is one play of one album by one person. It counts once per album,
-- not per side, and it belongs only to the listener: playing someone else's
-- record never changes the owner's counts.

create table public.listens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  album_id uuid not null references public.albums (id),
  listened_at timestamptz not null default now(),
  source text not null default 'manual' check (source in ('now_playing', 'manual')),
  ended_at timestamptz,                   -- set when a now-playing session is stopped
  created_at timestamptz not null default now(),
  check (listened_at <= created_at + interval '1 day')   -- no listens in the future
);
create index listens_user on public.listens (user_id, listened_at desc);
alter table public.listens enable row level security;

create policy "listens: read your own and your group's" on public.listens
  for select to authenticated using (public.shares_group_with(user_id));
create policy "listens: log your own" on public.listens
  for insert to authenticated with check (user_id = auth.uid());
create policy "listens: change your own" on public.listens
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "listens: delete your own" on public.listens
  for delete to authenticated using (user_id = auth.uid());

-- Starts a now-playing session: closes any session still open, then logs one
-- listen for the album.
create function public.start_listening(p_album uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  update public.listens set ended_at = now()
  where user_id = auth.uid() and source = 'now_playing' and ended_at is null;
  insert into public.listens (user_id, album_id, source) values (auth.uid(), p_album, 'now_playing')
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.start_listening(uuid) from public, anon;
grant execute on function public.start_listening(uuid) to authenticated;

create view public.listen_log with (security_invoker = true) as
select
  l.id as listen_id,
  l.user_id,
  l.album_id,
  a.title, a.artist, a.year, a.cover_url,
  l.listened_at,
  l.source,
  l.ended_at
from public.listens l
join public.albums a on a.id = l.album_id;
