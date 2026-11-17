import { describe, expect, it } from 'vitest';
import { MOODS, matchesGenreMood, suggestNext, type ShelfRecord } from './suggest';

const now = new Date('2026-11-16T12:00:00Z');
const record = (over: Partial<ShelfRecord> & { albumId: string }): ShelfRecord => ({
  title: over.albumId,
  artist: 'Artist',
  genres: [],
  rating: null,
  isComplete: false,
  listenCount: 0,
  lastListenedAt: null,
  borrowed: false,
  ...over,
});

const shelf: ShelfRecord[] = [
  record({ albumId: 'rumours', genres: ['soft rock', 'pop rock'], rating: 9.2, isComplete: true, listenCount: 12, lastListenedAt: '2026-11-15T12:00:00Z' }),
  record({ albumId: 'paranoid', genres: ['heavy metal', 'hard rock'], rating: 8.1, isComplete: true, listenCount: 3, lastListenedAt: '2026-05-01T12:00:00Z' }),
  record({ albumId: 'kind-of-blue', genres: ['jazz', 'modal jazz'], rating: 9.8, isComplete: true, listenCount: 5, lastListenedAt: '2025-01-01T12:00:00Z' }),
  record({ albumId: 'off-the-wall', genres: ['disco', 'funk', 'pop'], listenCount: 0 }),
  record({ albumId: 'borrowed-one', genres: ['folk'], borrowed: true, listenCount: 1, lastListenedAt: '2026-11-10T12:00:00Z' }),
];
const ids = (mood: Parameters<typeof suggestNext>[1], limit = 5) =>
  suggestNext(shelf, mood, { now, seed: 'test', limit }).map((s) => s.record.albumId);

describe('suggestNext', () => {
  it('only ever returns records from the shelf it was given', () => {
    const shelfIds = new Set(shelf.map((r) => r.albumId));
    for (const mood of MOODS) {
      for (const id of ids(mood.id, 50)) expect(shelfIds.has(id)).toBe(true);
    }
    expect(suggestNext([], 'any', { now })).toEqual([]);
  });

  it('includes borrowed records', () => {
    expect(ids('any', 50)).toContain('borrowed-one');
    expect(ids('mellow')).toContain('borrowed-one');
  });

  it('respects the limit and never repeats a record', () => {
    const picked = ids('any', 3);
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
  });

  it('changes with the mood', () => {
    expect(ids('heavy')).toEqual(['paranoid']);
    expect(ids('late_night')).toEqual(['kind-of-blue']);
    expect(ids('groovy')).toEqual(['off-the-wall']);
    expect(ids('mellow').sort()).toEqual(['borrowed-one', 'rumours']);
  });

  it('ranks old favorites by rating, complete albums only', () => {
    expect(ids('favorites')).toEqual(['kind-of-blue', 'rumours', 'paranoid']);
  });

  it('rediscover lists played records rested for a month or more, longest first', () => {
    expect(ids('rediscover')).toEqual(['kind-of-blue', 'paranoid']);
  });

  it('needs-a-rating lists unfinished albums, borrowed first', () => {
    expect(ids('unrated')).toEqual(['borrowed-one', 'off-the-wall']);
  });

  it('gives the same order for the same seed and gives each pick a reason', () => {
    const a = suggestNext(shelf, 'any', { now, seed: 'monday' });
    const b = suggestNext(shelf, 'any', { now, seed: 'monday' });
    expect(a).toEqual(b);
    for (const s of a) expect(s.reason.length).toBeGreaterThan(0);
  });
});

describe('matchesGenreMood', () => {
  it('matches on genre words', () => {
    expect(matchesGenreMood(['Heavy Metal'], 'heavy')).toBe(true);
    expect(matchesGenreMood(['jazz fusion'], 'late_night')).toBe(true);
    expect(matchesGenreMood(['jazz'], 'heavy')).toBe(false);
    expect(matchesGenreMood([], 'mellow')).toBe(false);
    expect(matchesGenreMood(['jazz'], 'favorites')).toBe(false);
  });
});
