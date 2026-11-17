/** Listening stats: all-time totals, top record and artist, and a yearly recap. */
import { useState } from 'react';
import { Text, View } from 'react-native';

import { computeStats, yearRecap, yearsWithListens, type ListenEntry, type Tally } from '@/domain/stats';
import type { ListenRow } from '@/lib/api';
import { colors, spacing } from '@/theme/tokens';

import { Card, Chip, SectionTitle, styles as s } from './ui';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const plural = (n: number) => `${n} listen${n === 1 ? '' : 's'}`;

function Big({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ minWidth: 96 }}>
      <Text style={{ color: colors.text, fontSize: 28, fontWeight: '800' }}>{value}</Text>
      <Text style={s.label}>{label}</Text>
    </View>
  );
}

function TopList({ title, items }: { title: string; items: Tally[] }) {
  return (
    <View style={{ flex: 1, minWidth: 220 }}>
      <Text style={[s.label, { marginBottom: spacing.xs }]}>{title}</Text>
      {items.map((item, index) => (
        <View key={item.key} style={[s.rowBetween, { paddingVertical: 4 }]}>
          <Text numberOfLines={1} style={[s.body, { flex: 1 }]}>
            <Text style={{ color: colors.accent, fontWeight: '800' }}>{index + 1}  </Text>
            {item.label}
            {item.sublabel ? <Text style={{ color: colors.textFaint }}>  {item.sublabel}</Text> : null}
          </Text>
          <Text style={s.muted}>{item.count}</Text>
        </View>
      ))}
    </View>
  );
}

export function StatsBlock({ listens, whose = 'My' }: { listens: ListenRow[]; whose?: string }) {
  const entries: ListenEntry[] = listens.map((l) => ({ albumId: l.album_id, title: l.title, artist: l.artist, listenedAt: l.listened_at }));
  const years = yearsWithListens(entries);
  const [year, setYear] = useState<number | null>(null);
  const all = computeStats(entries);

  if (all.totalListens === 0) {
    return (
      <>
        <SectionTitle>{whose} listening</SectionTitle>
        <Text style={s.muted}>No listens logged yet. Tap Play now on an album, or log a past listen from its page.</Text>
      </>
    );
  }

  const shownYear = year ?? years[0]!;
  const recap = yearRecap(entries, shownYear);

  return (
    <>
      <SectionTitle>{whose} listening, all time</SectionTitle>
      <View style={[s.wrap, { gap: spacing.lg, marginBottom: spacing.md }]}>
        <Big value={String(all.totalListens)} label={all.totalListens === 1 ? 'Listen' : 'Listens'} />
        <Big value={String(all.distinctAlbums)} label="Albums" />
        <Big value={String(all.distinctArtists)} label="Artists" />
      </View>
      <View style={[s.wrap, { gap: spacing.md }]}>
        <Card style={{ flex: 1, minWidth: 220 }}>
          <Text style={s.label}>Most-listened record</Text>
          <Text style={[s.heading, { marginTop: 4 }]}>{all.topAlbum?.label}</Text>
          <Text style={s.muted}>
            {all.topAlbum?.sublabel} · {plural(all.topAlbum?.count ?? 0)}
          </Text>
        </Card>
        <Card style={{ flex: 1, minWidth: 220 }}>
          <Text style={s.label}>Most-listened artist</Text>
          <Text style={[s.heading, { marginTop: 4 }]}>{all.topArtist?.label}</Text>
          <Text style={s.muted}>{plural(all.topArtist?.count ?? 0)}</Text>
        </Card>
      </View>

      <SectionTitle>{shownYear} in review</SectionTitle>
      <View style={[s.wrap, { marginBottom: spacing.md }]}>
        {years.map((y) => (
          <Chip key={y} label={String(y)} selected={y === shownYear} onPress={() => setYear(y)} />
        ))}
      </View>
      <Card>
        <View style={[s.wrap, { gap: spacing.lg, marginBottom: spacing.md }]}>
          <Big value={String(recap.totalListens)} label={recap.totalListens === 1 ? 'Listen' : 'Listens'} />
          <Big value={String(recap.distinctAlbums)} label="Albums" />
          <Big value={recap.busiestMonth === null ? '-' : MONTHS[recap.busiestMonth]!.slice(0, 3)} label="Busiest month" />
        </View>
        {/* Listens per month. Bar height is relative to the busiest month. */}
        <View accessibilityLabel={`Listens per month in ${shownYear}: ${recap.byMonth.map((n, i) => `${MONTHS[i]} ${n}`).join(', ')}`} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 70, marginBottom: spacing.md }}>
          {recap.byMonth.map((count, month) => {
            const max = Math.max(...recap.byMonth, 1);
            return (
              <View key={month} style={{ flex: 1, alignItems: 'center' }}>
                <View style={{ width: '100%', height: Math.max(2, (count / max) * 52), backgroundColor: count > 0 ? colors.accent : colors.border, borderRadius: 2 }} />
                <Text style={{ color: colors.textFaint, fontSize: 10, marginTop: 3 }}>{MONTHS[month]!.slice(0, 1)}</Text>
              </View>
            );
          })}
        </View>
        <View style={[s.wrap, { gap: spacing.lg }]}>
          <TopList title="Top records" items={recap.topAlbums} />
          <TopList title="Top artists" items={recap.topArtists} />
        </View>
        <Text style={[s.faint, { marginTop: spacing.md }]}>A recap only looks back at one year. All-time totals never reset.</Text>
      </Card>
    </>
  );
}
