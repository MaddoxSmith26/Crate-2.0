/** Now playing, what to play next, and my listening history. */
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { AlbumRow } from '@/components/AlbumRow';
import { Cover } from '@/components/Cover';
import { StatsBlock } from '@/components/StatsBlock';
import { Button, Card, Chip, ErrorNote, Loading, Screen, SectionTitle, styles as s } from '@/components/ui';
import { estimateNowPlaying, formatDuration, totalLengthMs } from '@/domain/nowPlaying';
import { MOODS, suggestNext, type MoodId, type ShelfRecord } from '@/domain/suggest';
import { countsByAlbum } from '@/domain/stats';
import { deleteListen, getTracks, listListens, listScores, listShelf, startListening, stopListening, type ListenRow, type Track } from '@/lib/api';
import { useUserId } from '@/lib/auth';
import { useAction, useLoad } from '@/lib/useLoad';
import { colors, spacing } from '@/theme/tokens';

/** After this long past the end of the record, a session is treated as over. */
const GRACE_MS = 30 * 60_000;
const UNKNOWN_LENGTH_LIMIT_MS = 3 * 60 * 60_000;

function NowPlayingCard({ listen, tracks, onStop, busy }: { listen: ListenRow; tracks: Track[]; onStop: () => void; busy: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = now - new Date(listen.listened_at).getTime();
  const estimate = estimateNowPlaying(tracks.map((t) => ({ trackId: t.id, lengthMs: t.length_ms })), elapsed);
  const current = estimate.state === 'playing' ? tracks[estimate.index] : undefined;

  return (
    <Card style={{ borderColor: colors.accent }}>
      <Text style={[s.label, { color: colors.accent, marginBottom: spacing.sm }]}>Now playing</Text>
      <View style={{ flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' }}>
        <Cover uri={listen.cover_url} title={listen.title} artist={listen.artist} size={120} />
        <View style={{ flex: 1, minWidth: 200 }}>
          <Text style={s.heading}>{listen.title}</Text>
          <Text style={s.muted}>{listen.artist}</Text>
          {estimate.state === 'playing' && current ? (
            <View style={{ marginTop: spacing.sm }}>
              <Text style={s.faint}>Probably playing</Text>
              <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>{current.title}</Text>
              <Text style={s.muted}>
                Track {estimate.index + 1} of {tracks.length} · {formatDuration(estimate.positionMs)} / {formatDuration(estimate.lengthMs)}
              </Text>
              <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, marginTop: 8 }}>
                <View style={{ height: 4, width: `${Math.min(100, (estimate.positionMs / estimate.lengthMs) * 100)}%`, backgroundColor: colors.accent, borderRadius: 2 }} />
              </View>
              <Text style={[s.faint, { marginTop: 6 }]}>A guess from track lengths. Flipping the record is not counted.</Text>
            </View>
          ) : estimate.state === 'finished' ? (
            <Text style={[s.body, { marginTop: spacing.sm }]}>The record has probably finished.</Text>
          ) : (
            <Text style={[s.muted, { marginTop: spacing.sm }]}>
              Crate does not have every track length for this album, so it cannot guess the song. Started {formatDuration(elapsed)} ago.
            </Text>
          )}
          <Button label={estimate.state === 'finished' ? 'Done' : 'Stop'} small onPress={onStop} busy={busy} style={{ alignSelf: 'flex-start', marginTop: spacing.md }} />
        </View>
      </View>
    </Card>
  );
}

export default function Play() {
  const userId = useUserId();
  const [mood, setMood] = useState<MoodId>('any');
  const { busy, error, run } = useAction();

  const { data, error: loadError, loading, reload } = useLoad(async () => {
    const [listens, shelf, scores] = await Promise.all([listListens(userId), listShelf(userId), listScores(userId)]);
    // The open now-playing session, if it is still plausibly running.
    let playing = listens.find((l) => l.source === 'now_playing' && !l.ended_at) ?? null;
    let tracks: Track[] = [];
    if (playing) {
      tracks = await getTracks(playing.album_id);
      const total = totalLengthMs(tracks.map((t) => ({ trackId: t.id, lengthMs: t.length_ms })));
      const elapsed = Date.now() - new Date(playing.listened_at).getTime();
      if (elapsed > (total === null ? UNKNOWN_LENGTH_LIMIT_MS : total + GRACE_MS)) {
        await stopListening(playing.listen_id).catch(() => undefined);
        playing = null;
      }
    }
    return { listens, shelf, scores, playing, tracks };
  }, [userId]);

  if (loading) return <Screen><Loading /></Screen>;
  const listens = data?.listens ?? [];
  const playing = data?.playing ?? null;

  // The shelf is the only source of suggestions: records I have right now.
  const counts = countsByAlbum(listens.map((l) => ({ albumId: l.album_id, title: l.title, artist: l.artist, listenedAt: l.listened_at })));
  const lastPlayed = new Map<string, string>();
  for (const listen of listens) if (!lastPlayed.has(listen.album_id)) lastPlayed.set(listen.album_id, listen.listened_at);
  const scoreOf = new Map((data?.scores ?? []).map((sc) => [sc.album_id, sc]));
  const shelfRecords = new Map<string, ShelfRecord>();
  for (const item of data?.shelf ?? []) {
    if (shelfRecords.has(item.album_id)) continue; // two copies of one album are one suggestion
    const score = scoreOf.get(item.album_id);
    shelfRecords.set(item.album_id, {
      albumId: item.album_id, title: item.title, artist: item.artist, genres: item.genres ?? [],
      rating: score?.rating ?? null, isComplete: score?.status === 'complete',
      listenCount: counts.get(item.album_id) ?? 0, lastListenedAt: lastPlayed.get(item.album_id) ?? null, borrowed: item.borrowed,
    });
  }
  const covers = new Map((data?.shelf ?? []).map((item) => [item.album_id, item.cover_url]));
  const suggestions = suggestNext([...shelfRecords.values()].filter((r) => r.albumId !== playing?.album_id), mood);
  const play = (albumId: string) => run(async () => { await startListening(albumId); await reload(); });

  return (
    <Screen>
      <ErrorNote message={error ?? loadError} />
      {playing ? (
        <NowPlayingCard listen={playing} tracks={data?.tracks ?? []} busy={busy} onStop={() => run(async () => { await stopListening(playing.listen_id); await reload(); })} />
      ) : (
        <Card>
          <Text style={s.label}>Now playing</Text>
          <Text style={[s.body, { marginTop: 4 }]}>Nothing on the turntable.</Text>
          <Text style={s.muted}>Tap Play on a suggestion below, or Play now on any album you have.</Text>
        </Card>
      )}

      <SectionTitle>What to play next</SectionTitle>
      <View style={[s.wrap, { marginBottom: spacing.sm }]}>
        {MOODS.map((m) => (
          <Chip key={m.id} label={m.label} selected={mood === m.id} onPress={() => setMood(m.id)} />
        ))}
      </View>
      <Text style={[s.faint, { marginBottom: spacing.xs }]}>
        {MOODS.find((m) => m.id === mood)?.hint}. Only from records you have right now, including ones you are borrowing.
      </Text>
      {shelfRecords.size === 0 ? (
        <Text style={s.muted}>Add records to your collection to get suggestions.</Text>
      ) : suggestions.length === 0 ? (
        <Text style={s.muted}>
          {mood === 'any' ? 'The only record on your shelf is the one playing.' : 'Nothing on your shelf fits this mood. Try another.'}
        </Text>
      ) : (
        suggestions.map(({ record, reason }) => (
          <AlbumRow
            key={record.albumId}
            albumId={record.albumId}
            title={record.title}
            artist={record.artist}
            coverUrl={covers.get(record.albumId) ?? null}
            detail={record.borrowed ? `Borrowed · ${reason}` : reason}
            right={<Button label="Play" small kind="primary" busy={busy} onPress={() => play(record.albumId)} />}
          />
        ))
      )}

      <StatsBlock listens={listens} />

      {listens.length > 0 ? (
        <>
          <SectionTitle>Recent listens</SectionTitle>
          {listens.slice(0, 12).map((listen) => (
            <AlbumRow
              key={listen.listen_id}
              albumId={listen.album_id}
              title={listen.title}
              artist={listen.artist}
              coverUrl={listen.cover_url}
              detail={new Date(listen.listened_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
              right={<Button label="Remove" small kind="ghost" onPress={() => run(async () => { await deleteListen(listen.listen_id); await reload(); })} />}
            />
          ))}
        </>
      ) : null}
    </Screen>
  );
}
