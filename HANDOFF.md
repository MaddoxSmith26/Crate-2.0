# Crate handoff

Written 2026-11-16 at the end of the first build session. Everything described here is on the `crate-build` branch, open as pull request #2 against `main`. `main` holds only a one-line README. Pull request #1 (phase 1 only) was closed as superseded.

Read `CLAUDE.md` too. It holds the working rules (no secrets in code, no pushes to `main`, and so on) and a decision log with the reason for each choice.

---

## 1. Running it from scratch

### What you need

- Node 20 or newer, npm, and git. The owner develops in WSL Ubuntu and tests in a browser on the web target.
- For real use: a free Supabase account and one new Supabase project, used only for Crate. To try the app with no account at all, use the local backend in Option A instead.
- No other keys. MusicBrainz, the Cover Art Archive and Wikipedia need no account or key.

### Get the code

```bash
git clone https://github.com/MaddoxSmith26/Crate-2.0.git crate-2.0
cd crate-2.0
git checkout crate-build        # until pull request #2 is merged into main
npm install
cp .env.example .env
```

`.env` holds exactly two values and is in `.gitignore`. Never commit it, and never put the `service_role` key anywhere in this app.

```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

Expo inlines these at start-up, so restart the dev server after editing `.env`. If they are empty, the app opens on a setup screen that says so.

### Option A: try it locally, no account

`tools/local-backend/server.mjs` runs the real migrations in an in-process Postgres (PGlite) and answers the part of the Supabase API the app uses. It is for development only: passwords are stored in plain text and tokens are not signed.

1. Put these in `.env`:
   ```
   EXPO_PUBLIC_SUPABASE_URL=http://localhost:54321
   EXPO_PUBLIC_SUPABASE_ANON_KEY=local
   ```
2. Terminal 1: `npm run local-backend`. Data is lost when it stops unless you start it with `CRATE_LOCAL_DATA=.local-data npm run local-backend`.
3. Terminal 2: `npm run web`. The app is at http://localhost:8081.

### Option B: real Supabase

1. Create a new project at supabase.com.
2. In the project's API settings, copy the **Project URL** into `EXPO_PUBLIC_SUPABASE_URL` and the **anon** (publishable) key into `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
3. In the SQL Editor, run each file in `supabase/migrations/` in number order, `0001` to `0006`, one at a time. Each should report success. (`supabase db push` with the Supabase CLI does the same.)
4. Under Authentication, in the Email provider settings, turn off "Confirm email" so family accounts work immediately. If you leave it on, new users must click the emailed link before signing in, and the link's redirect goes to the project's Site URL, which you would also need to set.
5. Start it: `npm run web`.

**This path has never been run.** All testing so far used PGlite and the local backend. See section 6.

### Checks

| Command | What it does |
|---|---|
| `npm test` | 148 tests: 104 for logic modules in `src/domain/`, 44 database rule tests in `tests/db/` |
| `npm run typecheck` | TypeScript, strict |
| `npm run build:web` | Static web build into `dist/` |
| `python3 tools/e2e/run.py` | Browser walk-through as two people (setup below) |

The end-to-end script needs Python with Playwright, Chrome (path in `CHROME`, default `/usr/bin/google-chrome`), a web build pointed at the local backend, a fresh local backend, and a static server:

```bash
EXPO_PUBLIC_SUPABASE_URL=http://localhost:54321 EXPO_PUBLIC_SUPABASE_ANON_KEY=local npm run build:web
npm run local-backend &            # start it fresh for each run
npx serve dist -l 4173 -s &
python3 tools/e2e/run.py           # screenshots go to /tmp/shots, or set SHOTS
```

It replaces MusicBrainz, the Cover Art Archive and Wikipedia with canned responses shaped like the real ones.

---

## 2. Stack and data sources

| Piece | Choice | Why |
|---|---|---|
| App | Expo SDK 58 (React Native) with TypeScript strict and Expo Router | One codebase for the browser now and phones later. Screens are files in `src/app/` |
| Backend | Supabase: email and password auth, Postgres | Access rules live in the database as Row Level Security, so they hold even if the app has a bug |
| Album search, year, tracklists, genres, song credits | MusicBrainz web service, `https://musicbrainz.org/ws/2/` | Free, no key, and its "release group" is exactly Crate's "album": one work, however many pressings |
| **Album covers** | **Cover Art Archive**, `https://coverartarchive.org/release-group/<release group id>/front-500` | Free, no key, keyed by the same MusicBrainz ID. The URL is stored on the album row and loaded straight by the browser. Albums without art in the archive, and every manually entered album, show a plain coloured placeholder sleeve with the title |
| Song background | Wikipedia search API, fetched from the browser | Free, no key. Shown only when the article title matches the song |
| Lyrics | Not shown or stored. A button opens a Genius search | The brief says to link out to a licensed lyrics site |
| Tests | Vitest; PGlite (Postgres compiled to WebAssembly) for database tests | The real migrations and policies run inside the test process with no external database |

Not used: Discogs and Spotify (both need keys and were not needed for this version).

MusicBrainz asks for at most about one request per second. `src/lib/musicbrainz.ts` queues every call with a 1.1 second gap and retries a 503 once.

### Code layout

```
src/app/          Screens. (tabs)/ holds Collection, Ranking, Play, Wishlist, Family.
                  Also add, add-manual, album/[id], member/[id], track/[id], compare, notifications, sign-in.
src/components/   Cover, AlbumGrid, AlbumRow, RatingPicker, SaveAlbumPanel, StatsBlock, ui.tsx
src/domain/       Pure logic with tests beside it (ratings, normalize, duplicates, musicbrainz,
                  manualEntry, nowPlaying, stats, suggest, background)
src/lib/          supabase.ts (client), api.ts (every database call), musicbrainz.ts (throttled fetch),
                  auth.tsx, useLoad.ts, ranking.ts
supabase/migrations/   0001 to 0006
tests/db/         Database rule tests; tests/support/ has the PGlite setup and a Supabase stub
tools/            local-backend/ and e2e/
```

All Supabase access goes through `src/lib/api.ts`. Reads use views; multi-step changes call database functions.

---

## 3. Data model

Every table has Row Level Security on (a test checks this). Migration `0006_grants.sql` revokes everything and then grants only what the app uses; nothing is granted to signed-out users. "Family" below means people who share a group with you, as decided by `shares_group_with()`.

### Tables

**`profiles`** (0001). One per account, created by a trigger on `auth.users` at sign-up.
`id` (= auth user id), `display_name` (1 to 40 chars), `created_at`.
Read: yourself and family. Write: your own `display_name` only. Email lives only in Supabase auth.

**`groups`** (0001). A family group.
`id`, `name`, `join_code` (6 characters from an alphabet without 0, O, 1, I; unique), `created_by`, `created_at`.
Read: members only. Created, joined and left only through `create_group`, `join_group`, `leave_group`. A group is deleted when its last member leaves.

**`group_members`** (0001). `group_id`, `user_id`, `joined_at`.
A unique index allows **one group per person**. Read: members of that group. No direct writes.

**`albums`** (0002). The shared catalog. One row per musical work, for **all users of the Supabase project**, not per family.
`id`, `mbid` (MusicBrainz release group id, unique, null for manual entries), `title`, `artist`, `year`, `cover_url` (must start with `https://coverartarchive.org/`), `album_key` (normalized `artist::title`, computed in `src/domain/normalize.ts`), `genres` (text array from MusicBrainz), `is_manual`, `created_by`, `created_at`.
Read: any signed-in user. Written only by `upsert_album`, which returns the existing album when the `mbid` (or, for manual entries, the `album_key`) is already there.

**`tracks`** (0002). `id`, `album_id`, `disc`, `position`, `title`, `length_ms`, `recording_mbid`. Unique on (album, disc, position).
Read: any signed-in user. Written only by `upsert_album`, once, when the album is first added.

**`copies`** (0002). A physical record someone owns.
`id`, `owner_id`, `album_id`, `pressing_note` (up to 120 chars), `added_at`, `removed_at` (soft delete).
Read: owner and family. Insert: your own. Update: only `pressing_note` and `removed_at`, on your own. No delete. A trigger refuses to remove a copy that is lent out and declines any open requests for it. Another trigger deletes the owner's wishlist item for that album on insert.

**`track_marks`** (0002). One person's mark on one track.
Primary key (`user_id`, `track_id`); `rating` numeric(3,1) between 1.0 and 10.0, `is_interlude`, `updated_at`. A check forbids a rating on an interlude.
Read: yourself and family. Insert, update, delete: your own, and only while `can_rate_album()` is true (you own an unremoved copy or are borrowing one).

**`notifications`** (0003). In-app only.
`id`, `user_id`, `kind` (`loan_requested`, `loan_approved`, `loan_declined`, `loan_returned`, `loan_reminder`, `claim_cleared`), `title`, `body`, `data` (album and loan ids), `created_at`, `read_at`.
Read and delete: your own. Update: only `read_at`. Created only by database functions and triggers.

**`loans`** (0003). A borrow request and its life.
`id`, `copy_id`, `owner_id`, `borrower_id`, `status` (`requested`, `approved`, `declined`, `returned`, `canceled`), `requested_at`, `decided_at`, `returned_at`, `last_reminded_at`.
Unique indexes: one approved loan per copy, one open request per copy per borrower.
Read: the two people involved; the owner's family can also see approved loans (so the shared collection can say who has a record). Changed only through `request_loan`, `decide_loan`, `return_loan`, `cancel_loan_request`, `refresh_loan_reminders`.

**`wishlist_items`** (0004). `id`, `user_id`, `album_id`, `note`, `added_at`; unique per person per album.
Read: owner and family. Insert and delete: your own. Update: only `note`.

**`wishlist_claims`** (0004). "I'm getting this."
`id`, `item_id` (unique: one claim per item), `claimer_id`, `created_at`, `expires_at` (created plus one month).
Read: only people who share a group with the wisher **and are not the wisher**, and only while unexpired. Insert: only via `claim_wishlist_item`, which refuses the wisher with the same error as a missing item. Delete: only the claimer. No update.

**`listens`** (0005). One play of one album by one person.
`id`, `user_id`, `album_id`, `listened_at`, `source` (`now_playing` or `manual`), `ended_at`, `created_at`. A check refuses `listened_at` more than a day in the future.
Read: yourself and family. Insert and delete: your own. Update: only `ended_at` and `listened_at`, your own.

### Views

All are `security_invoker`, so they apply the caller's policies.

| View | Purpose |
|---|---|
| `album_scores` | Per person per album they have marked: countable, rated and interlude track counts, average rating, status (`not_started`, `in_progress`, `complete`). Mirrors `albumProgress()` in `src/domain/ratings.ts`; a test checks they agree |
| `album_marks` | Marks joined to their album, for loading one album's ratings |
| `collection_items` | Unremoved copies with album details, owner name, and who has it if lent |
| `owned_albums` | Per person per album: active and removed copy counts, for duplicate checks |
| `loan_details` | Loans with names and album details |
| `shelf_items` | What a person has right now: owned and not lent out, plus approved borrows. "What to play next" reads only this |
| `wishlist_view` | Wishlist rows with album details and the claim columns, which are always null on your own list |
| `listen_log` | Listens with album details |

### Database functions

`create_group`, `join_group`, `leave_group`, `upsert_album`, `request_loan`, `decide_loan`, `return_loan`, `cancel_loan_request`, `refresh_loan_reminders`, `claim_wishlist_item`, `start_listening`. Helpers used by policies: `is_group_member`, `shares_group_with`, `can_rate_album`, `can_rate_track`, `can_see_claims_on`. Internal only (not callable by the app): `handle_new_user`, `generate_join_code`, `notify`, `my_name`, `loan_album_title`, and the trigger functions.

---

## 4. Feature status against the original description

"Tested" means covered by unit or database tests and walked through in the end-to-end browser run against the local backend. Nothing has run against a real Supabase project.

### What Crate is / who it is for

| Item | Status |
|---|---|
| One account per person, own collection, wishlist, ratings | Done and tested |
| Visual, covers front and centre, record-store feel | Done. Dark warm theme, cover grids. Real covers were only checked outside the app (see section 6) |
| No pricing, value or resale | Done (none exists) |
| Friends later | Not started. Only family groups, one per person |

### Core ideas

| Item | Status |
|---|---|
| Album = the work; copy = a physical record; two pressings = two copies of one album | Done and tested |
| Every rating, ranking, listen and wishlist belongs to one person; nobody changes another's numbers | Done and tested in the database |

### Adding records

| Item | Status |
|---|---|
| Search by artist and album; Crate fills cover, year, full tracklist | Done and tested (live MusicBrainz checked separately in a browser) |
| Results show original vs live, deluxe, remastered, compilation | Done, with a caveat: live and compilation come from MusicBrainz types; deluxe and remastered usually live inside the original's release group, so they show up in an edition picker on the confirm screen rather than as separate search results. A release group whose title says "Deluxe" or "Remastered" is labelled as such |
| Shows exactly what it is about to add | Done and tested |
| Already own it: says so, offers only "another pressing" | Done and tested in the app. **Not enforced in the database** (section 5) |
| "The Dark Side of the Moon" equals "Dark Side of the Moon" | Done and tested |
| Manual entry when not found | Done and tested. Manual albums get no cover and no genres |

### My collection

| Item | Status |
|---|---|
| Grid of my records with covers | Done and tested |
| Album page with cover, artist, year, tracklist, my ratings | Done and tested |
| Remove a record, keep ratings and listens | Done and tested |

### Ratings

| Item | Status |
|---|---|
| 1.0 to 10.0 in 0.1 steps per track | Done and tested. The database rounds off-step values instead of refusing them (section 5) |
| Personal interludes: greyed out, unrated, not counted | Done and tested |
| Album rating = average of non-interlude tracks | Done and tested; app and database agree |
| In progress until every non-interlude track is rated, then Complete | Done and tested |

### My ranking

| Item | Status |
|---|---|
| Complete albums by rating, highest first | Done and tested. Equal scores share a rank |
| In-progress albums excluded | Done and tested (shown separately below the ranking) |
| Albums rated while borrowing stay after return | Done and tested |

### Family groups

| Item | Status |
|---|---|
| Create a group, get a join code, others join with it | Done and tested |
| Shared collection with whose each record is | Done and tested |
| No combined ranking; view and compare rankings side by side | Done and tested (compare screen and member pages) |

### Borrowing

| Item | Status |
|---|---|
| Request; owner approves or declines | Done and tested |
| Greyed out in owner's collection, shows who has it | Done and tested |
| Borrower can rate while they have it | Done and tested |
| Reminders in-app only | Partly done. Reminders exist but are only created when either person opens the app (no scheduler). After 14 days, then at most weekly |

### Wishlist and gifts

| Item | Status |
|---|---|
| Personal wishlist | Done and tested |
| Comes off automatically when I add a copy | Done and tested |
| Family can mark "I'm getting this" | Done and tested |
| Claim never visible to the wisher | Done and tested in the database and in the browser. See section 5 for what this does not cover |
| Claim can be canceled | Done and tested |
| Expires after one month "if nothing happens" | Partly done. Every claim expires one month after it was made. There is no "bought" or "given" state, so nothing can "happen" to stop it expiring, and the claimer is not told when it expires |

### Now playing and listening history

| Item | Status |
|---|---|
| Tap to start; shows the probable current song from track lengths | Done and tested. Ignores time spent flipping the record. Shown on the Play tab only |
| One listen per album, not per side | Done in the sense that there is no per-side listen. Tapping Play twice records two listens (section 5) |
| Log a listen after the fact with a date | Done and tested. Typed as YYYY-MM-DD, no date picker |
| Listens belong to the listener; borrowed plays count for the borrower | Done and tested |
| All-time counts, most-listened record and artist, yearly recap that does not reset totals | Done and tested. Computed in the browser from all of a person's listens |
| Family can see each other's stats | Done and tested (member page) |

### What to play next

| Item | Status |
|---|---|
| Short list only from records I have now, including borrowed, excluding lent out | Done and tested (database view plus logic tests) |
| Pick a mood and suggestions change | Done and tested. Moods are approximate: they use crowd-sourced MusicBrainz genres plus your own ratings and listens. Manual albums only appear in moods that do not need genres |

### Song details (later phase)

| Item | Status |
|---|---|
| Credits: writers, players, producers | Partly done. Fetched live from MusicBrainz on the song page; only for albums added by search; depends on MusicBrainz having the data; not cached |
| Background on what the song is about | Partly done. Wikipedia summary when an article clearly matches the song, otherwise "No background found". Not cached |
| Lyrics never shown or stored; button links out | Done. Opens a Genius search |

### What a great result looks like

| Item | Status |
|---|---|
| Sign in, add a real album by search, real cover and tracklist, rate, see it join the ranking | Done against the local backend with canned album data. Real album data checked separately. **Not yet done end to end on real Supabase with live covers** |
| Rules enforced, especially who can see what | Mostly; exceptions in section 5 |
| Looks good, album art carries the design | Done to a first pass; judged from screenshots with placeholder covers |
| Plan first, core first, family after | Done |

---

## 5. Rules from the description that are NOT fully enforced

Each item below was confirmed against the real migrations unless it says otherwise.

### Who can see what

1. **The album catalog is visible across families.** `albums` and `tracks` are readable by every signed-in user of the Supabase project, not just your family, including `albums.created_by` (a user id, not a name). Anyone who signs up can therefore see which albums exist in Crate and that some account added each one. They cannot see whose collection or wishlist an album is in.

2. **Anyone can sign up, and the join code is the only gate to a family.** Sign-ups are open (Supabase default). Anyone given the code can join and immediately see the whole family's collections, ratings, wishlists, listening, and every gift claim except those on their own wishlist. Codes never expire or rotate, members cannot be removed, and `join_group` has no rate limit against guessing (about a billion possible codes).

3. **Gift claims: what is and is not covered.**
   - Enforced: the wisher cannot read a claim on their own items through the claims table, the wishlist view, a count, an error message, or a notification. Claiming your own item fails exactly like claiming a missing one. Only the claimer can cancel. Outsiders see nothing. All tested.
   - Not covered: the wisher can read claims on **other** members' wishlists, which is intended. If the wisher made a second account and joined the family with it, that account could see claims on the wisher's list. Nothing prevents this.
   - Not covered: expiry is fixed at one month from creation (see section 4). Expired claim rows are not deleted; the policy hides them and a new claim replaces them.

4. **Leaving a group does not clean anything up.** Confirmed:
   - A borrower who leaves keeps the approved loan and **can still rate the album**, because `can_rate_album` only checks the loan.
   - The owner's collection still marks the record as lent, but the borrower's name comes back empty, and the loan disappears from the owner's Family tab, because `loan_details` uses inner joins on profiles the owner can no longer read. The owner can still mark it returned from the album page.
   - Claims made by the leaver stay in place and block others from claiming those items. Other members see them with an empty claimer name.

### Data rules enforced only in the app

5. **Duplicate copies.** "Already own it" and "only offer a second copy if it is really another pressing" are checked in `SaveAlbumPanel`. The database accepts any number of copies of the same album from the same person, with or without a pressing note.

6. **Ratings in 0.1 steps.** `numeric(3,1)` rounds values like 7.25 to 7.3 instead of refusing them. The app only ever sends legal values.

7. **The catalog trusts the client.** `upsert_album` takes `album_key`, title, artist, year, genres and the tracklist from the caller. The first person in the whole project to add an album decides its tracklist, title spelling and year for everyone, and there is no way to correct them.

8. **One canonical album per work is not guaranteed.** If a manual entry of an album exists and someone later adds the same album by search, the catalog gets two rows for one work. Each person's own duplicate check still catches it, but two family members can end up with different album ids for the same record, which splits the shared collection and makes Compare treat them as different albums.

9. **Listens.**
   - Pressing Play now twice for the same album records two listens.
   - Anyone can log a listen of any album in the catalog, including records they neither own nor are borrowing. The brief does not forbid this, but it is not checked.
   - The future-date check allows up to one day ahead (the app refuses any future date).

10. **Rating after removal (stricter than the brief).** You cannot change or add ratings on an album once your copy is removed and you are not borrowing it. Existing ratings and ranking positions are kept. This is an interpretation, recorded in `CLAUDE.md`; loosen `can_rate_album` if the owner disagrees.

11. **Reminders depend on someone opening the app.** No job runs on its own.

---

## 6. Known bugs and shortcuts

### Bugs

- **Empty names after someone leaves the family.** Album page shows "Lent to null"; collection grid caption reads "With " with no name; the wishlist shows "null is getting this" for a claim made by someone who left. Cause in section 5, item 4.
- **Loans with a former member vanish from the Family tab** (inner joins in `loan_details`).
- **Notification badge only refreshes on navigation.** There is no realtime subscription.
- **"Now playing" is only visible on the Play tab,** and an open session is closed silently when the Play tab next loads after the album should have ended (30 minutes after, or 3 hours if track lengths are missing).
- **The end-to-end script must run against a freshly started local backend.** It failed once on a stale backend and passed on a fresh one.

### Shortcuts and untested areas

- **Never run against real Supabase.** Likely trouble spots: the `on_auth_user_created` trigger on `auth.users`, the email confirmation flow and its redirect, and any PostgREST behaviour the local backend imitates differently (error shapes, `upsert`, `maybeSingle`).
- **Real covers never seen inside the app.** The end-to-end run blocked cover art. A browser check confirmed the Cover Art Archive URL for Rumours returns a 250 by 250 JPEG, and live MusicBrainz and Wikipedia responses matched the parsers.
- **Web only.** iOS and Android were never built. `Linking.openURL` for Wikipedia and Genius links was not checked on any platform.
- **No account basics:** no password reset, no email change, no account deletion, no sign-in rate limiting beyond Supabase's own.
- **No catalog editing:** no way to fix a tracklist, year, or cover, or add a cover to a manual album.
- **No pagination.** Collections, listens and wishlists are loaded whole; stats are computed in the browser. Fine for a family, slow for large libraries. The album page loads all of your listens, loans and wishlist to draw one album.
- **Song credits and background are fetched every time** and not cached.
- **Stats use the viewer's time zone** to decide which year a listen belongs to.
- **Artist stats group by the credit string,** so "Simon & Garfunkel" and "Paul Simon" are different artists.
- **Linting is not set up.** There are `eslint-disable` comments but no ESLint config, and `npx expo lint` was never run.
- **Package versions were pinned by hand** from `node_modules/expo/bundledNativeModules.json`, because `npx expo install` could not reach Expo's compatibility service from the build environment. `npx expo-doctor` has not been run. `npm audit` warnings were left alone.
- **`tools/local-backend` is a partial imitation of Supabase:** only the filters, ordering, upserts and RPC calls the app uses. Keep client queries simple (plain filters, no nested selects) or extend it.

---

## 7. Next five things to build, in order

Each is sized for one session.

1. **Run it on a real Supabase project and fix what breaks.** Create the project, apply `0001` to `0006`, turn off email confirmation, sign up two accounts, and go through the end-to-end script's steps by hand with live MusicBrainz and real covers. Fix any differences from the local backend, and note the result in the README. Nothing else should be trusted until this passes.

2. **Make leaving a group safe.** In `leave_group`: decline the leaver's open requests and requests for their records, cancel their claims and the claims on their wishlist, and either return or block leaving with approved loans in either direction. Switch `loan_details` to left joins and show "a former member" instead of empty names. Add rule tests for each case.

3. **Move the remaining data rules into the database.** Refuse off-step ratings (`rating * 10 = round(rating * 10)`). Add an `add_copy` function that requires a pressing note when you already have an active copy, and grant insert on `copies` only through it. Ignore a second `start_listening` for the same album while its session is still open. Add rule tests.

4. **Family group safety.** Let the group creator rotate the join code and remove a member (with the same cleanup as item 2), and slow down repeated failed `join_group` attempts. Hide `albums.created_by` from the app (column grants or a view).

5. **Account recovery.** Add "Forgot password" on the sign-in screen using Supabase's reset email, and a page to set the new password. Document the Site URL and redirect settings in the README. This is the first thing a family member will need once real data exists.

After those: one canonical catalog row per work (merge manual entries into searched ones), catalog corrections, a "bought it" state for gift claims, a now-playing bar on every tab, and a background job for reminders.
