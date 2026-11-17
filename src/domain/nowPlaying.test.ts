import { describe, expect, it } from 'vitest';
import { estimateNowPlaying, formatDuration, totalLengthMs, type TimedTrack } from './nowPlaying';

const min = (m: number) => m * 60_000;
const tracks: TimedTrack[] = [
  { trackId: 'a', lengthMs: min(3) },
  { trackId: 'b', lengthMs: min(4) },
  { trackId: 'c', lengthMs: min(5) },
];

describe('estimateNowPlaying', () => {
  it('starts on the first track', () => {
    expect(estimateNowPlaying(tracks, 0)).toMatchObject({ state: 'playing', trackId: 'a', index: 0, positionMs: 0 });
  });

  it('finds the track part way through the album', () => {
    expect(estimateNowPlaying(tracks, min(3) + 30_000)).toMatchObject({ state: 'playing', trackId: 'b', positionMs: 30_000 });
  });

  it('moves to the next track exactly on the boundary', () => {
    expect(estimateNowPlaying(tracks, min(7))).toMatchObject({ state: 'playing', trackId: 'c', positionMs: 0 });
  });

  it('is finished once the last track has ended', () => {
    expect(estimateNowPlaying(tracks, min(12))).toEqual({ state: 'finished' });
  });

  it('is unknown when a needed track length is missing', () => {
    const gappy: TimedTrack[] = [{ trackId: 'a', lengthMs: min(3) }, { trackId: 'b', lengthMs: null }, { trackId: 'c', lengthMs: min(5) }];
    expect(estimateNowPlaying(gappy, min(1))).toMatchObject({ state: 'playing', trackId: 'a' });
    expect(estimateNowPlaying(gappy, min(4))).toEqual({ state: 'unknown' });
  });

  it('is unknown for an empty tracklist or negative time', () => {
    expect(estimateNowPlaying([], 1000)).toEqual({ state: 'unknown' });
    expect(estimateNowPlaying(tracks, -1)).toEqual({ state: 'unknown' });
  });
});

describe('totalLengthMs and formatDuration', () => {
  it('adds up track lengths, or gives null if any is missing', () => {
    expect(totalLengthMs(tracks)).toBe(min(12));
    expect(totalLengthMs([...tracks, { trackId: 'd', lengthMs: null }])).toBeNull();
  });

  it('formats as m:ss', () => {
    expect(formatDuration(245_000)).toBe('4:05');
    expect(formatDuration(59_600)).toBe('1:00');
    expect(formatDuration(null)).toBe('-:--');
  });
});
