/**
 * Song background from Wikipedia (later phase: song details).
 *
 * Crate searches Wikipedia for the song and shows the opening summary with a
 * link. A search can return the wrong article, so pickSongArticle only
 * accepts a page whose title really is the song.
 */
import { normalizeTitle } from './normalize';

export interface WikiPage {
  title: string;
  extract: string;
  url: string;
  /** Search rank, 1 is best. */
  index: number;
}

export function buildWikipediaSearchUrl(artist: string, songTitle: string): string {
  const search = encodeURIComponent(`"${songTitle}" ${artist} song`);
  return (
    'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*' +
    `&generator=search&gsrsearch=${search}&gsrlimit=6` +
    '&prop=extracts%7Cinfo&exintro=1&explaintext=1&exsentences=5&inprop=url'
  );
}

export function parseWikipediaSearch(json: unknown): WikiPage[] {
  const pages = (json as { query?: { pages?: Record<string, { title?: string; extract?: string; fullurl?: string; index?: number }> } } | null)?.query?.pages;
  if (!pages || typeof pages !== 'object') return [];
  return Object.values(pages)
    .filter((p) => p.title && p.extract && p.fullurl)
    .map((p) => ({ title: p.title!, extract: p.extract!.trim(), url: p.fullurl!, index: p.index ?? 99 }))
    .sort((a, b) => a.index - b.index);
}

/**
 * Picks the article about this song, or null. The page title must be the
 * song title, optionally followed by a bracket such as "(song)" or
 * "(Fleetwood Mac song)". Disambiguation pages are refused.
 */
export function pickSongArticle(pages: readonly WikiPage[], artist: string, songTitle: string): WikiPage | null {
  const wanted = normalizeTitle(songTitle);
  const artistKey = normalizeTitle(artist);
  let fallback: WikiPage | null = null;
  for (const page of pages) {
    if (/may refer to/i.test(page.extract)) continue;
    const match = /^(.*?)(?:\s*\(([^)]*)\))?$/.exec(page.title);
    if (!match || normalizeTitle(match[1] ?? '') !== wanted) continue;
    const bracket = normalizeTitle(match[2] ?? '');
    if (bracket.includes(artistKey) && artistKey.length > 0) return page; // "(Fleetwood Mac song)"
    const mentionsArtist = normalizeTitle(page.extract).includes(artistKey);
    const isSongPage = bracket === '' || /\b(song|single|composition|instrumental)\b/.test(bracket);
    if (isSongPage && mentionsArtist && !fallback) fallback = page;
  }
  return fallback;
}
