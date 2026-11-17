-- Crate migration 0006: exactly what the app may touch.
--
-- Row Level Security decides WHICH rows a person can see or change. These
-- grants decide which tables, columns and actions exist for the app at all.
-- Everything is revoked first and then granted narrowly, so the result is the
-- same whether or not the Supabase project grants broad access by default.
-- Nothing is granted to "anon": a person must be signed in to use Crate.

revoke all on all tables in schema public from anon, authenticated;

-- Tables
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

grant select on public.groups, public.group_members to authenticated;   -- changed only via functions
grant select on public.albums, public.tracks to authenticated;           -- changed only via upsert_album

grant select, insert on public.copies to authenticated;
grant update (pressing_note, removed_at) on public.copies to authenticated;   -- no delete: removal is soft

grant select, insert, update, delete on public.track_marks to authenticated;

grant select on public.loans to authenticated;                           -- changed only via functions

grant select, delete on public.notifications to authenticated;           -- created only by the database
grant update (read_at) on public.notifications to authenticated;

grant select, insert, delete on public.wishlist_items to authenticated;
grant update (note) on public.wishlist_items to authenticated;

grant select, delete on public.wishlist_claims to authenticated;         -- created only via claim_wishlist_item

grant select, insert, delete on public.listens to authenticated;
grant update (ended_at, listened_at) on public.listens to authenticated;

-- Views (each one runs with the caller's row level security)
grant select on
  public.album_scores, public.album_marks, public.collection_items, public.owned_albums,
  public.loan_details, public.shelf_items, public.wishlist_view, public.listen_log
to authenticated;
