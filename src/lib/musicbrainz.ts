/**
 * MusicBrainz network client. Parsing lives in src/domain/musicbrainz.ts;
 * this file only fetches, one request at a time and at most about one per
 * second, which is the rate MusicBrainz asks clients to keep to.
 */
import {
  buildAlbumSearchUrl, buildCreditsUrl, buildEditionsUrl, buildGenresUrl, buildTracklistUrl,
  parseAlbumSearch, parseCredits, parseEditions, parseGenres, parseTracklist,
} from '@/domain/musicbrainz';

const GAP_MS = 1100;
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url: string): Promise<unknown> {
  const run = async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const wait = lastRequestAt + GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = Date.now();
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (response.ok) return response.json();
      // 503 is MusicBrainz saying "slow down": wait and try once more.
      if (response.status !== 503 || attempt === 1) {
        throw new Error(response.status === 404 ? 'MusicBrainz could not find that.' : `MusicBrainz is not answering right now (${response.status}). Try again in a moment.`);
      }
      await sleep(1500);
    }
    throw new Error('MusicBrainz is not answering right now.');
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

export const searchAlbums = async (artist: string, title: string) => parseAlbumSearch(await fetchJson(buildAlbumSearchUrl(artist, title)));
export const loadEditions = async (releaseGroupMbid: string) => parseEditions(await fetchJson(buildEditionsUrl(releaseGroupMbid)));
export const loadTracklist = async (releaseMbid: string) => parseTracklist(await fetchJson(buildTracklistUrl(releaseMbid)));
export const loadGenres = async (releaseGroupMbid: string) => parseGenres(await fetchJson(buildGenresUrl(releaseGroupMbid)));
export const loadCredits = async (recordingMbid: string) => parseCredits(await fetchJson(buildCreditsUrl(recordingMbid)));
