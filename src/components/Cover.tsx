/**
 * Album cover. Falls back to a plain sleeve with the title when there is no
 * cover (manual entries, or albums the Cover Art Archive has no image for).
 */
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Text, View, type DimensionValue } from 'react-native';

import { colors, radius } from '@/theme/tokens';

// A few sleeve tints, picked by title so each placeholder is stable.
const SLEEVES = ['#3B2F2A', '#2F3A33', '#2E3340', '#40302E', '#3A3528', '#33293A'];

function sleeveColor(seed: string): string {
  let sum = 0;
  for (const char of seed) sum += char.charCodeAt(0);
  return SLEEVES[sum % SLEEVES.length]!;
}

export function Cover({
  uri, title, artist, size, dimmed,
}: {
  uri: string | null | undefined; title: string; artist?: string; size: DimensionValue; dimmed?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  const showImage = Boolean(uri) && !failed;
  const small = typeof size === 'number' && size < 90;

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`Cover of ${title}${artist ? ` by ${artist}` : ''}`}
      style={{
        width: size, aspectRatio: 1, borderRadius: small ? radius.sm : radius.md, overflow: 'hidden',
        backgroundColor: sleeveColor(title), opacity: dimmed ? 0.35 : 1,
      }}>
      {showImage ? (
        <Image source={{ uri: uri! }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={150} onError={() => setFailed(true)} />
      ) : (
        <View style={{ flex: 1, padding: small ? 4 : 12, justifyContent: 'flex-end', borderWidth: 1, borderColor: colors.border, borderRadius: small ? radius.sm : radius.md }}>
          {small ? (
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '800' }}>{title.slice(0, 1).toUpperCase()}</Text>
          ) : (
            <>
              <Text numberOfLines={3} style={{ color: colors.text, fontSize: 15, fontWeight: '800' }}>{title}</Text>
              {artist ? <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>{artist}</Text> : null}
            </>
          )}
        </View>
      )}
    </View>
  );
}
