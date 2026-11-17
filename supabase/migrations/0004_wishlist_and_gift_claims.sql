-- Crate migration 0004: wishlists and hidden gift claims.
--
-- THE rule: a gift claim must never be visible to the person it is for.
-- Claims live in their own table. Its only read policy excludes the wishlist
-- owner, and there is no insert or update policy at all: claims are created
-- through claim_wishlist_item(), which refuses the owner.

create table public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  album_id uuid not null references public.albums (id),
  note text check (char_length(note) <= 200),
  added_at timestamptz not null default now(),
  unique (user_id, album_id)
);
alter table public.wishlist_items enable row level security;

create policy "wishlist: read your own and your group's" on public.wishlist_items
  for select to authenticated using (public.shares_group_with(user_id));
create policy "wishlist: add to your own" on public.wishlist_items
  for insert to authenticated with check (user_id = auth.uid());
create policy "wishlist: edit your own" on public.wishlist_items
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "wishlist: remove from your own" on public.wishlist_items
  for delete to authenticated using (user_id = auth.uid());

create table public.wishlist_claims (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null unique references public.wishlist_items (id) on delete cascade,
  claimer_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 month')
);
alter table public.wishlist_claims enable row level security;

-- True only for people in the wisher's group who are NOT the wisher.
create function public.can_see_claims_on(p_item uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.wishlist_items w
    where w.id = p_item
      and w.user_id <> auth.uid()
      and public.shares_group_with(w.user_id)
  );
$$;
revoke execute on function public.can_see_claims_on(uuid) from public, anon;
grant execute on function public.can_see_claims_on(uuid) to authenticated;

create policy "claims: visible to the group, never to the wisher" on public.wishlist_claims
  for select to authenticated using (public.can_see_claims_on(item_id) and expires_at > now());
create policy "claims: cancel your own" on public.wishlist_claims
  for delete to authenticated using (claimer_id = auth.uid() and public.can_see_claims_on(item_id));

create function public.claim_wishlist_item(p_item uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_claim uuid;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select user_id into v_owner from public.wishlist_items where id = p_item;
  -- The same error for "not found" and "it is your own item", so the wisher
  -- learns nothing by probing.
  if v_owner is null or v_owner = auth.uid() or not public.shares_group_with(v_owner) then
    raise exception 'wishlist_item_not_found';
  end if;
  delete from public.wishlist_claims where item_id = p_item and expires_at <= now();
  begin
    insert into public.wishlist_claims (item_id, claimer_id) values (p_item, auth.uid())
    returning id into v_claim;
  exception when unique_violation then
    raise exception 'already_claimed';
  end;
  return v_claim;
end;
$$;
revoke execute on function public.claim_wishlist_item(uuid) from public, anon;
grant execute on function public.claim_wishlist_item(uuid) to authenticated;

-- Wishlist rows with album details and, for everyone except the wisher, the
-- claim. security_invoker applies the claims policy above, so on your own
-- wishlist the claim columns are always null.
create view public.wishlist_view with (security_invoker = true) as
select
  w.id as item_id,
  w.user_id,
  p.display_name as user_name,
  w.album_id,
  a.title, a.artist, a.year, a.cover_url,
  w.note,
  w.added_at,
  cl.id as claim_id,
  cl.claimer_id,
  cp.display_name as claimer_name,
  cl.expires_at as claim_expires_at
from public.wishlist_items w
join public.albums a on a.id = w.album_id
join public.profiles p on p.id = w.user_id
left join public.wishlist_claims cl on cl.item_id = w.id
left join public.profiles cp on cp.id = cl.claimer_id;

-- When a claimed item leaves a wishlist, the person who claimed it is told.
-- The wisher is never told anything about claims.
create function public.notify_claimer_on_wish_removed() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_claimer uuid;
  v_title text;
  v_name text;
  v_has_it boolean;
begin
  select claimer_id into v_claimer from public.wishlist_claims
  where item_id = old.id and expires_at > now();
  if v_claimer is not null then
    select title into v_title from public.albums where id = old.album_id;
    select display_name into v_name from public.profiles where id = old.user_id;
    v_has_it := exists (
      select 1 from public.copies
      where owner_id = old.user_id and album_id = old.album_id and removed_at is null
    );
    perform public.notify(v_claimer, 'claim_cleared',
      case when v_has_it then v_name || ' now has ' || v_title
           else v_name || ' took ' || v_title || ' off their wishlist' end,
      'Your gift claim was cleared.',
      jsonb_build_object('album_id', old.album_id));
  end if;
  return old;
end;
$$;
revoke execute on function public.notify_claimer_on_wish_removed() from public, anon, authenticated;
create trigger wishlist_items_notify_claimer before delete on public.wishlist_items
  for each row execute function public.notify_claimer_on_wish_removed();

-- Adding a copy of an album takes it off that person's wishlist.
create function public.clear_wishlist_on_copy() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.wishlist_items where user_id = new.owner_id and album_id = new.album_id;
  return new;
end;
$$;
revoke execute on function public.clear_wishlist_on_copy() from public, anon, authenticated;
create trigger copies_clear_wishlist after insert on public.copies
  for each row execute function public.clear_wishlist_on_copy();
