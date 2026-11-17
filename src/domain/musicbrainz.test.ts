import { describe, expect, it } from 'vitest';
import {
  lyricsSearchUrl,
  parseCredits,
  parseGenres,
  buildAlbumSearchUrl,
  buildEditionsUrl,
  buildTracklistUrl,
  classifyKind,
  coverArtUrl,
  detectEditionHints,
  escapeLucene,
  formatArtistCredit,
  parseAlbumSearch,
  parseEditions,
  parseTracklist,
  parseYear,
  pickDefaultEdition,
  resultBadge,
} from './musicbrainz';

// Fixtures follow the MusicBrainz JSON web service v2 shapes.
const searchResponse = {
  created: '2026-11-17T00:00:00.000Z',
  count: 4,
  offset: 0,
  'release-groups': [
    {
      id: 'rg-live',
      score: 100,
      title: 'Rumours Live',
      'primary-type': 'Album',
      'secondary-types': ['Live'],
      'first-release-date': '2023-09-08',
      'artist-credit': [{ name: 'Fleetwood Mac', artist: { id: 'a1', name: 'Fleetwood Mac' } }],
    },
    {
      id: 'rg-original',
      score: 100,
      title: 'Rumours',
      'primary-type': 'Album',
      'first-release-date': '1977-02-04',
      'artist-credit': [{ name: 'Fleetwood Mac', artist: { id: 'a1', name: 'Fleetwood Mac' } }],
    },
    {
      id: 'rg-deluxe',
      score: 90,
      title: 'Rumours (Deluxe Edition)',
      'primary-type': 'Album',
      'secondary-types': [],
      'first-release-date': '2013',
      'artist-credit': [{ name: 'Fleetwood Mac', artist: { id: 'a1', name: 'Fleetwood Mac' } }],
    },
    {
      id: 'rg-comp',
      score: 80,
      title: 'Greatest Hits',
      'primary-type': 'Album',
      'secondary-types': ['Compilation'],
      'first-release-date': '',
      'artist-credit': [{ name: 'Fleetwood Mac', artist: { id: 'a1', name: 'Fleetwood Mac' } }],
    },
    { score: 70, title: 'No ID, must be skipped' },
  ],
};

describe('URL builders', () => {
  it('builds an album search with both fields', () => {
    const url = buildAlbumSearchUrl('Fleetwood Mac', 'Rumours');
    expect(url).toContain('https://musicbrainz.org/ws/2/release-group?query=');
    expect(decodeURIComponent(url)).toContain('releasegroup:(Rumours) AND artist:(Fleetwood Mac)');
    expect(url).toContain('fmt=json');
  });

  it('works with only an artist or only a title, and refuses neither', () => {
    expect(decodeURIComponent(buildAlbumSearchUrl('', 'Rumours'))).toContain('query=releasegroup:(Rumours)&');
    expect(decodeURIComponent(buildAlbumSearchUrl('Prince', ' '))).toContain('query=artist:(Prince)&');
    expect(() => buildAlbumSearchUrl(' ', '')).toThrow();
  });

  it('escapes search syntax in user text', () => {
    expect(escapeLucene('AC/DC')).toBe('AC\\/DC');
    expect(escapeLucene('Who\'s Next? (Deluxe)')).toBe("Who's Next\\? \\(Deluxe\\)");
    expect(escapeLucene('!!!')).toBe('\\!\\!\\!');
  });

  it('builds edition, tracklist and cover URLs', () => {
    expect(buildEditionsUrl('rg-1')).toBe('https://musicbrainz.org/ws/2/release?release-group=rg-1&inc=media&limit=100&fmt=json');
    expect(buildTracklistUrl('rel-1')).toBe('https://musicbrainz.org/ws/2/release/rel-1?inc=recordings&fmt=json');
    expect(coverArtUrl('rg-1')).toBe('https://coverartarchive.org/release-group/rg-1/front-500');
    expect(coverArtUrl('rg-1', 250)).toBe('https://coverartarchive.org/release-group/rg-1/front-250');
  });
});

describe('small parsers', () => {
  it('joins artist credits with their join phrases', () => {
    expect(
      formatArtistCredit([
        { name: 'Simon', joinphrase: ' & ', artist: { name: 'Paul Simon' } },
        { name: 'Garfunkel', artist: { name: 'Art Garfunkel' } },
      ]),
    ).toBe('Simon & Garfunkel');
    expect(formatArtistCredit(undefined)).toBe('Unknown artist');
  });

  it('reads the year from full, partial or missing dates', () => {
    expect(parseYear('1977-02-04')).toBe(1977);
    expect(parseYear('1977')).toBe(1977);
    expect(parseYear('')).toBeNull();
    expect(parseYear(undefined)).toBeNull();
  });

  it('classifies kinds, with secondary types taking priority', () => {
    expect(classifyKind('Album', [])).toBe('Album');
    expect(classifyKind('Album', undefined)).toBe('Album');
    expect(classifyKind('Album', ['Live'])).toBe('Live');
    expect(classifyKind('Album', ['Compilation', 'Live'])).toBe('Live');
    expect(classifyKind('Album', ['Soundtrack'])).toBe('Soundtrack');
    expect(classifyKind('EP', [])).toBe('EP');
    expect(classifyKind('Single', [])).toBe('Single');
    expect(classifyKind(null, [])).toBe('Other');
    expect(classifyKind('Album', ['Interview'])).toBe('Other');
  });

  it('spots edition words in titles without false alarms', () => {
    expect(detectEditionHints('Rumours (Deluxe Edition)')).toEqual(['Deluxe']);
    expect(detectEditionHints('Abbey Road (Super Deluxe)')).toEqual(['Super Deluxe']);
    expect(detectEditionHints('Nevermind (30th Anniversary, Remastered)')).toEqual(['Remastered', 'Anniversary']);
    expect(detectEditionHints('Rumours')).toEqual([]);
    expect(detectEditionHints('Live Through This')).toEqual([]);
  });
});

describe('parseAlbumSearch', () => {
  const results = parseAlbumSearch(searchResponse);

  it('skips entries without an ID', () => {
    expect(results).toHaveLength(4);
  });

  it('puts the original studio album first, even when a live version scores the same', () => {
    expect(results[0]).toMatchObject({
      mbid: 'rg-original',
      title: 'Rumours',
      artist: 'Fleetwood Mac',
      year: 1977,
      kind: 'Album',
      isOriginalAlbum: true,
      coverUrl: 'https://coverartarchive.org/release-group/rg-original/front-500',
    });
    expect(results.map((r) => r.mbid)).toEqual(['rg-original', 'rg-live', 'rg-deluxe', 'rg-comp']);
  });

  it('labels every result so the right one can be picked', () => {
    expect(results.map(resultBadge)).toEqual(['Original album', 'Live', 'Deluxe', 'Compilation']);
  });

  it('handles a missing date', () => {
    expect(results.find((r) => r.mbid === 'rg-comp')?.year).toBeNull();
  });

  it('returns nothing for junk input', () => {
    expect(parseAlbumSearch(null)).toEqual([]);
    expect(parseAlbumSearch({})).toEqual([]);
    expect(parseAlbumSearch({ 'release-groups': 'nope' })).toEqual([]);
  });
});

const editionsResponse = {
  'release-count': 5,
  releases: [
    { id: 'rel-2013', title: 'Rumours', status: 'Official', date: '2013-01-29', country: 'US', disambiguation: 'deluxe edition', media: [{ format: 'CD', 'track-count': 12 }, { format: 'CD', 'track-count': 12 }, { format: 'CD', 'track-count': 16 }] },
    { id: 'rel-cd', title: 'Rumours', status: 'Official', date: '1984', country: 'US', disambiguation: '', media: [{ format: 'CD', 'track-count': 11 }] },
    { id: 'rel-promo', title: 'Rumours', status: 'Promotion', date: '1977-01-15', country: 'US', media: [{ format: '12" Vinyl', 'track-count': 11 }] },
    { id: 'rel-us-cass', title: 'Rumours', status: 'Official', date: '1977-02-04', country: 'US', media: [{ format: 'Cassette', 'track-count': 11 }] },
    { id: 'rel-us-lp', title: 'Rumours', status: 'Official', date: '1977-02-04', country: 'US', media: [{ format: '12" Vinyl', 'track-count': 11 }] },
    { id: 'rel-undated', title: 'Rumours', status: 'Official', media: [{ format: '12" Vinyl', 'track-count': 11 }] },
    { id: 'rel-empty', title: 'Rumours', status: 'Official', date: '1970', media: [] },
  ],
};

describe('parseEditions and pickDefaultEdition', () => {
  const editions = parseEditions(editionsResponse);

  it('reads date, format and track counts, summing across discs', () => {
    expect(editions.find((e) => e.releaseId === 'rel-2013')).toMatchObject({
      year: 2013,
      format: 'CD',
      trackCount: 40,
      discCount: 3,
      disambiguation: 'deluxe edition',
      isOfficial: true,
    });
  });

  it('defaults to the earliest official edition with tracks, preferring vinyl on a tie', () => {
    expect(pickDefaultEdition(editions)?.releaseId).toBe('rel-us-lp');
  });

  it('skips promos, undated, empty and deluxe editions for the default', () => {
    const noOriginals = editions.filter((e) => !e.releaseId.startsWith('rel-us'));
    expect(pickDefaultEdition(noOriginals)?.releaseId).toBe('rel-cd');
  });

  it('falls back to a deluxe or unofficial edition when that is all there is', () => {
    expect(pickDefaultEdition(editions.filter((e) => e.releaseId === 'rel-2013'))?.releaseId).toBe('rel-2013');
    expect(pickDefaultEdition(editions.filter((e) => e.releaseId === 'rel-promo'))?.releaseId).toBe('rel-promo');
  });

  it('gives null when no edition has tracks', () => {
    expect(pickDefaultEdition(editions.filter((e) => e.releaseId === 'rel-empty'))).toBeNull();
    expect(pickDefaultEdition([])).toBeNull();
    expect(parseEditions(null)).toEqual([]);
  });
});

const tracklistResponse = {
  id: 'rel-us-lp',
  title: 'Rumours',
  media: [
    {
      position: 2,
      format: '12" Vinyl',
      tracks: [
        { id: 't-b1', number: 'B1', position: 1, title: 'The Chain', length: 270000, recording: { id: 'r-chain', title: 'The Chain', length: 268000 } },
        { id: 't-b2', number: 'B2', position: 2, title: 'You Make Loving Fun', length: null, recording: { id: 'r-fun', length: 211000 } },
      ],
    },
    {
      position: 1,
      format: '12" Vinyl',
      tracks: [
        { id: 't-a2', number: 'A2', position: 2, title: 'Dreams', length: 257000, recording: { id: 'r-dreams' } },
        { id: 't-a1', number: 'A1', position: 1, title: 'Second Hand News', length: 163000, recording: { id: 'r-shn' } },
        { id: 't-a3', number: 'A3', position: 3, recording: { id: 'r-x', title: 'Never Going Back Again' } },
      ],
    },
  ],
};

describe('parseTracklist', () => {
  const tracks = parseTracklist(tracklistResponse);

  it('returns tracks in play order across sides and discs', () => {
    expect(tracks.map((t) => t.number)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2']);
    expect(tracks.map((t) => t.disc)).toEqual([1, 1, 1, 2, 2]);
  });

  it('prefers the track length, falls back to the recording length, then null', () => {
    expect(tracks.find((t) => t.number === 'B1')?.lengthMs).toBe(270000);
    expect(tracks.find((t) => t.number === 'B2')?.lengthMs).toBe(211000);
    expect(tracks.find((t) => t.number === 'A3')?.lengthMs).toBeNull();
  });

  it('falls back to the recording title and keeps both IDs', () => {
    expect(tracks.find((t) => t.number === 'A3')).toMatchObject({
      title: 'Never Going Back Again',
      mbid: 't-a3',
      recordingMbid: 'r-x',
    });
    expect(tracks[0]).toMatchObject({ mbid: 't-a1', recordingMbid: 'r-shn', title: 'Second Hand News' });
  });

  it('returns nothing for junk input', () => {
    expect(parseTracklist(null)).toEqual([]);
    expect(parseTracklist({ media: 'nope' })).toEqual([]);
  });
});

describe('genres, credits and lyrics link', () => {
  it('lists genres most voted first, lowercased', () => {
    const json = { genres: [{ name: 'Blues', count: 6 }, { name: 'rock', count: 14 }, { name: 'soft rock', count: 11 }, { count: 3 }] };
    expect(parseGenres(json)).toEqual(['rock', 'soft rock', 'blues']);
    expect(parseGenres(json, 1)).toEqual(['rock']);
    expect(parseGenres(null)).toEqual([]);
  });

  it('groups credits into writers, producers, players and engineers', () => {
    const credits = parseCredits({
      relations: [
        { type: 'engineer', 'target-type': 'artist', attributes: [], artist: { name: 'Ken Caillat' } },
        { type: 'instrument', 'target-type': 'artist', attributes: ['guitar'], artist: { name: 'Lindsey Buckingham' } },
        { type: 'instrument', 'target-type': 'artist', attributes: ['drums (drum set)', 'percussion'], artist: { name: 'Mick Fleetwood' } },
        { type: 'vocal', 'target-type': 'artist', attributes: ['lead vocals'], artist: { name: 'Stevie Nicks' } },
        { type: 'vocal', 'target-type': 'artist', attributes: [], artist: { name: 'Lindsey Buckingham' } },
        { type: 'producer', 'target-type': 'artist', attributes: [], artist: { name: 'Ken Caillat' } },
        { type: 'producer', 'target-type': 'artist', attributes: ['additional'], artist: { name: 'Ken Caillat' } },
        { type: 'performance', 'target-type': 'work', work: { id: 'w1', title: 'Dreams', relations: [{ type: 'writer', artist: { name: 'Stevie Nicks' } }, { type: 'publishing', artist: { name: 'Some Publisher' } }] } },
      ],
    });
    expect(credits.writers).toEqual(['Stevie Nicks']);
    expect(credits.producers).toEqual(['Ken Caillat']);
    expect(credits.engineers).toEqual(['Ken Caillat']);
    expect(credits.players).toEqual([
      { name: 'Lindsey Buckingham', roles: ['guitar', 'vocals'] },
      { name: 'Mick Fleetwood', roles: ['drums (drum set)', 'percussion'] },
      { name: 'Stevie Nicks', roles: ['lead vocals'] },
    ]);
    expect(parseCredits({})).toEqual({ writers: [], producers: [], players: [], engineers: [] });
  });

  it('links out for lyrics instead of holding them', () => {
    expect(lyricsSearchUrl('Fleetwood Mac', 'Dreams')).toBe('https://genius.com/search?q=Fleetwood%20Mac%20Dreams');
  });

  it('treats a typographic hyphen in "re\u2010issue" as a reissue hint', () => {
    expect(detectEditionHints('re\u2010issue, marked Fabricado em Portugal')).toEqual(['Reissue']);
  });
});
