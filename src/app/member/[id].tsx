/** A family member: their ranking, their records and their listening. */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from 'react-native';

import { AlbumGrid, type GridItem } from '@/components/AlbumGrid';
import { AlbumRow } from '@/components/AlbumRow';
import { StatsBlock } from '@/components/StatsBlock';
import { Button, Empty, ErrorNote, Loading, PageHeader, Screen, SectionTitle, styles as s } from '@/components/ui';
import { formatAlbumRating } from '@/domain/ratings';
import { getProfile, listCollection, listListens, listScores } from '@/lib/api';
import { rankScores } from '@/lib/ranking';
import { useLoad } from '@/lib/useLoad';
import { colors } from '@/theme/tokens';

export default function Member() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data, error, loading } = useLoad(async () => {
    const [profile, collection, scores, listens] = await Promise.all([getProfile(id), listCollection(id), listScores(id), listListens(id)]);
    return { profile, collection, scores, listens };
  }, [id]);

  if (loading) return <Screen><Loading /></Screen>;
  if (!data?.profile) {
    return (
      <Screen>
        <PageHeader title="Family member" />
        <ErrorNote message={error} />
        <Empty title="Not found" body="You can only see people in your family group." />
      </Screen>
    );
  }

  const name = data.profile.display_name;
  const ranking = rankScores(data.scores);
  const seen = new Set<string>();
  const tiles: GridItem[] = [];
  for (const item of data.collection) {
    if (seen.has(item.album_id)) continue;
    seen.add(item.album_id);
    tiles.push({
      key: item.copy_id, albumId: item.album_id, title: item.title, artist: item.artist, coverUrl: item.cover_url,
      dimmed: Boolean(item.lent_to), caption: item.lent_to_name ? `With ${item.lent_to_name}` : undefined,
    });
  }

  return (
    <Screen>
      <PageHeader title={name} subtitle={`${tiles.length} album${tiles.length === 1 ? '' : 's'} · ${ranking.length} ranked`} right={<Button label="Compare with mine" small onPress={() => router.push(`/compare?with=${id}`)} />} />

      <SectionTitle>{name}'s ranking</SectionTitle>
      {ranking.length === 0 ? <Text style={s.muted}>Nothing fully rated yet.</Text> : null}
      {ranking.slice(0, 10).map((item) => (
        <AlbumRow
          key={item.albumId} albumId={item.albumId} title={item.title} artist={item.artist} coverUrl={item.coverUrl}
          leading={String(item.rank)} href={`/album/${item.albumId}?user=${id}`}
          right={<Text style={{ color: colors.accent, fontSize: 18, fontWeight: '800' }}>{formatAlbumRating(item.rating)}</Text>}
        />
      ))}
      {ranking.length > 10 ? <Text style={s.faint}>Showing the top 10 of {ranking.length}. Compare to see them all.</Text> : null}

      <SectionTitle>{name}'s records</SectionTitle>
      {tiles.length === 0 ? <Text style={s.muted}>No records yet.</Text> : <AlbumGrid items={tiles} />}

      <StatsBlock listens={data.listens} whose={`${name}'s`} />
    </Screen>
  );
}
