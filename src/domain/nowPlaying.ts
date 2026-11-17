/**
 * "Now playing" estimate.
 *
 * When someone taps an album to start it, Crate uses track lengths and the
 * time since the tap to guess which song is on. It is an estimate: it ignores
 * the pause while a record is flipped, which is why the UI says "probably".
 */

export interface TimedTrack {
  trackId: string;
  /** Length in milliseconds. Null when the catalog has no length for it. */
  lengthMs: number | null;
}

export type NowPlaying =
  | {
      state: 'playing';
      trackId: string;
      /** Zero-based index into the tracklist. */
      index: number;
      /** How far into the track we probably are. */
      positionMs: number;
      lengthMs: number;
    }
  /** Past the end of the last track. */
  | { state: 'finished' }
  /** A track length is missing before the current point, so no honest guess exists. */
  | { state: 'unknown' };

/**
 * @param tracks the album's tracks in play order
 * @param elapsedMs time since the record was started
 */
export function estimateNowPlaying(tracks: readonly TimedTrack[], elapsedMs: number): NowPlaying {
  if (tracks.length === 0 || elapsedMs < 0) return { state: 'unknown' };

  let cursor = 0;
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index]!;
    if (track.lengthMs === null || track.lengthMs <= 0) return { state: 'unknown' };
    if (elapsedMs < cursor + track.lengthMs) {
      return {
        state: 'playing',
        trackId: track.trackId,
        index,
        positionMs: elapsedMs - cursor,
        lengthMs: track.lengthMs,
      };
    }
    cursor += track.lengthMs;
  }
  return { state: 'finished' };
}

/** Total running time, or null if any track length is missing. */
export function totalLengthMs(tracks: readonly TimedTrack[]): number | null {
  let total = 0;
  for (const track of tracks) {
    if (track.lengthMs === null) return null;
    total += track.lengthMs;
  }
  return total;
}

/** Formats milliseconds as m:ss, e.g. 245000 -> "4:05". */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '-:--';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
