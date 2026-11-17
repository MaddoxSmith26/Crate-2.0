import { buildRanking, type RankedAlbum } from '@/domain/ratings';

import type { AlbumScore } from './api';

export type RankedScore = RankedAlbum & { coverUrl: string | null };

/** Turns database score rows into one person's ranking (Complete albums only). */
export function rankScores(scores: AlbumScore[]): RankedScore[] {
  const covers = new Map(scores.map((sc) => [sc.album_id, sc.cover_url]));
  return buildRanking(
    scores.map((sc) => ({
      albumId: sc.album_id,
      title: sc.title,
      artist: sc.artist,
      progress: {
        status: sc.status, rating: sc.rating, countableTracks: sc.countable_tracks, ratedTracks: sc.rated_tracks, interludeTracks: sc.interlude_tracks,
      },
    })),
  ).map((ranked) => ({ ...ranked, coverUrl: covers.get(ranked.albumId) ?? null }));
}
