/**
 * MusicBrainz and Cover Art Archive: URL builders and response parsing.
 *
 * This module does no network calls. It builds request URLs and turns raw
 * JSON into Crate's own shapes, so all of it can be unit tested.
 *
 * Vocabulary:
 * - MusicBrainz "release group" = a Crate album (the musical work).
 * - MusicBrainz "release" = one edition or pressing of that album. Crate
 *   reads the tracklist from one release, picked by pickDefaultEdition.
 *
 * API notes: no key is needed. MusicBrainz asks for at most one request per
 * second per client, so callers must throttle.
 */

const MB_BASE = 'https://musicbrainz.org/ws/2';
const CAA_BASE = 'https://coverartarchive.org';

// ---------------------------------------------------------------------------
// Raw response shapes (only the fields Crate reads; all optional on purpose,
// because MusicBrainz omits fields freely)
// ---------------------------------------------------------------------------

interface RawArtistCredit {
  name?: string;
  joinphrase?: string;
  artist?: { id?: string; name?: string };
}

interface RawReleaseGroup {
  id?: string;
  title?: string;
  score?: number;
  'primary-type'?: string | null;
  'secondary-types'?: string[];
  'first-release-date'?: string;
  'artist-credit'?: RawArtistCredit[];
  tags?: { name?: string; count?: number }[];
}

interface RawMedium {
  position?: number;
  format?: string | null;
  'track-count'?: number;
  tracks?: RawTrack[];
}

interface RawTrack {
  id?: string;
  number?: string;
  position?: number;
  title?: string;
  length?: number | null;
  recording?: { id?: string; title?: string; length?: number | null };
}

interface RawRelease {
  id?: string;
  title?: string;
  status?: string | null;
  date?: string;
  country?: string | null;
  disambiguation?: string;
  media?: RawMedium[];
}

// ---------------------------------------------------------------------------
// Crate shapes
// ---------------------------------------------------------------------------

/** What kind of release a search result is, in plain words for the UI. */
export type AlbumKind =
  | 'Album'
  | 'Live'
  | 'Compilation'
  | 'Soundtrack'
  | 'Remix'
  | 'Demo'
  | 'EP'
  | 'Single'
  | 'Other';

export interface AlbumSearchResult {
  /** MusicBrainz release group ID. */
  mbid: string;
  title: string;
  artist: string;
  /** Four digit first release year, or null when MusicBrainz has no date. */
  year: number | null;
  kind: AlbumKind;
  /** True for a plain studio album: the thing most people mean by the title. */
  isOriginalAlbum: boolean;
  /** Extra hints read from the title, e.g. "Deluxe", "Remastered". */
  editionHints: string[];
  /** MusicBrainz relevance score, 0 to 100. */
  score: number;
  coverUrl: string;
}

export interface Edition {
  /** MusicBrainz release ID. */
  releaseId: string;
  title: string;
  /** Raw date as given: "1977", "1977-02" or "1977-02-04". Empty when unknown. */
  date: string;
  year: number | null;
  country: string | null;
  /** e.g. "12\" Vinyl", "CD". Formats of all discs joined, de-duplicated. */
  format: string | null;
  trackCount: number;
  discCount: number;
  /** e.g. "deluxe edition", "2004 remaster". Empty when none. */
  disambiguation: string;
  isOfficial: boolean;
}

export interface ParsedTrack {
  /** MusicBrainz track ID (unique to this edition). */
  mbid: string | null;
  /** MusicBrainz recording ID (shared across editions of the same recording). */
  recordingMbid: string | null;
  title: string;
  /** 1-based disc number. */
  disc: number;
  /** 1-based position on its disc. */
  position: number;
  /** Label as printed, e.g. "A1" on vinyl or "3" on CD. */
  number: string;
  lengthMs: number | null;
}

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

/** Escapes Lucene special characters so user text is treated as plain words. */
export function escapeLucene(text: string): string {
  return text.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1');
}

/** Search for albums (release groups) by artist and title. Either may be empty, not both. */
export function buildAlbumSearchUrl(artist: string, title: string, limit = 25): string {
  const parts: string[] = [];
  if (title.trim()) parts.push(`releasegroup:(${escapeLucene(title.trim())})`);
  if (artist.trim()) parts.push(`artist:(${escapeLucene(artist.trim())})`);
  if (parts.length === 0) throw new Error('Search needs an artist or an album title.');
  const query = encodeURIComponent(parts.join(' AND '));
  return `${MB_BASE}/release-group?query=${query}&limit=${limit}&fmt=json`;
}

/** List the editions (releases) of one album, with disc and track counts. */
export function buildEditionsUrl(releaseGroupMbid: string): string {
  return `${MB_BASE}/release?release-group=${encodeURIComponent(releaseGroupMbid)}&inc=media&limit=100&fmt=json`;
}

/** Fetch one edition with its full tracklist. */
export function buildTracklistUrl(releaseMbid: string): string {
  return `${MB_BASE}/release/${encodeURIComponent(releaseMbid)}?inc=recordings&fmt=json`;
}

/**
 * Cover art for an album. The Cover Art Archive redirects this URL to the
 * image, or answers 404 when no cover exists, so the UI needs a fallback.
 */
export function coverArtUrl(releaseGroupMbid: string, size: 250 | 500 | 1200 = 500): string {
  return `${CAA_BASE}/release-group/${encodeURIComponent(releaseGroupMbid)}/front-${size}`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Joins an artist credit into display text, e.g. "Simon & Garfunkel". */
export function formatArtistCredit(credit: RawArtistCredit[] | undefined): string {
  if (!credit || credit.length === 0) return 'Unknown artist';
  const text = credit.map((c) => `${c.name ?? c.artist?.name ?? ''}${c.joinphrase ?? ''}`).join('').trim();
  return text.length > 0 ? text : 'Unknown artist';
}

/** Pulls a four digit year from "1977", "1977-02" or "1977-02-04". */
export function parseYear(date: string | undefined | null): number | null {
  if (!date) return null;
  const match = /^(\d{4})/.exec(date);
  return match ? Number(match[1]) : null;
}

const SECONDARY_PRIORITY: { type: string; kind: AlbumKind }[] = [
  { type: 'live', kind: 'Live' },
  { type: 'compilation', kind: 'Compilation' },
  { type: 'soundtrack', kind: 'Soundtrack' },
  { type: 'remix', kind: 'Remix' },
  { type: 'dj-mix', kind: 'Remix' },
  { type: 'mixtape/street', kind: 'Other' },
  { type: 'demo', kind: 'Demo' },
];

/** Decides the plain-words kind from MusicBrainz primary and secondary types. */
export function classifyKind(primaryType: string | null | undefined, secondaryTypes: string[] | undefined): AlbumKind {
  const secondary = (secondaryTypes ?? []).map((s) => s.toLowerCase());
  for (const { type, kind } of SECONDARY_PRIORITY) {
    if (secondary.includes(type)) return kind;
  }
  if (secondary.length > 0) return 'Other'; // interview, spokenword, audiobook...
  switch ((primaryType ?? '').toLowerCase()) {
    case 'album':
      return 'Album';
    case 'ep':
      return 'EP';
    case 'single':
      return 'Single';
    default:
      return 'Other';
  }
}

const EDITION_HINTS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bdeluxe\b/i, label: 'Deluxe' },
  { pattern: /\bexpanded\b/i, label: 'Expanded' },
  { pattern: /\bremaster(ed)?\b/i, label: 'Remastered' },
  { pattern: /\banniversary\b/i, label: 'Anniversary' },
  { pattern: /\bsuper deluxe\b/i, label: 'Super Deluxe' },
  { pattern: /\bre[-\u2010\u2011 ]?issued?\b/i, label: 'Reissue' },
  // Live, compilation and demo are NOT guessed from titles: MusicBrainz types
  // cover them, and titles lie ("Live Through This" is a studio album).
];

/** Reads edition words out of a title or disambiguation, e.g. "(Deluxe Edition)". */
export function detectEditionHints(text: string): string[] {
  const found: string[] = [];
  for (const { pattern, label } of EDITION_HINTS) {
    if (pattern.test(text) && !found.includes(label)) found.push(label);
  }
  // "Super Deluxe" already says "Deluxe".
  return found.includes('Super Deluxe') ? found.filter((f) => f !== 'Deluxe') : found;
}

/**
 * Parses an album search response into results, originals first.
 *
 * Order: plain studio albums before live, compilation and other versions;
 * inside each group, MusicBrainz relevance, then earliest year.
 */
export function parseAlbumSearch(json: unknown): AlbumSearchResult[] {
  const groups = (json as { 'release-groups'?: RawReleaseGroup[] } | null)?.['release-groups'];
  if (!Array.isArray(groups)) return [];

  const results: AlbumSearchResult[] = [];
  for (const group of groups) {
    if (!group.id || !group.title) continue;
    const kind = classifyKind(group['primary-type'], group['secondary-types']);
    const editionHints = detectEditionHints(group.title);
    results.push({
      mbid: group.id,
      title: group.title,
      artist: formatArtistCredit(group['artist-credit']),
      year: parseYear(group['first-release-date']),
      kind,
      isOriginalAlbum: kind === 'Album' && editionHints.length === 0,
      editionHints,
      score: group.score ?? 0,
      coverUrl: coverArtUrl(group.id),
    });
  }

  return results.sort((a, b) => {
    if (a.isOriginalAlbum !== b.isOriginalAlbum) return a.isOriginalAlbum ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    return (a.year ?? 9999) - (b.year ?? 9999);
  });
}

/** Short badge text for a search result, e.g. "Original album", "Live", "Deluxe". */
export function resultBadge(result: AlbumSearchResult): string {
  if (result.isOriginalAlbum) return 'Original album';
  if (result.kind === 'Album') return result.editionHints.join(' · ');
  return result.kind;
}

/** Parses the editions of one album from a release browse response. */
export function parseEditions(json: unknown): Edition[] {
  const releases = (json as { releases?: RawRelease[] } | null)?.releases;
  if (!Array.isArray(releases)) return [];

  const editions: Edition[] = [];
  for (const release of releases) {
    if (!release.id) continue;
    const media = release.media ?? [];
    const formats = [...new Set(media.map((m) => m.format).filter((f): f is string => Boolean(f)))];
    editions.push({
      releaseId: release.id,
      title: release.title ?? '',
      date: release.date ?? '',
      year: parseYear(release.date),
      country: release.country ?? null,
      format: formats.length > 0 ? formats.join(' + ') : null,
      trackCount: media.reduce((sum, m) => sum + (m['track-count'] ?? 0), 0),
      discCount: media.length,
      disambiguation: release.disambiguation ?? '',
      isOfficial: (release.status ?? '').toLowerCase() === 'official',
    });
  }
  return editions;
}

/**
 * Picks the edition whose tracklist Crate shows by default: the earliest
 * official release that has tracks. This is normally the original pressing,
 * so deluxe bonus tracks and remaster extras stay out unless the user picks
 * another edition on the confirm screen.
 *
 * Dates sort as text, which works for ISO dates. A year-only date ("1977")
 * sorts before a full date in the same year, which is fine.
 */
export function pickDefaultEdition(editions: readonly Edition[]): Edition | null {
  const withTracks = editions.filter((e) => e.trackCount > 0);
  if (withTracks.length === 0) return null;
  const official = withTracks.filter((e) => e.isOfficial);
  const pool = official.length > 0 ? official : withTracks;
  const plain = pool.filter((e) => detectEditionHints(`${e.title} ${e.disambiguation}`).length === 0);
  const candidates = plain.length > 0 ? plain : pool;

  return [...candidates].sort((a, b) => {
    // Undated editions go last.
    if (!a.date !== !b.date) return a.date ? -1 : 1;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    // Same date: prefer vinyl, since Crate is a record collection.
    const aVinyl = /vinyl/i.test(a.format ?? '');
    const bVinyl = /vinyl/i.test(b.format ?? '');
    if (aVinyl !== bVinyl) return aVinyl ? -1 : 1;
    return a.trackCount - b.trackCount;
  })[0]!;
}

/** Parses the full tracklist from a single release lookup (inc=recordings). */
export function parseTracklist(json: unknown): ParsedTrack[] {
  const media = (json as RawRelease | null)?.media;
  if (!Array.isArray(media)) return [];

  const tracks: ParsedTrack[] = [];
  media.forEach((medium, mediumIndex) => {
    const disc = medium.position ?? mediumIndex + 1;
    (medium.tracks ?? []).forEach((track, trackIndex) => {
      const length = track.length ?? track.recording?.length ?? null;
      tracks.push({
        mbid: track.id ?? null,
        recordingMbid: track.recording?.id ?? null,
        title: track.title ?? track.recording?.title ?? 'Untitled',
        disc,
        position: track.position ?? trackIndex + 1,
        number: track.number ?? String(track.position ?? trackIndex + 1),
        lengthMs: typeof length === 'number' && length > 0 ? length : null,
      });
    });
  });

  return tracks.sort((a, b) => a.disc - b.disc || a.position - b.position);
}

// ---------------------------------------------------------------------------
// Genres (used for moods in "what to play next")
// ---------------------------------------------------------------------------

/** One album with its genres. */
export function buildGenresUrl(releaseGroupMbid: string): string {
  return `${MB_BASE}/release-group/${encodeURIComponent(releaseGroupMbid)}?inc=genres&fmt=json`;
}

/** Genre names, most voted first, at most `limit`. */
export function parseGenres(json: unknown, limit = 8): string[] {
  const genres = (json as { genres?: { name?: string; count?: number }[] } | null)?.genres;
  if (!Array.isArray(genres)) return [];
  return genres
    .filter((g): g is { name: string; count?: number } => typeof g.name === 'string' && g.name.length > 0)
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, limit)
    .map((g) => g.name.toLowerCase());
}

// ---------------------------------------------------------------------------
// Song credits (later phase: song details)
// ---------------------------------------------------------------------------

interface RawRelation {
  type?: string;
  'target-type'?: string;
  attributes?: string[];
  artist?: { name?: string };
  work?: { id?: string; title?: string; relations?: RawRelation[] };
}

export interface SongCredits {
  writers: string[];
  producers: string[];
  /** e.g. { name: "Mick Fleetwood", roles: ["drums (drum set)", "percussion"] } */
  players: { name: string; roles: string[] }[];
  engineers: string[];
}

/** One recording with who wrote, played on and produced it. */
export function buildCreditsUrl(recordingMbid: string): string {
  return `${MB_BASE}/recording/${encodeURIComponent(recordingMbid)}?inc=artist-rels+work-rels+work-level-rels&fmt=json`;
}

const WRITER_TYPES = new Set(['writer', 'composer', 'lyricist']);
const PLAYER_TYPES = new Set(['instrument', 'vocal', 'performer', 'performing orchestra', 'conductor']);
const ENGINEER_TYPES = new Set(['engineer', 'mix', 'recording', 'mastering']);

/** Parses credits from a recording lookup. Names are de-duplicated, order kept. */
export function parseCredits(json: unknown): SongCredits {
  const relations = (json as { relations?: RawRelation[] } | null)?.relations;
  const credits: SongCredits = { writers: [], producers: [], players: [], engineers: [] };
  if (!Array.isArray(relations)) return credits;

  const add = (list: string[], name: string) => {
    if (!list.includes(name)) list.push(name);
  };

  for (const relation of relations) {
    const type = (relation.type ?? '').toLowerCase();
    const name = relation.artist?.name;
    if (relation.work) {
      for (const workRelation of relation.work.relations ?? []) {
        const workName = workRelation.artist?.name;
        if (workName && WRITER_TYPES.has((workRelation.type ?? '').toLowerCase())) add(credits.writers, workName);
      }
      continue;
    }
    if (!name) continue;
    if (type === 'producer') add(credits.producers, name);
    else if (ENGINEER_TYPES.has(type)) add(credits.engineers, name);
    else if (PLAYER_TYPES.has(type)) {
      const roles = relation.attributes && relation.attributes.length > 0 ? relation.attributes : [type === 'vocal' ? 'vocals' : type];
      const existing = credits.players.find((p) => p.name === name);
      if (existing) roles.forEach((r) => add(existing.roles, r));
      else credits.players.push({ name, roles: [...roles] });
    }
  }
  return credits;
}

/**
 * Lyrics are never shown or stored in Crate. This builds a link out to a
 * search on Genius, a licensed lyrics site.
 */
export function lyricsSearchUrl(artist: string, title: string): string {
  return `https://genius.com/search?q=${encodeURIComponent(`${artist} ${title}`)}`;
}
