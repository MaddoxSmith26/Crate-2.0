import { describe, expect, it } from 'vitest';
import {
  albumProgress,
  buildRanking,
  formatAlbumRating,
  formatTrackRating,
  isValidRating,
  snapRating,
  type RankableAlbum,
  type TrackMark,
} from './ratings';

const rate = (trackId: string, rating: number | null): TrackMark => ({ trackId, rating, isInterlude: false });
const interlude = (trackId: string): TrackMark => ({ trackId, rating: null, isInterlude: true });

describe('isValidRating', () => {
  it('accepts 1.0 to 10.0 on 0.1 steps', () => {
    for (const v of [1, 1.1, 5.5, 7.3, 9.9, 10]) expect(isValidRating(v)).toBe(true);
  });

  it('accepts every one of the 91 legal values despite float error', () => {
    let count = 0;
    for (let tenths = 10; tenths <= 100; tenths += 1) {
      expect(isValidRating(tenths / 10)).toBe(true);
      expect(isValidRating(1 + (tenths - 10) * 0.1)).toBe(true); // accumulated float form
      count += 1;
    }
    expect(count).toBe(91);
  });

  it('rejects out of range, off-step and non-numbers', () => {
    for (const v of [0, 0.9, 10.1, 11, 7.25, 7.33, NaN, Infinity]) expect(isValidRating(v)).toBe(false);
  });
});

describe('snapRating', () => {
  it('snaps to the nearest 0.1 and clamps to the range', () => {
    expect(snapRating(7.26)).toBe(7.3);
    expect(snapRating(7.24)).toBe(7.2);
    expect(snapRating(0)).toBe(1);
    expect(snapRating(42)).toBe(10);
  });
});

describe('albumProgress', () => {
  const tracks = ['t1', 't2', 't3', 't4'];

  it('is not started with no ratings', () => {
    const p = albumProgress(tracks, []);
    expect(p.status).toBe('not_started');
    expect(p.rating).toBeNull();
    expect(p.countableTracks).toBe(4);
  });

  it('is in progress until every non-interlude track is rated', () => {
    const p = albumProgress(tracks, [rate('t1', 8), rate('t2', 9), rate('t3', 7)]);
    expect(p.status).toBe('in_progress');
    expect(p.ratedTracks).toBe(3);
    expect(p.rating).toBeCloseTo(8, 10);
  });

  it('is complete and averages all tracks when all are rated', () => {
    const p = albumProgress(tracks, [rate('t1', 8), rate('t2', 9), rate('t3', 7), rate('t4', 6)]);
    expect(p.status).toBe('complete');
    expect(p.rating).toBeCloseTo(7.5, 10);
  });

  it('leaves interludes out of the average and out of completeness', () => {
    const p = albumProgress(tracks, [interlude('t1'), rate('t2', 9), rate('t3', 8), rate('t4', 7)]);
    expect(p.status).toBe('complete');
    expect(p.countableTracks).toBe(3);
    expect(p.interludeTracks).toBe(1);
    expect(p.rating).toBeCloseTo(8, 10);
  });

  it('is personal: the same track can be an interlude for one person and rated by another', () => {
    const mine = albumProgress(['intro', 'song'], [interlude('intro'), rate('song', 9)]);
    const theirs = albumProgress(['intro', 'song'], [rate('intro', 5), rate('song', 9)]);
    expect(mine.rating).toBeCloseTo(9, 10);
    expect(theirs.rating).toBeCloseTo(7, 10);
    expect(mine.status).toBe('complete');
    expect(theirs.status).toBe('complete');
  });

  it('ignores a leftover rating on a track marked as an interlude', () => {
    const p = albumProgress(['a', 'b'], [{ trackId: 'a', rating: 2, isInterlude: true }, rate('b', 8)]);
    expect(p.rating).toBeCloseTo(8, 10);
  });

  it('is never complete when every track is an interlude', () => {
    const p = albumProgress(['a', 'b'], [interlude('a'), interlude('b')]);
    expect(p.status).toBe('not_started');
    expect(p.rating).toBeNull();
  });

  it('ignores marks for tracks that are not on the album', () => {
    const p = albumProgress(['a'], [rate('a', 6), rate('zzz', 10)]);
    expect(p.rating).toBeCloseTo(6, 10);
    expect(p.status).toBe('complete');
  });

  it('averages 0.1 steps without float drift', () => {
    const p = albumProgress(['a', 'b', 'c'], [rate('a', 7.1), rate('b', 7.2), rate('c', 7.3)]);
    expect(p.rating).toBe(7.2);
  });
});

describe('formatting', () => {
  it('shows album scores to two decimals and track ratings to one', () => {
    expect(formatAlbumRating(8.4666)).toBe('8.47');
    expect(formatAlbumRating(null)).toBe('-');
    expect(formatTrackRating(8)).toBe('8.0');
  });
});

describe('buildRanking', () => {
  const album = (albumId: string, artist: string, title: string, ratings: (number | null)[]): RankableAlbum => {
    const ids = ratings.map((_, i) => `${albumId}-${i}`);
    return {
      albumId,
      artist,
      title,
      progress: albumProgress(ids, ratings.map((r, i) => rate(ids[i]!, r))),
    };
  };

  it('lists only complete albums, highest first', () => {
    const ranking = buildRanking([
      album('a', 'Fleetwood Mac', 'Rumours', [9, 9.5]),
      album('b', 'Pink Floyd', 'The Wall', [8, null]), // in progress
      album('c', 'Steely Dan', 'Aja', [10, 9.8]),
      album('d', 'Nobody', 'Unrated', [null, null]),
    ]);
    expect(ranking.map((r) => r.albumId)).toEqual(['c', 'a']);
    expect(ranking.map((r) => r.rank)).toEqual([1, 2]);
  });

  it('gives equal scores the same rank, ordered by artist then title', () => {
    const ranking = buildRanking([
      album('z', 'ZZ Top', 'Eliminator', [8, 8]),
      album('a', 'ABBA', 'Arrival', [8, 8]),
      album('m', 'Miles Davis', 'Kind of Blue', [9, 9]),
      album('l', 'Low', 'Things We Lost', [7, 7]),
    ]);
    expect(ranking.map((r) => [r.albumId, r.rank])).toEqual([
      ['m', 1],
      ['a', 2],
      ['z', 2],
      ['l', 4],
    ]);
  });
});
