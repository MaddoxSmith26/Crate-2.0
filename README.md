# Crate

A home for a family's vinyl record collection. Each person tracks the records they own, rates them song by song, builds a personal ranking, and shares their collection with the family.

Pricing, collection value, and resale are not part of Crate.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Scaffold, tested logic modules, docs | Done |
| 2 | Accounts, core tables, security policies | Next |
| 3 | Search, confirm screen, duplicate check, manual entry | |
| 4 | Collection grid and album page | |
| 5 | Ratings, interludes, ranking | |
| 6 | Family groups, shared collection, ranking comparison | |
| 7 | Borrowing and in-app notifications | |
| 8 | Wishlist and hidden gift claims | |
| 9 | Now playing, listens, stats, yearly recap | |
| 10 | What to play next, with moods | |
| 11 | Song details and lyrics link-out | |

## Stack and why

- **Expo (React Native) with TypeScript.** One codebase runs in the browser today and on phones later. Routing is Expo Router, with screens in `src/app/`.
- **Supabase (auth and Postgres).** The "who can see what" rules live in the database as Row Level Security policies, so they hold even if the app has a bug. Schema changes are versioned SQL migrations.
- **MusicBrainz** for search, release year, and tracklists. It is free, needs no key, and its "release group" matches Crate's idea of an album: one work, however many pressings.
- **Cover Art Archive** for covers. It is free, needs no key, and uses the same MusicBrainz IDs.
- **Vitest** for unit tests of the logic modules.

## Setup

You need Node 20 or newer.

```bash
git clone https://github.com/MaddoxSmith26/Crate-2.0.git
cd Crate-2.0
npm install
cp .env.example .env
```

Then open `.env` and paste in your own Supabase values:

1. Create a free project at [supabase.com](https://supabase.com). Use a new project, separate from any other app.
2. In the project, open the API settings page.
3. Copy the **Project URL** into `EXPO_PUBLIC_SUPABASE_URL`.
4. Copy the **anon** key (also shown as the publishable key) into `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

`.env` is in `.gitignore` and must never be committed. Do not use the `service_role` key anywhere in this app.

Run it:

```bash
npm run web
```

## Commands

| Command | What it does |
|---|---|
| `npm run web` | Start the dev server and open the app in a browser |
| `npm test` | Run the unit tests once |
| `npm run test:watch` | Re-run tests as files change |
| `npm run typecheck` | Check TypeScript types |
| `npm run build:web` | Build the static web app into `dist/` |

## Project layout

```
src/
  app/        Screens (Expo Router). Every file here is a route.
  domain/     Pure logic with unit tests. No network, no UI.
  lib/        Service clients (Supabase).
  theme/      Colors, spacing, type sizes.
```

### Logic modules (`src/domain/`)

| Module | Rules it owns |
|---|---|
| `ratings.ts` | 1.0 to 10.0 in 0.1 steps, interludes, album average, In progress vs Complete, ranking |
| `normalize.ts` | Title and artist matching ("The Dark Side of the Moon" equals "Dark Side of the Moon"), slugs |
| `duplicates.ts` | Already owned, previously owned, or new |
| `musicbrainz.ts` | Search URLs, result labels (Original album, Live, Deluxe, Compilation), default edition, tracklists, cover URLs |
| `nowPlaying.ts` | Which track is probably playing, from track lengths and elapsed time |

## Core ideas

- An **album** is the musical work (a MusicBrainz release group).
- A **copy** is a physical record someone owns. Two pressings are two copies of one album.
- Every rating, ranking, listen, and wishlist belongs to one person. Nothing one person does changes another person's numbers.

See `CLAUDE.md` for working rules and the decision log.
