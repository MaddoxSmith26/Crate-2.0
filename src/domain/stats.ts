/**
 * Listening stats.
 *
 * Rules from the brief:
 * - A listen counts once per album, not per side.
 * - All-time counts never reset.
 * - A yearly recap looks at one calendar year and never changes all-time totals.
 * - Listens belong to the listener. Callers pass one person's listens.
 */

export interface ListenEntry {
  albumId: string;
  title: string;
  artist: string;
  /** ISO timestamp of when the record was played. */
  listenedAt: string;
}

export interface Tally {
  key: string;
  label: string;
  /** Artist name for album tallies; empty for artist tallies. */
  sublabel: string;
  count: number;
}

export interface ListeningStats {
  totalListens: number;
  distinctAlbums: number;
  distinctArtists: number;
  topAlbums: Tally[];
  topArtists: Tally[];
  /** Most-listened record, or null with no listens. */
  topAlbum: Tally | null;
  /** Most-listened artist, or null with no listens. */
  topArtist: Tally | null;
}

function tally(entries: readonly ListenEntry[], by: 'album' | 'artist'): Tally[] {
  const map = new Map<string, Tally>();
  for (const entry of entries) {
    const key = by === 'album' ? entry.albumId : entry.artist.trim().toLowerCase();
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else {
      map.set(key, {
        key,
        label: by === 'album' ? entry.title : entry.artist,
        sublabel: by === 'album' ? entry.artist : '',
        count: 1,
      });
    }
  }
  // Highest count first; ties in alphabetical order so the result is stable.
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Stats over any set of listens (all-time when given everything). */
export function computeStats(entries: readonly ListenEntry[], topN = 5): ListeningStats {
  const albums = tally(entries, 'album');
  const artists = tally(entries, 'artist');
  return {
    totalListens: entries.length,
    distinctAlbums: albums.length,
    distinctArtists: artists.length,
    topAlbums: albums.slice(0, topN),
    topArtists: artists.slice(0, topN),
    topAlbum: albums[0] ?? null,
    topArtist: artists[0] ?? null,
  };
}

/** The calendar year of a listen, in the viewer's local time. */
export function listenYear(listenedAt: string): number {
  return new Date(listenedAt).getFullYear();
}

/** Years that have at least one listen, newest first. */
export function yearsWithListens(entries: readonly ListenEntry[]): number[] {
  return [...new Set(entries.map((e) => listenYear(e.listenedAt)))].sort((a, b) => b - a);
}

export interface YearRecap extends ListeningStats {
  year: number;
  /** Listens per month, January first (12 numbers). */
  byMonth: number[];
  /** Index 0 to 11 of the busiest month, or null with no listens. */
  busiestMonth: number | null;
}

/** A year in review. It filters; it never changes or resets anything. */
export function yearRecap(entries: readonly ListenEntry[], year: number, topN = 5): YearRecap {
  const inYear = entries.filter((e) => listenYear(e.listenedAt) === year);
  const byMonth = Array.from({ length: 12 }, () => 0);
  for (const entry of inYear) {
    const month = new Date(entry.listenedAt).getMonth();
    byMonth[month] = (byMonth[month] ?? 0) + 1;
  }
  const max = Math.max(...byMonth);
  return {
    ...computeStats(inYear, topN),
    year,
    byMonth,
    busiestMonth: max > 0 ? byMonth.indexOf(max) : null,
  };
}

/** Listen counts per album, for badges and for play-next scoring. */
export function countsByAlbum(entries: readonly ListenEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.albumId, (counts.get(entry.albumId) ?? 0) + 1);
  return counts;
}
