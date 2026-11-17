-- Crate migration 0002: album catalog, copies (the collection), ratings.
--
-- album = the musical work (a MusicBrainz release group), shared by everyone.
-- copy  = one physical record one person owns.
-- track_marks = one person's rating or interlude flag on one track.

-- ------------------------------------------------------------------ albums
create table public.albums (
  id uuid primary key default gen_random_uuid(),
  mbid text unique,                       -- MusicBrainz release group ID; null for manual entries
  title text not null check (char_length(title) between 1 and 300),
  artist text not null check (char_length(artist) between 1 and 300),
  year int check (year between 1860 and 2200),
  cover_url text check (cover_url is null or cover_url like 'https://coverartarchive.org/%'),
  album_key text not null,                -- normalized artist::title, see src/domain/normalize.ts
  genres text[] not null default '{}',
  is_manual boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index albums_album_key on public.albums (album_key);
alter table public.albums enable row level security;

create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums (id) on delete cascade,
  disc int not null default 1 check (disc >= 1),
  position int not null check (position >= 1),
  title text not null check (char_length(title) between 1 and 300),
  length_ms int check (length_ms > 0),
  recording_mbid text,
  unique (album_id, disc, position)
);
alter table public.tracks enable row level security;

-- The catalog is readable by any signed-in person and written only through
-- upsert_album below, so nobody can edit an album other people rely on.
create policy "albums: signed-in read" on public.albums for select to authenticated using (true);
create policy "tracks: signed-in read" on public.tracks for select to authenticated using (true);

-- Adds an album and its tracks in one step, or returns the existing album.
-- p_album:  { mbid, title, artist, year, cover_url, album_key, genres: [] }
-- p_tracks: [ { disc, position, title, length_ms, recording_mbid } ]
create function public.upsert_album(p_album jsonb, p_tracks jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_mbid text := nullif(trim(p_album ->> 'mbid'), '');
  v_key text := nullif(trim(p_album ->> 'album_key'), '');
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if v_key is null then raise exception 'album_key_required'; end if;

  if v_mbid is not null then
    select id into v_id from public.albums where mbid = v_mbid;
  else
    -- Manual entry: reuse an album with the same normalized name if the
    -- catalog already has one, preferring one that came from MusicBrainz.
    select id into v_id from public.albums
    where album_key = v_key order by is_manual, created_at limit 1;
  end if;
  if v_id is not null then return v_id; end if;

  if jsonb_typeof(p_tracks) is distinct from 'array'
     or jsonb_array_length(p_tracks) < 1 or jsonb_array_length(p_tracks) > 300 then
    raise exception 'tracks_required' using hint = 'An album needs between 1 and 300 tracks.';
  end if;

  insert into public.albums (mbid, title, artist, year, cover_url, album_key, genres, is_manual, created_by)
  values (
    v_mbid,
    trim(p_album ->> 'title'),
    trim(p_album ->> 'artist'),
    nullif(p_album ->> 'year', '')::int,
    nullif(p_album ->> 'cover_url', ''),
    v_key,
    coalesce((select array_agg(g) from jsonb_array_elements_text(coalesce(p_album -> 'genres', '[]'::jsonb)) g), '{}'),
    v_mbid is null,
    auth.uid()
  )
  on conflict (mbid) do nothing
  returning id into v_id;

  if v_id is null then -- someone added the same album a moment ago
    select id into v_id from public.albums where mbid = v_mbid;
    return v_id;
  end if;

  insert into public.tracks (album_id, disc, position, title, length_ms, recording_mbid)
  select v_id,
         coalesce((t ->> 'disc')::int, 1),
         coalesce((t ->> 'position')::int, ord::int),
         trim(t ->> 'title'),
         nullif(t ->> 'length_ms', '')::int,
         nullif(t ->> 'recording_mbid', '')
  from jsonb_array_elements(p_tracks) with ordinality as x (t, ord);

  return v_id;
end;
$$;
revoke execute on function public.upsert_album(jsonb, jsonb) from public, anon;
grant execute on function public.upsert_album(jsonb, jsonb) to authenticated;

-- ------------------------------------------------------------------ copies
create table public.copies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  album_id uuid not null references public.albums (id),
  pressing_note text check (char_length(pressing_note) <= 120),
  added_at timestamptz not null default now(),
  removed_at timestamptz                  -- soft delete: ratings and listens are kept
);
create index copies_owner_active on public.copies (owner_id) where removed_at is null;
create index copies_album on public.copies (album_id);
alter table public.copies enable row level security;

create policy "copies: read your own and your group's" on public.copies
  for select to authenticated using (public.shares_group_with(owner_id));
create policy "copies: add your own" on public.copies
  for insert to authenticated with check (owner_id = auth.uid());
create policy "copies: change your own" on public.copies
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- No delete policy: records are removed by setting removed_at.

-- Only the note and the removed flag may change after a copy is created
-- (column grants are in migration 0006).

-- ------------------------------------------------------------- track marks
create table public.track_marks (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  track_id uuid not null references public.tracks (id) on delete cascade,
  rating numeric(3, 1) check (rating between 1.0 and 10.0),   -- 0.1 steps
  is_interlude boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, track_id),
  constraint interlude_has_no_rating check (not (is_interlude and rating is not null))
);
create index track_marks_track on public.track_marks (track_id);
alter table public.track_marks enable row level security;

-- You may rate an album while you have it. Migration 0003 extends this to
-- records you are borrowing.
create function public.can_rate_album(p_album uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.copies
    where owner_id = auth.uid() and album_id = p_album and removed_at is null
  );
$$;

create function public.can_rate_track(p_track uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_rate_album((select album_id from public.tracks where id = p_track));
$$;
revoke execute on function public.can_rate_album(uuid) from public, anon;
revoke execute on function public.can_rate_track(uuid) from public, anon;
grant execute on function public.can_rate_album(uuid) to authenticated;
grant execute on function public.can_rate_track(uuid) to authenticated;

create policy "track_marks: read your own and your group's" on public.track_marks
  for select to authenticated using (public.shares_group_with(user_id));
create policy "track_marks: rate records you have" on public.track_marks
  for insert to authenticated with check (user_id = auth.uid() and public.can_rate_track(track_id));
create policy "track_marks: change marks on records you have" on public.track_marks
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_rate_track(track_id));
create policy "track_marks: clear your own" on public.track_marks
  for delete to authenticated using (user_id = auth.uid() and public.can_rate_track(track_id));

-- ------------------------------------------------------------ album scores
-- One row per person per album they have marked. Mirrors albumProgress() in
-- src/domain/ratings.ts; a database test checks the two agree.
-- security_invoker makes the view obey the caller's row level security.
create view public.album_scores with (security_invoker = true) as
with marked as (
  select distinct m.user_id, t.album_id
  from public.track_marks m
  join public.tracks t on t.id = m.track_id
),
totals as (
  select
    mk.user_id,
    mk.album_id,
    count(*) filter (where not coalesce(m.is_interlude, false)) as countable_tracks,
    count(m.rating) filter (where not coalesce(m.is_interlude, false)) as rated_tracks,
    count(*) filter (where coalesce(m.is_interlude, false)) as interlude_tracks,
    avg(m.rating) filter (where not coalesce(m.is_interlude, false)) as rating
  from marked mk
  join public.tracks t on t.album_id = mk.album_id
  left join public.track_marks m on m.track_id = t.id and m.user_id = mk.user_id
  group by mk.user_id, mk.album_id
)
select
  s.user_id,
  s.album_id,
  a.title,
  a.artist,
  a.year,
  a.cover_url,
  s.countable_tracks::int,
  s.rated_tracks::int,
  s.interlude_tracks::int,
  s.rating::float8 as rating,
  case
    when s.rated_tracks = 0 then 'not_started'
    when s.rated_tracks = s.countable_tracks then 'complete'
    else 'in_progress'
  end as status
from totals s
join public.albums a on a.id = s.album_id;

-- ------------------------------------------------------- collection (view)
-- One row per record currently in someone's collection. Migration 0003
-- replaces this view to add who a record is lent to.
create view public.collection_items with (security_invoker = true) as
select
  c.id as copy_id,
  c.owner_id,
  p.display_name as owner_name,
  c.album_id,
  a.title,
  a.artist,
  a.year,
  a.cover_url,
  c.pressing_note,
  c.added_at
from public.copies c
join public.albums a on a.id = c.album_id
join public.profiles p on p.id = c.owner_id
where c.removed_at is null;

-- Albums a person owns or has owned, with copy counts. Used for duplicate
-- detection when adding a record.
create view public.owned_albums with (security_invoker = true) as
select
  c.owner_id,
  c.album_id,
  a.mbid,
  a.title,
  a.artist,
  count(*) filter (where c.removed_at is null)::int as active_copies,
  count(*) filter (where c.removed_at is not null)::int as removed_copies
from public.copies c
join public.albums a on a.id = c.album_id
group by c.owner_id, c.album_id, a.mbid, a.title, a.artist;

-- Marks with their album, so one album's marks can be fetched in one query.
create view public.album_marks with (security_invoker = true) as
select m.user_id, t.album_id, m.track_id, m.rating::float8 as rating, m.is_interlude
from public.track_marks m
join public.tracks t on t.id = m.track_id;
