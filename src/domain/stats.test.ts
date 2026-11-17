import { describe, expect, it } from 'vitest';
import { computeStats, countsByAlbum, yearRecap, yearsWithListens, type ListenEntry } from './stats';

const listen = (albumId: string, title: string, artist: string, listenedAt: string): ListenEntry => ({ albumId, title, artist, listenedAt });

const listens: ListenEntry[] = [
  listen('rumours', 'Rumours', 'Fleetwood Mac', '2025-03-10T18:00:00'),
  listen('rumours', 'Rumours', 'Fleetwood Mac', '2025-03-20T18:00:00'),
  listen('tusk', 'Tusk', 'Fleetwood Mac', '2025-07-01T12:00:00'),
  listen('aja', 'Aja', 'Steely Dan', '2026-01-05T12:00:00'),
  listen('aja', 'Aja', 'Steely Dan', '2026-01-06T12:00:00'),
  listen('aja', 'Aja', 'Steely Dan', '2026-02-06T12:00:00'),
  listen('rumours', 'Rumours', 'Fleetwood Mac', '2026-02-07T12:00:00'),
];

describe('computeStats', () => {
  const stats = computeStats(listens);

  it('counts every listen once', () => {
    expect(stats.totalListens).toBe(7);
    expect(stats.distinctAlbums).toBe(3);
    expect(stats.distinctArtists).toBe(2);
  });

  it('finds the most-listened record, breaking a tie alphabetically', () => {
    // Aja and Rumours both have 3.
    expect(stats.topAlbum).toMatchObject({ label: 'Aja', sublabel: 'Steely Dan', count: 3 });
    expect(stats.topAlbums.map((a) => [a.label, a.count])).toEqual([['Aja', 3], ['Rumours', 3], ['Tusk', 1]]);
  });

  it('finds the most-listened artist across their albums', () => {
    expect(stats.topArtist).toMatchObject({ label: 'Fleetwood Mac', count: 4 });
  });

  it('handles no listens', () => {
    const empty = computeStats([]);
    expect(empty.totalListens).toBe(0);
    expect(empty.topAlbum).toBeNull();
    expect(empty.topArtist).toBeNull();
  });

  it('treats artist names case-insensitively', () => {
    const mixed = computeStats([listen('a', 'A', 'Prince', '2026-01-01T12:00:00'), listen('b', 'B', 'PRINCE', '2026-01-02T12:00:00')]);
    expect(mixed.distinctArtists).toBe(1);
    expect(mixed.topArtist?.count).toBe(2);
  });
});

describe('yearRecap', () => {
  it('looks only at one year', () => {
    const recap = yearRecap(listens, 2025);
    expect(recap.totalListens).toBe(3);
    expect(recap.topAlbum).toMatchObject({ label: 'Rumours', count: 2 });
    expect(recap.topArtist).toMatchObject({ label: 'Fleetwood Mac', count: 3 });
    expect(recap.byMonth[2]).toBe(2);
    expect(recap.byMonth[6]).toBe(1);
    expect(recap.busiestMonth).toBe(2);
  });

  it('does not reset or change all-time totals', () => {
    const before = computeStats(listens);
    yearRecap(listens, 2025);
    yearRecap(listens, 2026);
    expect(computeStats(listens)).toEqual(before);
    expect(yearRecap(listens, 2025).totalListens + yearRecap(listens, 2026).totalListens).toBe(before.totalListens);
  });

  it('is empty for a year with no listens', () => {
    const recap = yearRecap(listens, 1999);
    expect(recap.totalListens).toBe(0);
    expect(recap.busiestMonth).toBeNull();
  });

  it('lists years newest first', () => {
    expect(yearsWithListens(listens)).toEqual([2026, 2025]);
  });
});

describe('countsByAlbum', () => {
  it('counts per album', () => {
    const counts = countsByAlbum(listens);
    expect(counts.get('rumours')).toBe(3);
    expect(counts.get('tusk')).toBe(1);
    expect(counts.get('nope')).toBeUndefined();
  });
});
