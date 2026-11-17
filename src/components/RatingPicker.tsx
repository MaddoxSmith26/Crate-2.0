/**
 * Picks a rating from 1.0 to 10.0 in steps of 0.1 with two rows of buttons:
 * the whole number, then the decimal. Works the same with mouse, touch and
 * keyboard, and needs no slider precision.
 */
import { Text, View } from 'react-native';

import { MAX_RATING, toTenths } from '@/domain/ratings';
import { spacing } from '@/theme/tokens';

import { Chip, styles as s } from './ui';

export function RatingPicker({ value, onChange, disabled }: { value: number | null; onChange: (rating: number) => void; disabled?: boolean }) {
  const tenths = value === null ? null : toTenths(value);
  const whole = tenths === null ? null : Math.floor(tenths / 10);
  const decimal = tenths === null ? null : tenths % 10;

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={[s.wrap, { gap: 6 }]}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <Chip
            key={n}
            label={String(n)}
            selected={whole === n}
            disabled={disabled}
            // Picking a whole number keeps the decimal, except 10 which has none.
            onPress={() => onChange(n === MAX_RATING ? MAX_RATING : n + (decimal ?? 0) / 10)}
          />
        ))}
      </View>
      <View style={[s.row, { gap: 6, flexWrap: 'wrap' }]}>
        <Text style={s.faint}>and</Text>
        {Array.from({ length: 10 }, (_, i) => i).map((d) => (
          <Chip
            key={d}
            label={`.${d}`}
            selected={whole !== null && decimal === d}
            disabled={disabled || whole === null || (whole === MAX_RATING && d > 0)}
            onPress={() => whole !== null && onChange((whole * 10 + d) / 10)}
          />
        ))}
      </View>
    </View>
  );
}
