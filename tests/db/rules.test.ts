/**
 * Database rule tests. These run Crate's real migrations in an in-process
 * Postgres and act as different signed-in people, so they test the actual
 * Row Level Security policies: who can see and change what.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

import { albumProgress } from '../../src/domain/ratings';
import { as, createTestDb, createUser, type Session } from '../support/db';

let db: PGlite;
// One family (Maddox, Sam, Alex) and one outsider (Olive) in another group.
let maddoxId: string, samId: string, alexId: string, oliveId: string;
let maddox: Session, sam: Session, alex: Session, olive: Session, anon: Session;
let joinCode: string;

async function addAlbum(who: Session, title: string, trackCount: number, extra: Record<string, unknown> = {}) {
  const album = { mbid: `mb-${title}`, title, artist: 'Test Artist', year: 1977, album_key: `testartist::${title.toLowerCase()}`, genres: ['rock'], ...extra };
  const tracks = Array.from({ length: trackCount }, (_, i) => ({ disc: 1, position: i + 1, title: `${title} track ${i + 1}`, length_ms: 180000 }));
  const rows = await who.q(`select public.upsert_album($1::jsonb, $2::jsonb) as id`, [JSON.stringify(album), JSON.stringify(tracks)]);
  const albumId = rows[0]!.id as string;
  const trackRows = await who.q(`select id from public.tracks where album_id = $1 order by disc, position`, [albumId]);
  return { albumId, trackIds: trackRows.map((r) => r.id as string) };
}

async function addCopy(who: Session, albumId: string): Promise<string> {
  const rows = await who.q(`insert into public.copies (album_id) values ($1) returning id`, [albumId]);
  return rows[0]!.id as string;
}

const rate = (who: Session, trackId: string, rating: number) =>
  who.q(
    `insert into public.track_marks (track_id, rating, is_interlude) values ($1, $2, false)
     on conflict (user_id, track_id) do update set rating = excluded.rating, is_interlude = false`,
    [trackId, rating],
  );
const markInterlude = (who: Session, trackId: string) =>
  who.q(
    `insert into public.track_marks (track_id, rating, is_interlude) values ($1, null, true)
     on conflict (user_id, track_id) do update set rating = null, is_interlude = true`,
    [trackId],
  );

beforeAll(async () => {
  db = await createTestDb();
  maddoxId = await createUser(db, 'Maddox');
  samId = await createUser(db, 'Sam');
  alexId = await createUser(db, 'Alex');
  oliveId = await createUser(db, 'Olive');
  maddox = as(db, maddoxId);
  sam = as(db, samId);
  alex = as(db, alexId);
  olive = as(db, oliveId);
  anon = as(db, null);

  const group = await maddox.q(`select * from public.create_group('The Smiths')`);
  joinCode = group[0]!.join_code as string;
  await sam.q(`select public.join_group($1)`, [joinCode.toLowerCase()]); // codes are not case sensitive
  await alex.q(`select public.join_group($1)`, [joinCode]);
  await olive.q(`select public.create_group('Other family')`);
});

describe('accounts and family groups', () => {
  it('creates a profile on sign-up', async () => {
    const rows = await maddox.q(`select display_name from public.profiles where id = $1`, [maddoxId]);
    expect(rows[0]!.display_name).toBe('Maddox');
  });

  it('gives a six character join code and lets others join with it', async () => {
    expect(joinCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const members = await maddox.q(`select user_id from public.group_members`);
    expect(members.map((m) => m.user_id).sort()).toEqual([maddoxId, samId, alexId].sort());
  });

  it('rejects a wrong code and a second group', async () => {
    const stranger = as(db, await createUser(db, 'Stranger'));
    expect(await stranger.fails(`select public.join_group('NOPE00')`)).toContain('invalid_join_code');
    expect(await sam.fails(`select public.create_group('Another')`)).toContain('already_in_group');
  });

  it('shows profiles and groups to members only', async () => {
    expect((await sam.q(`select id from public.profiles`)).map((r) => r.id).sort()).toEqual([maddoxId, samId, alexId].sort());
    expect((await olive.q(`select id from public.profiles`)).map((r) => r.id)).toEqual([oliveId]);
    expect(await olive.q(`select * from public.groups where join_code = $1`, [joinCode])).toEqual([]);
    expect(await olive.q(`select * from public.group_members where user_id = $1`, [maddoxId])).toEqual([]);
  });

  it('shows nothing to someone who is not signed in', async () => {
    const relations = [
      'profiles', 'groups', 'group_members', 'albums', 'tracks', 'copies', 'track_marks', 'loans', 'notifications',
      'wishlist_items', 'wishlist_claims', 'listens', 'album_scores', 'album_marks', 'collection_items', 'owned_albums',
      'loan_details', 'shelf_items', 'wishlist_view', 'listen_log',
    ];
    for (const relation of relations) {
      expect(await anon.fails(`select * from public.${relation}`), relation).toContain('permission denied');
    }
    expect(await anon.fails(`select public.create_group('x')`)).toContain('permission denied');
    expect(await anon.fails(`select public.claim_wishlist_item(gen_random_uuid())`)).toContain('permission denied');
  });

  it('has row level security switched on for every table', async () => {
    const off = await db.query(`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`);
    expect(off.rows).toEqual([]);
  });

  it('cannot add members directly, only through a join code', async () => {
    const smiths = await db.query(`select id from public.groups where join_code = $1`, [joinCode]);
    const direct = await olive.fails(`insert into public.group_members (group_id, user_id) values ($1, $2)`, [(smiths.rows[0] as any).id, oliveId]);
    expect(direct).toContain('permission denied');
  });

  it('deletes a group when its last member leaves', async () => {
    const loner = as(db, await createUser(db, 'Loner'));
    const group = await loner.q(`select * from public.create_group('Solo')`);
    await loner.q(`select public.leave_group()`);
    const left = await db.query(`select 1 from public.groups where id = $1`, [group[0]!.id]);
    expect(left.rows).toEqual([]);
  });
});

describe('album catalog', () => {
  it('adds an album with its tracks once, and reuses it after that', async () => {
    const first = await addAlbum(maddox, 'Catalog', 3);
    const second = await addAlbum(sam, 'Catalog', 5); // same MusicBrainz ID
    expect(second.albumId).toBe(first.albumId);
    expect(second.trackIds).toHaveLength(3);
    const count = await db.query(`select count(*)::int as n from public.albums where mbid = 'mb-Catalog'`);
    expect((count.rows[0] as any).n).toBe(1);
  });

  it('reuses a catalog album for a manual entry with the same normalized name', async () => {
    const fromSearch = await addAlbum(maddox, 'Manualmatch', 2);
    const manual = await addAlbum(sam, 'Manualmatch', 2, { mbid: null });
    expect(manual.albumId).toBe(fromSearch.albumId);
  });

  it('cannot be edited directly', async () => {
    expect(await maddox.fails(`insert into public.albums (title, artist, album_key) values ('x', 'y', 'y::x')`)).toContain('permission denied');
    const { albumId } = await addAlbum(maddox, 'Locked', 1);
    expect(await maddox.fails(`update public.albums set title = 'Hacked' where id = $1`, [albumId])).toContain('permission denied');
    expect(await maddox.fails(`delete from public.tracks where album_id = $1`, [albumId])).toContain('permission denied');
    const after = await maddox.q(`select title, (select count(*)::int from public.tracks where album_id = a.id) as n from public.albums a where id = $1`, [albumId]);
    expect(after[0]).toMatchObject({ title: 'Locked', n: 1 });
  });

  it('rejects an album with no tracks and covers from other sites', async () => {
    expect(await maddox.fails(`select public.upsert_album('{"mbid":"mb-empty","title":"E","artist":"A","album_key":"a::e"}'::jsonb, '[]'::jsonb)`)).toContain('tracks_required');
    expect(await maddox.fails(`select public.upsert_album('{"mbid":"mb-cover","title":"E","artist":"A","album_key":"a::e","cover_url":"https://evil.example/x.png"}'::jsonb, '[{"title":"t"}]'::jsonb)`)).toContain('violates check constraint');
  });
});

describe('collection', () => {
  it('lets each person add only their own copies', async () => {
    const { albumId } = await addAlbum(maddox, 'Owned', 2);
    await addCopy(maddox, albumId);
    expect(await sam.fails(`insert into public.copies (owner_id, album_id) values ($1, $2)`, [maddoxId, albumId])).toContain('row-level security');
  });

  it('counts two pressings as two copies of one album', async () => {
    const { albumId } = await addAlbum(maddox, 'Pressings', 2);
    await addCopy(maddox, albumId);
    await maddox.q(`insert into public.copies (album_id, pressing_note) values ($1, '2011 reissue')`, [albumId]);
    const rows = await maddox.q(`select album_id from public.collection_items where owner_id = $1 and album_id = $2`, [maddoxId, albumId]);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.album_id)).size).toBe(1);
  });

  it('is visible to the family with whose each record is, and hidden from outsiders', async () => {
    const { albumId } = await addAlbum(sam, 'Shared', 2);
    await addCopy(sam, albumId);
    const seen = await maddox.q(`select owner_name from public.collection_items where album_id = $1`, [albumId]);
    expect(seen).toEqual([{ owner_name: 'Sam' }]);
    expect(await olive.q(`select * from public.collection_items where album_id = $1`, [albumId])).toEqual([]);
    expect(await olive.q(`select * from public.copies where album_id = $1`, [albumId])).toEqual([]);
  });

  it('removes a record softly and keeps its ratings', async () => {
    const { albumId, trackIds } = await addAlbum(maddox, 'Removed', 2);
    const copyId = await addCopy(maddox, albumId);
    await rate(maddox, trackIds[0]!, 8);
    await rate(maddox, trackIds[1]!, 9);

    // A hard delete is not allowed.
    expect(await maddox.fails(`delete from public.copies where id = $1`, [copyId])).toContain('permission denied');

    await maddox.q(`update public.copies set removed_at = now() where id = $1`, [copyId]);
    expect(await maddox.q(`select * from public.collection_items where copy_id = $1`, [copyId])).toEqual([]);
    const score = await maddox.q(`select status, rating from public.album_scores where user_id = $1 and album_id = $2`, [maddoxId, albumId]);
    expect(score[0]).toMatchObject({ status: 'complete', rating: 8.5 });
    // ...but the album can no longer be re-rated without a copy.
    expect(await maddox.fails(`update public.track_marks set rating = 1 where track_id = $1`, [trackIds[0]])).toContain('row-level security');
  });

  it('does not let a copy be moved to another album or owner', async () => {
    const a = await addAlbum(maddox, 'MoveA', 1);
    const b = await addAlbum(maddox, 'MoveB', 1);
    const copyId = await addCopy(maddox, a.albumId);
    expect(await maddox.fails(`update public.copies set album_id = $1 where id = $2`, [b.albumId, copyId])).toContain('permission denied');
    expect(await maddox.fails(`update public.copies set owner_id = $1 where id = $2`, [samId, copyId])).toContain('permission denied');
  });
});

describe('ratings', () => {
  it('accepts 1.0 to 10.0 and rejects anything outside', async () => {
    const { albumId, trackIds } = await addAlbum(maddox, 'Bounds', 2);
    await addCopy(maddox, albumId);
    await rate(maddox, trackIds[0]!, 1.0);
    await rate(maddox, trackIds[1]!, 10.0);
    await rate(maddox, trackIds[0]!, 7.3);
    expect(await maddox.fails(`update public.track_marks set rating = 0.9 where track_id = $1`, [trackIds[0]])).toContain('check constraint');
    expect(await maddox.fails(`update public.track_marks set rating = 10.1 where track_id = $1`, [trackIds[0]])).toContain('check constraint');
    const stored = await maddox.q(`select rating::float8 as rating from public.track_marks where track_id = $1`, [trackIds[0]]);
    expect(stored[0]!.rating).toBe(7.3);
  });

  it('does not allow an interlude to carry a rating', async () => {
    const { albumId, trackIds } = await addAlbum(maddox, 'Interlude', 2);
    await addCopy(maddox, albumId);
    expect(await maddox.fails(`insert into public.track_marks (track_id, rating, is_interlude) values ($1, 5, true)`, [trackIds[0]])).toContain('interlude_has_no_rating');
  });

  it('only lets you rate records you have, and only as yourself', async () => {
    const { albumId, trackIds } = await addAlbum(sam, 'NotMine', 1);
    await addCopy(sam, albumId);
    expect(await alex.fails(`insert into public.track_marks (track_id, rating) values ($1, 9)`, [trackIds[0]])).toContain('row-level security');
    expect(await sam.fails(`insert into public.track_marks (user_id, track_id, rating) values ($1, $2, 9)`, [alexId, trackIds[0]])).toContain('row-level security');
  });

  it('keeps every number personal: one person rating changes nobody else', async () => {
    const { albumId, trackIds } = await addAlbum(maddox, 'Personal', 2);
    await addCopy(maddox, albumId);
    await addCopy(sam, albumId);
    await markInterlude(maddox, trackIds[0]!); // an interlude for Maddox...
    await rate(maddox, trackIds[1]!, 9);
    await rate(sam, trackIds[0]!, 5); // ...that Sam chooses to rate
    await rate(sam, trackIds[1]!, 9);

    const scores = await alex.q(`select user_id, status, rating, interlude_tracks from public.album_scores where album_id = $1`, [albumId]);
    const mine = scores.find((s) => s.user_id === maddoxId)!;
    const theirs = scores.find((s) => s.user_id === samId)!;
    expect(mine).toMatchObject({ status: 'complete', rating: 9, interlude_tracks: 1 });
    expect(theirs).toMatchObject({ status: 'complete', rating: 7, interlude_tracks: 0 });

    // Sam cannot touch Maddox's marks.
    await sam.q(`update public.track_marks set rating = 1 where user_id = $1`, [maddoxId]);
    await sam.q(`delete from public.track_marks where user_id = $1`, [maddoxId]);
    const still = await maddox.q(`select rating::float8 as rating from public.track_marks where user_id = $1 and track_id = $2`, [maddoxId, trackIds[1]]);
    expect(still[0]!.rating).toBe(9);
  });

  it('is In progress until every non-interlude track is rated, then Complete', async () => {
    const { albumId, trackIds } = await addAlbum(maddox, 'Progress', 3);
    await addCopy(maddox, albumId);
    const status = async () => (await maddox.q(`select status from public.album_scores where user_id = $1 and album_id = $2`, [maddoxId, albumId]))[0]?.status;
    expect(await status()).toBeUndefined();
    await rate(maddox, trackIds[0]!, 8);
    expect(await status()).toBe('in_progress');
    await rate(maddox, trackIds[1]!, 8);
    expect(await status()).toBe('in_progress');
    await markInterlude(maddox, trackIds[2]!);
    expect(await status()).toBe('complete');
  });

  it('computes the same score in the database as the app does', async () => {
    const cases: (number | 'interlude' | null)[][] = [
      [7.1, 7.2, 7.3],
      [10, 1, null],
      ['interlude', 8.4, 6.6, 9.9],
      ['interlude', 'interlude'],
      [null, null, 5.5],
      [3.3, 'interlude', null, 9.1, 9.1],
    ];
    for (const [index, marks] of cases.entries()) {
      const { albumId, trackIds } = await addAlbum(alex, `Agree${index}`, marks.length);
      await addCopy(alex, albumId);
      for (const [i, mark] of marks.entries()) {
        if (mark === 'interlude') await markInterlude(alex, trackIds[i]!);
        else if (mark !== null) await rate(alex, trackIds[i]!, mark);
      }
      const expected = albumProgress(
        trackIds,
        marks.flatMap((mark, i) => (mark === null ? [] : [{ trackId: trackIds[i]!, rating: mark === 'interlude' ? null : mark, isInterlude: mark === 'interlude' }])),
      );
      const rows = await alex.q(`select * from public.album_scores where user_id = $1 and album_id = $2`, [alexId, albumId]);
      expect(rows, `case ${index}`).toHaveLength(1);
      const row = rows[0]!;
      expect(row.status, `case ${index}`).toBe(expected.status);
      expect(row.countable_tracks).toBe(expected.countableTracks);
      expect(row.rated_tracks).toBe(expected.ratedTracks);
      expect(row.interlude_tracks).toBe(expected.interludeTracks);
      if (expected.rating === null) expect(row.rating).toBeNull();
      else expect(row.rating).toBeCloseTo(expected.rating, 9);
    }
  });
});

describe('borrowing', () => {
  let albumId: string, trackIds: string[], copyId: string, loanId: string;

  beforeAll(async () => {
    ({ albumId, trackIds } = await addAlbum(maddox, 'Lendable', 2));
    copyId = await addCopy(maddox, albumId);
  });

  it('only lets family members ask, and not for their own record', async () => {
    expect(await olive.fails(`select public.request_loan($1)`, [copyId])).toMatch(/record_not_found|not_in_same_group/);
    expect(await maddox.fails(`select public.request_loan($1)`, [copyId])).toContain('cannot_borrow_your_own_record');
    loanId = (await sam.q(`select public.request_loan($1) as id`, [copyId]))[0]!.id;
    expect(await sam.fails(`select public.request_loan($1)`, [copyId])).toContain('already_requested');
  });

  it('notifies the owner in the app, and only the owner', async () => {
    const mine = await maddox.q(`select kind, title from public.notifications where data ->> 'loan_id' = $1`, [loanId]);
    expect(mine).toEqual([{ kind: 'loan_requested', title: 'Sam wants to borrow Lendable' }]);
    expect(await sam.q(`select * from public.notifications where data ->> 'loan_id' = $1`, [loanId])).toEqual([]);
    expect(await alex.q(`select * from public.notifications where user_id = $1`, [maddoxId])).toEqual([]);
  });

  it('cannot be approved by anyone but the owner, or by editing the table', async () => {
    expect(await sam.fails(`select public.decide_loan($1, true)`, [loanId])).toContain('loan_not_found');
    expect(await sam.fails(`update public.loans set status = 'approved' where id = $1`, [loanId])).toContain('permission denied');
    expect((await sam.q(`select status from public.loans where id = $1`, [loanId]))[0]!.status).toBe('requested');
    // The borrower cannot rate before approval.
    expect(await sam.fails(`insert into public.track_marks (track_id, rating) values ($1, 9)`, [trackIds[0]])).toContain('row-level security');
  });

  it('once approved, shows who has it and takes it off the owner\'s shelf', async () => {
    await maddox.q(`select public.decide_loan($1, true)`, [loanId]);
    const item = await alex.q(`select lent_to_name from public.collection_items where copy_id = $1`, [copyId]);
    expect(item).toEqual([{ lent_to_name: 'Sam' }]);
    expect(await maddox.q(`select * from public.shelf_items where holder_id = $1 and album_id = $2`, [maddoxId, albumId])).toEqual([]);
    const samShelf = await sam.q(`select borrowed, owner_name from public.shelf_items where holder_id = $1 and album_id = $2`, [samId, albumId]);
    expect(samShelf).toEqual([{ borrowed: true, owner_name: 'Maddox' }]);
    const told = await sam.q(`select kind from public.notifications where data ->> 'loan_id' = $1`, [loanId]);
    expect(told).toEqual([{ kind: 'loan_approved' }]);
  });

  it('cannot be lent twice or removed while it is out', async () => {
    expect(await alex.fails(`select public.request_loan($1)`, [copyId])).toContain('record_already_lent_out');
    expect(await maddox.fails(`update public.copies set removed_at = now() where id = $1`, [copyId])).toContain('record_is_lent_out');
  });

  it('lets the borrower rate it, and keeps it on their ranking after it goes back', async () => {
    await rate(sam, trackIds[0]!, 9);
    await rate(sam, trackIds[1]!, 8);
    await sam.q(`select public.return_loan($1)`, [loanId]);

    const score = await sam.q(`select status, rating from public.album_scores where user_id = $1 and album_id = $2`, [samId, albumId]);
    expect(score[0]).toMatchObject({ status: 'complete', rating: 8.5 });
    expect(await sam.fails(`update public.track_marks set rating = 2 where track_id = $1`, [trackIds[0]])).toContain('row-level security');
    // Back on the owner's shelf, off the borrower's.
    expect(await maddox.q(`select 1 as ok from public.shelf_items where holder_id = $1 and album_id = $2`, [maddoxId, albumId])).toHaveLength(1);
    expect(await sam.q(`select * from public.shelf_items where holder_id = $1 and album_id = $2`, [samId, albumId])).toEqual([]);
    // Sam rating it never touched Maddox's numbers.
    expect(await maddox.q(`select * from public.album_scores where user_id = $1 and album_id = $2`, [maddoxId, albumId])).toEqual([]);
  });

  it('reminds both people in the app after two weeks, at most weekly', async () => {
    const second = (await alex.q(`select public.request_loan($1) as id`, [copyId]))[0]!.id;
    await maddox.q(`select public.decide_loan($1, true)`, [second]);
    expect((await alex.q(`select public.refresh_loan_reminders() as n`))[0]!.n).toBe(0);
    await db.query(`update public.loans set decided_at = now() - interval '15 days' where id = $1`, [second]);
    expect((await alex.q(`select public.refresh_loan_reminders() as n`))[0]!.n).toBe(1);
    expect((await maddox.q(`select public.refresh_loan_reminders() as n`))[0]!.n).toBe(0); // already reminded this week
    expect(await alex.q(`select title from public.notifications where kind = 'loan_reminder'`)).toEqual([{ title: 'You still have Lendable' }]);
    expect(await maddox.q(`select title from public.notifications where kind = 'loan_reminder'`)).toEqual([{ title: 'Alex still has Lendable' }]);
    await maddox.q(`select public.return_loan($1)`, [second]);
  });

  it('lets a request be declined or canceled', async () => {
    const asked = (await sam.q(`select public.request_loan($1) as id`, [copyId]))[0]!.id;
    await sam.q(`select public.cancel_loan_request($1)`, [asked]);
    const again = (await sam.q(`select public.request_loan($1) as id`, [copyId]))[0]!.id;
    await maddox.q(`select public.decide_loan($1, false)`, [again]);
    const statuses = await sam.q(`select status from public.loans where id in ($1, $2) order by requested_at`, [asked, again]);
    expect(statuses.map((s) => s.status)).toEqual(['canceled', 'declined']);
  });
});

describe('wishlist and gift claims', () => {
  let albumId: string, itemId: string;

  beforeAll(async () => {
    ({ albumId } = await addAlbum(maddox, 'Wanted', 2));
    itemId = (await maddox.q(`insert into public.wishlist_items (album_id) values ($1) returning id`, [albumId]))[0]!.id;
  });

  it('shows a wishlist to the family and not to outsiders', async () => {
    expect(await sam.q(`select user_name, title from public.wishlist_view where item_id = $1`, [itemId])).toEqual([{ user_name: 'Maddox', title: 'Wanted' }]);
    expect(await olive.q(`select * from public.wishlist_view where item_id = $1`, [itemId])).toEqual([]);
  });

  it('lets a family member claim an item, visible to the rest of the family', async () => {
    await sam.q(`select public.claim_wishlist_item($1)`, [itemId]);
    const seen = await alex.q(`select claimer_name from public.wishlist_view where item_id = $1`, [itemId]);
    expect(seen).toEqual([{ claimer_name: 'Sam' }]);
    expect(await alex.fails(`select public.claim_wishlist_item($1)`, [itemId])).toContain('already_claimed');
  });

  it('NEVER shows the claim to the person it is for', async () => {
    expect(await maddox.q(`select * from public.wishlist_claims`)).toEqual([]);
    expect(await maddox.q(`select count(*)::int as n from public.wishlist_claims`)).toEqual([{ n: 0 }]);
    const view = await maddox.q(`select claim_id, claimer_id, claimer_name, claim_expires_at from public.wishlist_view where item_id = $1`, [itemId]);
    expect(view).toEqual([{ claim_id: null, claimer_id: null, claimer_name: null, claim_expires_at: null }]);
    expect(await maddox.q(`select public.can_see_claims_on($1) as can`, [itemId])).toEqual([{ can: false }]);
    // No notification about it either.
    expect(await maddox.q(`select * from public.notifications where kind like 'claim%'`)).toEqual([]);
    // And an outsider sees nothing.
    expect(await olive.q(`select * from public.wishlist_claims`)).toEqual([]);
  });

  it('gives the wisher no way to probe for or tamper with a claim', async () => {
    // Claiming your own item fails exactly like a missing item does.
    const own = await maddox.fails(`select public.claim_wishlist_item($1)`, [itemId]);
    const missing = await maddox.fails(`select public.claim_wishlist_item(gen_random_uuid())`);
    expect(own).toBe(missing);
    expect(await maddox.fails(`insert into public.wishlist_claims (item_id, claimer_id) values ($1, $2)`, [itemId, maddoxId])).toContain('permission denied');
    await maddox.q(`delete from public.wishlist_claims where item_id = $1`, [itemId]);
    expect(await alex.q(`select claimer_name from public.wishlist_view where item_id = $1`, [itemId])).toEqual([{ claimer_name: 'Sam' }]);
  });

  it('can be canceled by the person who made it, and nobody else', async () => {
    await alex.q(`delete from public.wishlist_claims where item_id = $1`, [itemId]);
    expect(await sam.q(`select * from public.wishlist_claims where item_id = $1`, [itemId])).toHaveLength(1);
    await sam.q(`delete from public.wishlist_claims where item_id = $1`, [itemId]);
    expect(await alex.q(`select * from public.wishlist_claims where item_id = $1`, [itemId])).toEqual([]);
  });

  it('expires after one month, after which someone else can claim', async () => {
    await sam.q(`select public.claim_wishlist_item($1)`, [itemId]);
    const claim = await sam.q(`select expires_at - created_at = interval '1 month' as one_month from public.wishlist_claims where item_id = $1`, [itemId]);
    expect(claim).toEqual([{ one_month: true }]);
    await db.query(`update public.wishlist_claims set created_at = now() - interval '5 weeks', expires_at = now() - interval '1 day' where item_id = $1`, [itemId]);
    expect(await alex.q(`select claimer_name from public.wishlist_view where item_id = $1`, [itemId])).toEqual([{ claimer_name: null }]);
    await alex.q(`select public.claim_wishlist_item($1)`, [itemId]);
    expect(await sam.q(`select claimer_name from public.wishlist_view where item_id = $1`, [itemId])).toEqual([{ claimer_name: 'Alex' }]);
  });

  it('tells the claimer, and only the claimer, when the wisher takes a claimed item off the list', async () => {
    const { albumId: dropped } = await addAlbum(maddox, 'Dropped', 1);
    const item = (await maddox.q(`insert into public.wishlist_items (album_id) values ($1) returning id`, [dropped]))[0]!.id;
    await sam.q(`select public.claim_wishlist_item($1)`, [item]);
    await maddox.q(`delete from public.wishlist_items where id = $1`, [item]);
    expect(await sam.q(`select title from public.notifications where kind = 'claim_cleared'`)).toEqual([{ title: 'Maddox took Dropped off their wishlist' }]);
    expect(await maddox.q(`select * from public.notifications where kind = 'claim_cleared'`)).toEqual([]);
  });

  it('comes off the wishlist when the wisher adds a copy, telling only the claimer', async () => {
    await addCopy(maddox, albumId);
    expect(await maddox.q(`select * from public.wishlist_items where album_id = $1`, [albumId])).toEqual([]);
    const claims = await db.query(`select 1 from public.wishlist_claims where item_id = $1`, [itemId]);
    expect(claims.rows).toEqual([]);
    expect(await alex.q(`select title from public.notifications where kind = 'claim_cleared'`)).toEqual([{ title: 'Maddox now has Wanted' }]);
    expect(await maddox.q(`select * from public.notifications where kind = 'claim_cleared'`)).toEqual([]);
  });

  it('keeps wishlists personal: one entry per album, and only your own', async () => {
    const { albumId: other } = await addAlbum(sam, 'WantedToo', 1);
    await sam.q(`insert into public.wishlist_items (album_id) values ($1)`, [other]);
    expect(await sam.fails(`insert into public.wishlist_items (album_id) values ($1)`, [other])).toContain('duplicate key');
    expect(await sam.fails(`insert into public.wishlist_items (user_id, album_id) values ($1, $2)`, [maddoxId, other])).toContain('row-level security');
    await maddox.q(`delete from public.wishlist_items where user_id = $1`, [samId]);
    expect(await sam.q(`select 1 as ok from public.wishlist_items where album_id = $1`, [other])).toHaveLength(1);
  });
});

describe('listening history', () => {
  let albumId: string;

  beforeAll(async () => {
    ({ albumId } = await addAlbum(maddox, 'Spun', 2));
    await addCopy(maddox, albumId);
  });

  it('counts a listen once per album and belongs to the listener only', async () => {
    await maddox.q(`select public.start_listening($1)`, [albumId]);
    // Sam plays Maddox's record twice.
    await sam.q(`select public.start_listening($1)`, [albumId]);
    await sam.q(`insert into public.listens (album_id, listened_at) values ($1, now() - interval '3 days')`, [albumId]);

    const counts = await alex.q(`select user_id, count(*)::int as n from public.listen_log where album_id = $1 group by user_id`, [albumId]);
    expect(counts.find((c) => c.user_id === maddoxId)!.n).toBe(1);
    expect(counts.find((c) => c.user_id === samId)!.n).toBe(2);
  });

  it('keeps one now-playing session open per person', async () => {
    const { albumId: next } = await addAlbum(maddox, 'SpunNext', 1);
    await maddox.q(`select public.start_listening($1)`, [next]);
    const open = await maddox.q(`select album_id from public.listens where user_id = $1 and source = 'now_playing' and ended_at is null`, [maddoxId]);
    expect(open).toEqual([{ album_id: next }]);
  });

  it('cannot be logged for someone else, changed by someone else, or dated in the future', async () => {
    expect(await sam.fails(`insert into public.listens (user_id, album_id) values ($1, $2)`, [maddoxId, albumId])).toContain('row-level security');
    await sam.q(`delete from public.listens where user_id = $1`, [maddoxId]);
    expect((await maddox.q(`select count(*)::int as n from public.listens where user_id = $1`, [maddoxId]))[0]!.n).toBe(2);
    expect(await maddox.fails(`insert into public.listens (album_id, listened_at) values ($1, now() + interval '3 days')`, [albumId])).toContain('check constraint');
  });

  it('shows listening history to the family and not to outsiders', async () => {
    expect((await alex.q(`select 1 as ok from public.listen_log where user_id = $1`, [maddoxId])).length).toBe(2);
    expect(await olive.q(`select * from public.listen_log where user_id = $1`, [maddoxId])).toEqual([]);
  });
});
