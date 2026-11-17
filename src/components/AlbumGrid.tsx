/** The crate: a responsive grid of covers. Album art carries the design. */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { colors, spacing } from '@/theme/tokens';

import { Cover } from './Cover';

export interface GridItem {
  key: string;
  albumId: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  /** Second line under the artist, e.g. "Sam's" or "With Alex". */
  caption?: string;
  /** Greyed out, for records that are lent out. */
  dimmed?: boolean;
  /** Small tag over the cover corner, e.g. "x2" or "Borrowed". */
  badge?: string;
}

const GAP = spacing.md;

export function AlbumGrid({ items, hrefFor }: { items: GridItem[]; hrefFor?: (item: GridItem) => string }) {
  const router = useRouter();
  const [width, setWidth] = useState(0);
  // Aim for covers about 170 wide: 2 across on a phone, up to 6 on desktop.
  const columns = Math.max(2, Math.min(6, Math.floor((width + GAP) / (170 + GAP))));
  const tile = width > 0 ? Math.floor((width - GAP * (columns - 1)) / columns) : 0;

  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
      {tile > 0 &&
        items.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole="link"
            accessibilityLabel={`${item.title} by ${item.artist}${item.caption ? `, ${item.caption}` : ''}`}
            onPress={() => router.push(hrefFor ? hrefFor(item) : `/album/${item.albumId}`)}
            style={({ pressed }) => ({ width: tile, opacity: pressed ? 0.7 : 1 })}>
            <View>
              <Cover uri={item.coverUrl} title={item.title} artist={item.artist} size={tile} dimmed={item.dimmed} />
              {item.badge ? (
                <View style={{ position: 'absolute', top: 6, right: 6, backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text style={{ color: colors.accentText, fontSize: 11, fontWeight: '800' }}>{item.badge}</Text>
                </View>
              ) : null}
            </View>
            <Text numberOfLines={1} style={{ color: item.dimmed ? colors.textMuted : colors.text, fontSize: 14, fontWeight: '700', marginTop: 6 }}>{item.title}</Text>
            <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: 12 }}>{item.artist}</Text>
            {item.caption ? <Text numberOfLines={1} style={{ color: item.dimmed ? colors.accent : colors.textFaint, fontSize: 12 }}>{item.caption}</Text> : null}
          </Pressable>
        ))}
    </View>
  );
}
