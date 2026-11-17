import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { AlbumRow } from '@/components/AlbumRow';
import { Chip, Empty, ErrorNote, Loading, Screen, SectionTitle, styles as s } from '@/components/ui';
import { formatAlbumRating } from '@/domain/ratings';
import { listProfiles, listScores } from '@/lib/api';
import { useUserId } from '@/lib/auth';
import { rankScores } from '@/lib/ranking';
import { useLoad } from '@/lib/useLoad';
import { colors, spacing } from '@/theme/tokens';

export default function Ranking() {
  const userId = useUserId();
  const router = useRouter();
  const { data, error, loading } = useLoad(async () => ({ scores: await listScores(userId), profiles: await listProfiles() }), [userId]);

  if (loading) return <Screen><Loading /></Screen>;
  const scores = data?.scores ?? [];
  const ranking = rankScores(scores);
  const inProgress = scores.filter((sc) => sc.status === 'in_progress').sort((a, b) => a.title.localeCompare(b.title));
  const others = (data?.profiles ?? []).filter((p) => p.id !== userId);

  return (
    <Screen>
      <Text style={s.title}>My ranking</Text>
      <Text style={[s.muted, { marginBottom: spacing.sm }]}>Albums I have fully rated, best first. It is mine alone: nobody else's ratings change it.</Text>
      <ErrorNote message={error} />

      {others.length > 0 ? (
        <View style={[s.row, { flexWrap: 'wrap', marginBottom: spacing.sm }]}>
          <Text style={s.label}>Compare with</Text>
          {others.map((p) => (
            <Chip key={p.id} label={p.display_name} onPress={() => router.push(`/compare?with=${p.id}`)} />
          ))}
        </View>
      ) : null}

      {ranking.length === 0 ? (
        <Empty title="Nothing ranked yet" body="Rate every track on an album and it lands here." />
      ) : (
        ranking.map((item) => (
          <AlbumRow
            key={item.albumId}
            albumId={item.albumId}
            title={item.title}
            artist={item.artist}
            coverUrl={item.coverUrl}
            leading={String(item.rank)}
            right={<Text style={{ color: colors.accent, fontSize: 20, fontWeight: '800' }}>{formatAlbumRating(item.rating)}</Text>}
          />
        ))
      )}

      {inProgress.length > 0 ? (
        <>
          <SectionTitle>In progress, not ranked yet</SectionTitle>
          {inProgress.map((sc) => (
            <AlbumRow
              key={sc.album_id}
              albumId={sc.album_id}
              title={sc.title}
              artist={sc.artist}
              coverUrl={sc.cover_url}
              detail={`${sc.rated_tracks} of ${sc.countable_tracks} tracks rated`}
              right={<Text style={s.muted}>{formatAlbumRating(sc.rating)} so far</Text>}
            />
          ))}
        </>
      ) : null}
    </Screen>
  );
}
