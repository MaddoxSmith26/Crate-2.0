# CLAUDE.md

Instructions and decisions for AI assistants working on Crate. Read this before changing anything.

## Boundaries

- **Secrets.** Never read, print, or copy `.env`, `~/.ssh`, keys, or tokens. The owner pastes secrets into `.env` himself. Never put a key in code. `.env` stays in `.gitignore`.
- **No sudo.** If a step needs it, give the owner the exact command to run.
- **Never push to `main`.** Work on a feature branch and open a pull request for review.
- **Other projects are off limits.** `smith-6200-project` is a separate graded course project on a dokku server. Never read, modify, or push to it, and never run dokku commands. This app also gets its own Supabase project.
- **Stop when stuck.** If a step fails twice, stop and explain instead of trying a third approach.
- **Plan before building.** Say what a phase will contain before writing it.

## Product rules that must hold

These come from the product brief. Enforce them in the database (Row Level Security), not only in the UI.

- Album vs copy: an album is the release group; a copy is a physical record. Two pressings are two copies of one album.
- Everything personal is per person: ratings, interlude marks, rankings, listens, wishlists.
- Removing a copy is a soft delete (`removed_at`). Ratings and listens are kept.
- Ranking shows Complete albums only and does not depend on ownership. Albums rated while borrowed stay on the ranking after the record goes back.
- A gift claim must never be readable by the person whose wishlist it is on. Keep claims in their own table with no read policy for the wishlist owner. Claims can be canceled and expire after one month.
- Listens belong to the listener only. One listen per album, not per side. All-time counts never reset.
- "What to play next" draws only from records the person currently has: owned and not lent out, plus records they are borrowing.
- Lyrics are never shown or stored. Link out to a licensed lyrics site.
- No pricing, collection value, or resale features.
- Reminders are in-app notifications only. No email or calendar in the first version.

## Technical conventions

- Expo SDK 58, Expo Router, TypeScript strict. Screens live in `src/app/`; keep non-route code out of it.
- Install Expo packages at the versions pinned in `node_modules/expo/bundledNativeModules.json` (this is what `npx expo install` does).
- Business rules go in `src/domain/` as pure functions with unit tests beside them (`*.test.ts`). No network or UI imports there.
- Database changes are versioned SQL migrations in `supabase/migrations/`, with RLS enabled on every table.
- Ratings are stored and computed on 0.1 steps. Do math in whole tenths to avoid float drift.
- MusicBrainz allows about one request per second per client. Throttle calls. No API key is needed for MusicBrainz or the Cover Art Archive.
- Before calling a task done, run `npm test` and `npm run typecheck`.
- Write docs and UI copy without em dashes.

## Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-11-16 | Expo + TypeScript, Supabase, MusicBrainz, Cover Art Archive | One codebase for web and phones; access rules enforced in Postgres; free keyless album data whose release group matches "album" |
| 2026-11-16 | Discogs and Spotify are not integrated | Not needed for the first version; both need keys |
| 2026-11-16 | Album identity is the MusicBrainz release group ID, with a normalized artist and title key as the fallback and safety net | Catches "The Dark Side of the Moon" vs "Dark Side of the Moon" and covers manual entries |
| 2026-11-16 | Default tracklist is the earliest official edition without deluxe or remaster wording, preferring vinyl on a date tie; the confirm screen lets the user switch | MusicBrainz files most deluxe and remastered editions inside the original's release group |
| 2026-11-16 | Live, compilation, and demo labels come from MusicBrainz types, never from title words | Titles mislead ("Live Through This" is a studio album) |
| 2026-11-16 | Album scores display to two decimals; equal scores share a rank | Keeps close albums distinct without inventing an order |
| 2026-11-16 | An album whose tracks are all marked as interludes is never Complete | There is nothing to average |
| 2026-11-16 | Vitest for unit tests instead of jest-expo | The logic modules are plain TypeScript, so a lighter runner is enough |
