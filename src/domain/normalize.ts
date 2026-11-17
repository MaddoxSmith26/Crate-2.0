/**
 * Text normalization for matching albums and building URL slugs.
 *
 * The goal is that small spelling differences never create a second album:
 * "The Dark Side of the Moon" and "Dark Side of the Moon" must produce the
 * same key, as must "AC/DC" and "ACDC", or "Beyoncé" and "Beyonce".
 */

const LEADING_ARTICLE = /^(the|a|an)\s+/;

/** Lowercases, strips accents and punctuation, and collapses spaces. */
function baseNormalize(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // accents left behind by NFKD
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['‘’ʼ`]/g, '') // apostrophes vanish: "don't" -> "dont"
    .replace(/[^a-z0-9]+/g, ' ') // all other punctuation becomes a space
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Normalizes an album title for comparison. Drops one leading article so
 * "The Wall" and "Wall" match, but keeps articles elsewhere in the title.
 */
export function normalizeTitle(title: string): string {
  const base = baseNormalize(title);
  const withoutArticle = base.replace(LEADING_ARTICLE, '');
  // A title that is only an article ("The", "A") keeps it.
  return withoutArticle.length > 0 ? withoutArticle : base;
}

/** Normalizes an artist name. "The Beatles" and "Beatles" match. */
export function normalizeArtist(artist: string): string {
  const base = baseNormalize(artist);
  const withoutArticle = base.replace(LEADING_ARTICLE, '');
  return withoutArticle.length > 0 ? withoutArticle : base;
}

/**
 * The identity key for an album when no MusicBrainz ID is available, and the
 * safety net for duplicate detection when one is. Spaces are removed so
 * "AC/DC" (ac dc) and "ACDC" (acdc) agree.
 */
export function albumKey(artist: string, title: string): string {
  const a = normalizeArtist(artist).replace(/ /g, '');
  const t = normalizeTitle(title).replace(/ /g, '');
  return `${a}::${t}`;
}

/** True when two artist and title pairs describe the same album. */
export function isSameAlbum(
  a: { artist: string; title: string },
  b: { artist: string; title: string },
): boolean {
  return albumKey(a.artist, a.title) === albumKey(b.artist, b.title);
}

/** URL-safe slug, e.g. "Fleetwood Mac" + "Rumours" -> "fleetwood-mac-rumours". */
export function slugify(...parts: string[]): string {
  return parts
    .map((p) => baseNormalize(p).replace(/ /g, '-'))
    .filter((p) => p.length > 0)
    .join('-');
}
