/**
 * "What to play next."
 *
 * Rule from the brief: suggestions come only from records the person
 * currently has. That includes records they are borrowing and excludes
 * records they have lent out. The caller passes that shelf; this module only
 * ranks it, so it cannot suggest anything else.
 *
 * Moods come from two kinds of signal:
 * - genre words (from MusicBrainz genres, which are crowd-sourced and rough)
 * - the person's own history: ratings and listens
 */

export interface ShelfRecord {
  albumId: string;
  title: string;
  artist: string;
  genres: readonly string[];
  /** The person's album score, or null if they have not finished rating it. */
  rating: number | null;
  /** True once every non-interlude track is rated. */
  isComplete: boolean;
  listenCount: number;
  /** ISO timestamp of their last listen, or null if never played. */
  lastListenedAt: string | null;
  borrowed: boolean;
}

export type MoodId = 'any' | 'mellow' | 'upbeat' | 'heavy' | 'groovy' | 'late_night' | 'favorites' | 'rediscover' | 'unrated';

export interface Mood {
  id: MoodId;
  label: string;
  hint: string;
}

export const MOODS: readonly Mood[] = [
  { id: 'any', label: 'Surprise me', hint: 'A mix from your shelf' },
  { id: 'mellow', label: 'Mellow', hint: 'Soft, acoustic, easy' },
  { id: 'upbeat', label: 'Upbeat', hint: 'Pop, dance, energy' },
  { id: 'heavy', label: 'Heavy', hint: 'Loud guitars' },
  { id: 'groovy', label: 'Groovy', hint: 'Funk, soul, R&B' },
  { id: 'late_night', label: 'Late night', hint: 'Jazz, blues, slow burners' },
  { id: 'favorites', label: 'Old favorites', hint: 'Your highest rated' },
  { id: 'rediscover', label: 'Rediscover', hint: 'Not played in a while' },
  { id: 'unrated', label: 'Needs a rating', hint: 'Finish rating these' },
];

/** Genre words per mood. A record matches if any of its genres contains any word. */
const GENRE_WORDS: Partial<Record<MoodId, readonly string[]>> = {
  mellow: ['folk', 'soft rock', 'acoustic', 'ambient', 'singer-songwriter', 'chamber', 'dream pop', 'easy listening', 'new age', 'bossa', 'country', 'americana', 'downtempo', 'yacht'],
  upbeat: ['pop', 'dance', 'disco', 'power pop', 'ska', 'new wave', 'synth', 'house', 'electro', 'rock and roll', 'swing', 'punk'],
  heavy: ['metal', 'hard rock', 'punk', 'grunge', 'hardcore', 'stoner', 'industrial', 'noise', 'thrash', 'doom'],
  groovy: ['funk', 'soul', 'r&b', 'rhythm and blues', 'disco', 'motown', 'hip hop', 'reggae', 'afrobeat', 'boogie', 'groove'],
  late_night: ['jazz', 'blues', 'trip hop', 'lounge', 'soul', 'ambient', 'downtempo', 'slowcore', 'torch', 'bossa'],
};

export function matchesGenreMood(genres: readonly string[], mood: MoodId): boolean {
  const words = GENRE_WORDS[mood];
  if (!words) return false;
  return genres.some((genre) => words.some((word) => genre.toLowerCase().includes(word)));
}

function daysSince(iso: string | null, now: Date): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - new Date(iso).getTime()) / 86_400_000);
}

/**
 * Small repeatable shuffle value in [0, 1) from the album and a seed, so the
 * list varies day to day but does not jump around on every render.
 */
function jitter(albumId: string, seed: string): number {
  let hash = 2166136261;
  for (const char of `${seed}:${albumId}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}

export interface Suggestion {
  record: ShelfRecord;
  /** One short reason, e.g. "Not played in 3 months". */
  reason: string;
}

function describeGap(days: number): string {
  if (!Number.isFinite(days)) return 'Never played';
  if (days < 1) return 'Played today';
  if (days < 14) return `Played ${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'} ago`;
  if (days < 60) return `Not played in ${Math.round(days / 7)} weeks`;
  if (days < 730) return `Not played in ${Math.round(days / 30)} months`;
  return `Not played in ${Math.round(days / 365)} years`;
}

/**
 * Picks a short list from the shelf for a mood.
 *
 * @param shelf records the person currently has (owned and not lent out, plus borrowed)
 * @param seed any string; the same seed gives the same order (use today's date)
 */
export function suggestNext(
  shelf: readonly ShelfRecord[],
  mood: MoodId,
  options: { now?: Date; seed?: string; limit?: number } = {},
): Suggestion[] {
  const now = options.now ?? new Date();
  const seed = options.seed ?? now.toISOString().slice(0, 10);
  const limit = options.limit ?? 5;

  const scored: { record: ShelfRecord; score: number; reason: string }[] = [];
  for (const record of shelf) {
    const gap = daysSince(record.lastListenedAt, now);
    const rest = Math.min(gap, 365) / 365; // 0 just played .. 1 long rested or never
    const random = jitter(record.albumId, seed);
    let score: number;
    let reason: string;

    switch (mood) {
      case 'favorites':
        if (!record.isComplete || record.rating === null) continue;
        score = record.rating + rest * 0.5 + random * 0.2;
        reason = `You rated it ${record.rating.toFixed(2)}`;
        break;
      case 'rediscover':
        if (record.listenCount === 0 || gap < 30) continue;
        score = gap + random;
        reason = describeGap(gap);
        break;
      case 'unrated':
        if (record.isComplete) continue;
        score = (record.borrowed ? 2 : 0) + random; // borrowed first: rate it before it goes back
        reason = record.borrowed ? 'Borrowed: rate it while you have it' : 'Not fully rated yet';
        break;
      case 'any':
        score = rest * 2 + (record.rating ?? 6) / 10 + (record.listenCount === 0 ? 0.5 : 0) + random * 1.5;
        reason = record.listenCount === 0 ? 'Never played' : describeGap(gap);
        break;
      default:
        if (!matchesGenreMood(record.genres, mood)) continue;
        score = rest + (record.rating ?? 6) / 10 + random;
        reason = record.genres.slice(0, 2).join(', ');
    }
    scored.push({ record, score, reason });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.record.title.localeCompare(b.record.title))
    .slice(0, limit)
    .map(({ record, reason }) => ({ record, reason }));
}
