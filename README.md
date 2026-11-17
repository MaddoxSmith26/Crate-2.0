# Crate

A home for a family's vinyl record collection. Each person tracks the records they own, rates them song by song, builds a personal ranking, and shares their collection with the family.

Pricing, collection value, and resale are not part of Crate.

## What is built

| Area | What you can do |
|---|---|
| Accounts | Each person signs up with their own email and password |
| Adding records | Search by artist and album, pick the right result (Original album, Live, Deluxe, Compilation), preview exactly what will be saved, or enter an album by hand |
| Duplicates | "The Dark Side of the Moon" and "Dark Side of the Moon" are caught as the same album. A second copy is only added as another pressing |
| Collection | A grid of covers, an album page with tracklist and ratings, soft removal that keeps history |
| Ratings | 1.0 to 10.0 in 0.1 steps per track, personal interludes, In progress and Complete |
| Ranking | Complete albums, best first. Albums rated while borrowed stay after the record goes back |
| Family | Create a group, share a join code, see everyone's records, compare two rankings side by side |
| Borrowing | Ask, approve or decline, greyed out while lent, in-app notifications and reminders |
| Wishlist | Per person, cleared automatically when you add a copy, with gift claims hidden from the wisher |
| Listening | Now playing with a "probably playing" track, logging past listens, all-time stats, yearly recap |
| Play next | Suggestions from records you have right now, with moods |
| Song details | Credits and background per track, and a link out for lyrics |

## Stack and why

- **Expo (React Native) with TypeScript.** One codebase runs in the browser today and on phones later. Routing is Expo Router, with screens in `src/app/`.
- **Supabase (auth and Postgres).** The "who can see what" rules live in the database as Row Level Security policies, so they hold even if the app has a bug. Schema changes are versioned SQL migrations.
- **MusicBrainz** for search, release year, tracklists, genres and credits. It is free, needs no key, and its "release group" matches Crate's idea of an album: one work, however many pressings.
- **Cover Art Archive** for covers. It is free, needs no key, and uses the same MusicBrainz IDs.
- **Wikipedia** for song background, with a link to the article.
- **Vitest and PGlite** for tests. PGlite is a real Postgres that runs inside the test process, so the database rules are tested for real.

## Setup

You need Node 20 or newer.

```bash
git clone https://github.com/MaddoxSmith26/Crate-2.0.git
cd Crate-2.0
npm install
cp .env.example .env
```

### 1. Create the Supabase project

1. Create a free project at [supabase.com](https://supabase.com). Use a new project, separate from any other app.
2. In the project, open the API settings page.
3. Copy the **Project URL** into `EXPO_PUBLIC_SUPABASE_URL` in `.env`.
4. Copy the **anon** key (also shown as the publishable key) into `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `.env`.

`.env` is in `.gitignore` and must never be committed. Do not use the `service_role` key anywhere in this app.

### 2. Create the database tables

In the Supabase dashboard, open the SQL Editor. For each file in `supabase/migrations/`, in number order (`0001` to `0006`), paste the whole file and run it. Each one should finish with "Success".

If you use the Supabase CLI instead, `supabase db push` applies the same files.

### 3. Decide about email confirmation

By default Supabase emails a confirmation link to each new account. That works with Crate: after signing up, confirm by email, then sign in. For a family app you may prefer to turn "Confirm email" off in the dashboard under Authentication, in the email provider settings, so accounts work right away.

### 4. Run it

```bash
npm run web
```

## Commands

| Command | What it does |
|---|---|
| `npm run web` | Start the dev server and open the app in a browser |
| `npm test` | Run all tests once: logic modules and database rules |
| `npm run test:watch` | Re-run tests as files change |
| `npm run typecheck` | Check TypeScript types |
| `npm run build:web` | Build the static web app into `dist/` |
| `npm run local-backend` | Start a local stand-in for Supabase (see below) |

## Project layout

```
src/
  app/          Screens (Expo Router). Every file here is a route.
  components/   Shared pieces: covers, grids, the rating picker, the save panel.
  domain/       Pure logic with unit tests. No network, no UI.
  lib/          Supabase client, data access (api.ts), MusicBrainz client, auth.
  theme/        Colors, spacing, type sizes.
supabase/
  migrations/   The database, as numbered SQL files.
tests/
  db/           Database rule tests (who can see and change what).
  support/      Test database setup.
tools/
  local-backend/  A local stand-in for Supabase, for development and tests.
  e2e/            A browser script that walks through the whole app.
```

### Logic modules (`src/domain/`)

| Module | Rules it owns |
|---|---|
| `ratings.ts` | 1.0 to 10.0 in 0.1 steps, interludes, album average, In progress vs Complete, ranking |
| `normalize.ts` | Title and artist matching, slugs |
| `duplicates.ts` | Already owned, previously owned, same name but different album, or new |
| `musicbrainz.ts` | Search URLs, result labels, default edition, tracklists, covers, genres, credits, lyrics link |
| `manualEntry.ts` | Typed tracklists, years and dates |
| `nowPlaying.ts` | Which track is probably playing |
| `stats.ts` | All-time counts, most-listened record and artist, yearly recap |
| `suggest.ts` | What to play next, by mood, from the shelf only |
| `background.ts` | Picking the right Wikipedia article for a song |

### Database (`supabase/migrations/`)

| File | Contents |
|---|---|
| `0001` | Profiles, family groups, join codes |
| `0002` | Album catalog, copies, track ratings, score and collection views |
| `0003` | Borrowing, in-app notifications, reminders, the shelf view |
| `0004` | Wishlists and gift claims |
| `0005` | Listens and now playing |
| `0006` | Exactly which tables, columns and actions the app may use |

## How the rules are enforced

- **Per person.** Ratings, interludes, listens and wishlists carry their owner's ID, and policies only let you write your own.
- **Family visibility.** You can read another person's records, ratings, wishlist and listens only if you share a family group.
- **Gift claims.** Claims sit in their own table. Its read policy excludes the person the gift is for, so on your own wishlist the claim columns always come back empty. Claims are created through one database function that refuses the wisher, they can be canceled by the person who made them, and they stop counting one month after they are made.
- **Borrowing.** Requests, approvals and returns go through database functions. A record can be out with one person at a time and cannot be removed while it is out.
- **History.** Removing a record sets `removed_at`. Rankings are built from ratings, not ownership, so removed and returned records keep their place.

`tests/db/rules.test.ts` checks each of these by acting as different family members and an outsider.

## Testing without Supabase

`npm run local-backend` starts a small server on `http://localhost:54321` that runs the real migrations in an in-process Postgres and answers the parts of the Supabase API that Crate uses. Point `.env` at it (`EXPO_PUBLIC_SUPABASE_URL=http://localhost:54321`, any text for the key) to try the app with no account anywhere. Data is lost when it stops, unless you set `CRATE_LOCAL_DATA` to a folder name.

It is a development tool only. Passwords are stored in plain text and tokens are not signed. Never use it for real data or expose it to a network.

`tools/e2e/run.py` drives the built app in Chrome against that local backend as two people and checks the whole flow. It needs Python with Playwright.

## Known limits

- **Reminders appear when someone opens the app.** There is no background job in this version. A loan out for 14 days produces a reminder for both people, at most once a week.
- **Moods are approximate.** They use MusicBrainz genres, which are crowd-sourced. Manually entered albums have no genres, so they only appear under Surprise me, Old favorites, Rediscover and Needs a rating.
- **Now playing is an estimate.** It uses track lengths and ignores the time it takes to flip the record.
- **One family group per person.** Friends groups would need the one-group rule in migration `0001` lifted.
- **Manual albums have no cover art.**
- **The first person to add an album sets its tracklist** for the whole family, because an album is shared.

## Core ideas

- An **album** is the musical work (a MusicBrainz release group).
- A **copy** is a physical record someone owns. Two pressings are two copies of one album.
- Every rating, ranking, listen, and wishlist belongs to one person. Nothing one person does changes another person's numbers.

See `CLAUDE.md` for working rules and the decision log.
