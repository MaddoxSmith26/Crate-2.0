import { describe, expect, it } from 'vitest';
import { buildWikipediaSearchUrl, parseWikipediaSearch, pickSongArticle, type WikiPage } from './background';

const page = (title: string, extract: string, index: number): WikiPage => ({ title, extract, url: `https://en.wikipedia.org/wiki/${title}`, index });

describe('pickSongArticle', () => {
  const pages = [
    page('Dreams', 'Dreams may refer to: a succession of images...', 1),
    page('Dreams (The Cranberries song)', '"Dreams" is the debut single by Irish band the Cranberries.', 2),
    page('Dreams (Fleetwood Mac song)', '"Dreams" is a song by Fleetwood Mac from Rumours.', 3),
    page('Rumours (album)', 'Rumours is the eleventh studio album by Fleetwood Mac.', 4),
  ];

  it('prefers the page naming the artist in its title', () => {
    expect(pickSongArticle(pages, 'Fleetwood Mac', 'Dreams')?.title).toBe('Dreams (Fleetwood Mac song)');
  });

  it('accepts a plain "(song)" page when the summary mentions the artist', () => {
    const result = pickSongArticle([page('Go Your Own Way', '"Go Your Own Way" is a song by Fleetwood Mac.', 1)], 'Fleetwood Mac', 'Go Your Own Way');
    expect(result?.title).toBe('Go Your Own Way');
  });

  it('refuses the album page, another artist\'s song and disambiguation pages', () => {
    expect(pickSongArticle(pages, 'Fleetwood Mac', 'Rumours')).toBeNull();
    expect(pickSongArticle(pages.slice(0, 2), 'Fleetwood Mac', 'Dreams')).toBeNull();
    expect(pickSongArticle([], 'Fleetwood Mac', 'Dreams')).toBeNull();
  });
});

describe('Wikipedia search helpers', () => {
  it('builds a CORS-friendly search URL', () => {
    const url = buildWikipediaSearchUrl('Fleetwood Mac', 'Dreams');
    expect(url).toContain('origin=*');
    expect(decodeURIComponent(url)).toContain('"Dreams" Fleetwood Mac song');
  });

  it('parses and orders pages, dropping ones without text', () => {
    const json = { query: { pages: { '2': { title: 'B', extract: 'b', fullurl: 'u2', index: 2 }, '1': { title: 'A', extract: ' a ', fullurl: 'u1', index: 1 }, '3': { title: 'C', fullurl: 'u3', index: 3 } } } };
    expect(parseWikipediaSearch(json)).toEqual([{ title: 'A', extract: 'a', url: 'u1', index: 1 }, { title: 'B', extract: 'b', url: 'u2', index: 2 }]);
    expect(parseWikipediaSearch({})).toEqual([]);
  });
});
