/** One album in a list: small cover, title, artist, and something on the right. */
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { colors } from '@/theme/tokens';

import { Cover } from './Cover';
import { styles as s } from './ui';

export function AlbumRow({
  albumId, title, artist, coverUrl, leading, detail, right, href,
}: {
  albumId: string; title: string; artist: string; coverUrl: string | null;
  /** Shown before the cover, e.g. a rank number. */
  leading?: string;
  /** Third line, e.g. "3 of 11 tracks rated". */
  detail?: string;
  right?: ReactNode;
  href?: string;
}) {
  const router = useRouter();
  return (
    <View style={s.listRow}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${title} by ${artist}`}
        onPress={() => router.push(href ?? `/album/${albumId}`)}
        style={[s.row, { flex: 1, gap: 12 }]}>
        {leading !== undefined ? (
          <Text style={{ color: colors.accent, fontSize: 18, fontWeight: '800', width: 34, textAlign: 'right' }}>{leading}</Text>
        ) : null}
        <Cover uri={coverUrl} title={title} size={52} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{title}</Text>
          <Text numberOfLines={1} style={s.muted}>{artist}</Text>
          {detail ? <Text numberOfLines={1} style={s.faint}>{detail}</Text> : null}
        </View>
      </Pressable>
      {right}
    </View>
  );
}
