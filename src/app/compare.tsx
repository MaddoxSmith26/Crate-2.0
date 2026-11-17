/** Two personal rankings side by side. There is no combined family ranking. */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Cover } from '@/components/Cover';
import { Chip, Empty, ErrorNote, Loading, PageHeader, Screen, styles as s } from '@/components/ui';
import { formatAlbumRating } from '@/domain/ratings';
import { listProfiles, listScores } from '@/lib/api';
import { useUserId } from '@/lib/auth';
import { rankScores, type RankedScore } from '@/lib/ranking';
import { useLoad } from '@/lib/useLoad';
import { colors, spacing } from '@/theme/tokens';

function Column({ name, ranking, other, otherName, userParam }: { name: string; ranking: RankedScore[]; other: RankedScore[]; otherName: string; userParam: string | null }) {
  const router = useRouter();
  const otherRank = new Map(other.map((r) => [r.albumId, r.rank]));
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={[s.heading, { marginBottom: spacing.sm }]} numberOfLines={1}>{name}</Text>
      {ranking.length === 0 ? <Text style={s.muted}>Nothing ranked yet.</Text> : null}
      {ranking.map((item) => {
        const theirs = otherRank.get(item.albumId);
        return (
          <Pressable
            key={item.albumId}
            accessibilityRole="link"
            accessibilityLabel={`${name} number ${item.rank}: ${item.title}, ${formatAlbumRating(item.rating)}${theirs ? `. Number ${theirs} for ${otherName}` : ''}`}
            onPress={() => router.push(userParam ? `/album/${item.albumId}?user=${userParam}` : `/album/${item.albumId}`)}
            style={{ flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ color: colors.accent, fontWeight: '800', width: 22, textAlign: 'right', fontSize: 14 }}>{item.rank}</Text>
            <Cover uri={item.coverUrl} title={item.title} size={38} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{item.title}</Text>
              <Text numberOfLines={1} style={{ color: theirs ? colors.success : colors.textFaint, fontSize: 11 }}>
                {formatAlbumRating(item.rating)}
                {theirs ? ` · #${theirs} for ${otherName === 'Me' ? 'me' : otherName}` : ''}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function Compare() {
  const me = useUserId();
  const params = useLocalSearchParams<{ with?: string }>();
  const [left, setLeft] = useState(me);
  const [right, setRight] = useState<string | null>(params.with ?? null);

  const { data, error, loading } = useLoad(async () => {
    const profiles = await listProfiles();
    const rightId = right ?? profiles.find((p) => p.id !== me)?.id ?? null;
    const [a, b] = await Promise.all([listScores(left), rightId ? listScores(rightId) : Promise.resolve([])]);
    return { profiles, rightId, a: rankScores(a), b: rankScores(b) };
  }, [me, left, right]);

  if (loading) return <Screen><Loading /></Screen>;
  const profiles = data?.profiles ?? [];
  const nameOf = (id: string | null) => (id === me ? 'Me' : (profiles.find((p) => p.id === id)?.display_name ?? '-'));
  const shared = data ? data.a.filter((x) => data.b.some((y) => y.albumId === x.albumId)).length : 0;

  return (
    <Screen>
      <PageHeader title="Compare rankings" subtitle="Each ranking stays its owner's. This only puts two next to each other." />
      <ErrorNote message={error} />
      {profiles.length < 2 || !data?.rightId ? (
        <Empty title="Nobody to compare with yet" body="Once someone joins your family group, their ranking shows up here." />
      ) : (
        <>
          {[{ value: left, set: setLeft, label: 'Left' }, { value: data.rightId, set: setRight, label: 'Right' }].map((side) => (
            <View key={side.label} style={[s.row, { flexWrap: 'wrap', marginBottom: spacing.sm }]}>
              <Text style={[s.label, { width: 44 }]}>{side.label}</Text>
              {profiles.map((p) => (
                <Chip key={p.id} label={p.id === me ? 'Me' : p.display_name} selected={side.value === p.id} onPress={() => side.set(p.id)} />
              ))}
            </View>
          ))}
          <Text style={[s.muted, { marginBottom: spacing.md }]}>
            {shared === 0 ? 'No albums ranked by both yet.' : `${shared} album${shared === 1 ? '' : 's'} ranked by both, marked in green.`}
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Column name={nameOf(left)} ranking={data.a} other={data.b} otherName={nameOf(data.rightId)} userParam={left === me ? null : left} />
            <Column name={nameOf(data.rightId)} ranking={data.b} other={data.a} otherName={nameOf(left)} userParam={data.rightId === me ? null : data.rightId} />
          </View>
        </>
      )}
    </Screen>
  );
}
