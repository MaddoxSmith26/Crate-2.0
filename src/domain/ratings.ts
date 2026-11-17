/**
 * Rating math for Crate.
 *
 * Rules (from the product brief):
 * - A track rating runs from 1.0 to 10.0 in steps of 0.1.
 * - A person can mark a track as an interlude. For that person the track has
 *   no rating and does not count toward the album score.
 * - An album rating is the average of that person's ratings for its
 *   non-interlude tracks.
 * - An album is "in progress" until every non-interlude track is rated, then
 *   it is "complete". Only complete albums appear on a ranking.
 *
 * Everything here is per person: callers pass one person's marks.
 * Ratings are handled as whole tenths internally so 0.1 steps never pick up
 * floating point error (7.1 + 7.2 style drift).
 */

export const MIN_RATING = 1;
export const MAX_RATING = 10;

/** One person's mark on one track: either a rating or an interlude flag. */
export interface TrackMark {
  trackId: string;
  /** 1.0 to 10.0 in 0.1 steps, or null when not rated yet. */
  rating: number | null;
  isInterlude: boolean;
}

export type AlbumStatus = 'not_started' | 'in_progress' | 'complete';

export interface AlbumProgress {
  status: AlbumStatus;
  /** Average of rated non-interlude tracks. Null unless at least one is rated. */
  rating: number | null;
  /** Tracks that count toward the score (not marked as interludes). */
  countableTracks: number;
  /** Countable tracks that have a rating. */
  ratedTracks: number;
  interludeTracks: number;
}

/** Converts a rating to whole tenths, e.g. 7.3 becomes 73. */
export function toTenths(rating: number): number {
  return Math.round(rating * 10);
}

/** True when the value is a legal track rating: 1.0 to 10.0 on a 0.1 step. */
export function isValidRating(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const tenths = Math.round(value * 10);
  if (Math.abs(value * 10 - tenths) > 1e-6) return false; // not on a 0.1 step
  return tenths >= MIN_RATING * 10 && tenths <= MAX_RATING * 10;
}

/** Snaps any number to the nearest legal rating (used by sliders and inputs). */
export function snapRating(value: number): number {
  const clamped = Math.min(MAX_RATING, Math.max(MIN_RATING, value));
  return toTenths(clamped) / 10;
}

/**
 * Works out one person's progress and score for one album.
 *
 * @param trackIds every track on the album
 * @param marks that person's marks; tracks without a mark count as unrated
 */
export function albumProgress(trackIds: readonly string[], marks: readonly TrackMark[]): AlbumProgress {
  const byTrack = new Map(marks.map((m) => [m.trackId, m]));
  let countable = 0;
  let rated = 0;
  let interludes = 0;
  let sumTenths = 0;

  for (const id of trackIds) {
    const mark = byTrack.get(id);
    if (mark?.isInterlude) {
      interludes += 1;
      continue;
    }
    countable += 1;
    if (mark && mark.rating !== null && isValidRating(mark.rating)) {
      rated += 1;
      sumTenths += toTenths(mark.rating);
    }
  }

  const rating = rated > 0 ? sumTenths / rated / 10 : null;
  let status: AlbumStatus;
  if (rated === 0) status = 'not_started';
  // An album where every track is an interlude has nothing to score, so it
  // can never be complete.
  else if (rated === countable) status = 'complete';
  else status = 'in_progress';

  return { status, rating, countableTracks: countable, ratedTracks: rated, interludeTracks: interludes };
}

/** Album scores show two decimals, e.g. "8.47", so close albums stay distinct. */
export function formatAlbumRating(rating: number | null): string {
  return rating === null ? '-' : rating.toFixed(2);
}

/** Track ratings show one decimal, e.g. "8.0". */
export function formatTrackRating(rating: number | null): string {
  return rating === null ? '-' : rating.toFixed(1);
}

export interface RankableAlbum {
  albumId: string;
  title: string;
  artist: string;
  progress: AlbumProgress;
}

export interface RankedAlbum extends RankableAlbum {
  /** 1 is the top spot. Albums with exactly equal scores share a rank. */
  rank: number;
  rating: number;
}

/**
 * Builds one person's ranking: complete albums only, highest score first.
 * Ownership is deliberately not an input. An album rated while borrowed, or
 * since removed from the collection, keeps its place.
 */
export function buildRanking(albums: readonly RankableAlbum[]): RankedAlbum[] {
  const complete = albums.filter(
    (a): a is RankableAlbum & { progress: AlbumProgress & { rating: number } } =>
      a.progress.status === 'complete' && a.progress.rating !== null,
  );

  const sorted = [...complete].sort((a, b) => {
    const diff = b.progress.rating - a.progress.rating;
    if (Math.abs(diff) > 1e-9) return diff;
    return a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title);
  });

  const ranked: RankedAlbum[] = [];
  sorted.forEach((album, index) => {
    const previous = ranked[index - 1];
    const tied = previous !== undefined && Math.abs(previous.rating - album.progress.rating) < 1e-9;
    ranked.push({ ...album, rating: album.progress.rating, rank: tied ? previous.rank : index + 1 });
  });
  return ranked;
}
