/** Small shared building blocks so every screen looks like the same app. */
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, maxContentWidth, radius, spacing, type } from '@/theme/tokens';

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const insets = useSafeAreaInsets();
  const inner = <View style={styles.content}>{children}</View>;
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {scroll ? (
        <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl * 2 }} keyboardShouldPersistTaps="handled">
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </View>
  );
}

/** Title row for pushed screens, with a back link. */
export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const router = useRouter();
  return (
    <View style={styles.pageHeader}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/collection'))}
        style={styles.back}>
        <Text style={styles.backText}>‹ Back</Text>
      </Pressable>
      <View style={styles.rowBetween}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
    </View>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={[styles.rowBetween, styles.sectionTitle]}>
      <Text style={styles.label}>{children}</Text>
      {right}
    </View>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label, onPress, kind = 'secondary', disabled, busy, small, style,
}: {
  label: string; onPress: () => void; kind?: ButtonKind; disabled?: boolean; busy?: boolean; small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        kind === 'primary' && styles.buttonPrimary,
        kind === 'ghost' && styles.buttonGhost,
        kind === 'danger' && styles.buttonDanger,
        off && { opacity: 0.45 },
        pressed && { opacity: 0.7 },
        style,
      ]}>
      {busy ? (
        <ActivityIndicator size="small" color={kind === 'primary' ? colors.accentText : colors.text} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            small && { fontSize: 13 },
            kind === 'primary' && { color: colors.accentText },
            kind === 'danger' && { color: colors.danger },
            kind === 'ghost' && { color: colors.accent },
          ]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, disabled }: { label: string; selected?: boolean; onPress?: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected, disabled && { opacity: 0.35 }]}>
      <Text style={[styles.chipText, selected && { color: colors.accentText }]}>{label}</Text>
    </Pressable>
  );
}

/** A small non-interactive tag, e.g. "Complete" or "Live". */
export function Pill({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'accent' | 'success' | 'danger' }) {
  const color = tone === 'accent' ? colors.accent : tone === 'success' ? colors.success : tone === 'danger' ? colors.danger : colors.textMuted;
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

export function Field({ label, hint, ...input }: { label: string; hint?: string } & TextInputProps) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={[styles.label, { marginBottom: spacing.xs }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        {...input}
        style={[styles.input, input.multiline && { minHeight: 160, textAlignVertical: 'top' }, input.style]}
      />
      {hint ? <Text style={[styles.faint, { marginTop: spacing.xs }]}>{hint}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.accent} />
      <Text style={[styles.muted, { marginTop: spacing.sm }]}>{label}</Text>
    </View>
  );
}

export function ErrorNote({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <View style={styles.errorNote} accessibilityRole="alert">
      <Text style={{ color: colors.danger, fontSize: 14 }}>{message}</Text>
    </View>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.heading}>{title}</Text>
      {body ? <Text style={[styles.muted, { textAlign: 'center', marginTop: spacing.xs }]}>{body}</Text> : null}
      {action ? <View style={{ marginTop: spacing.md }}>{action}</View> : null}
    </View>
  );
}

/** Shared text and layout styles. Import as `s`. */
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.md },
  pageHeader: { marginBottom: spacing.md },
  back: { paddingVertical: spacing.sm, alignSelf: 'flex-start' },
  backText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  title: { ...type.title, color: colors.text },
  heading: { ...type.heading, color: colors.text },
  body: { ...type.body, color: colors.text },
  muted: { ...type.small, color: colors.textMuted },
  faint: { ...type.small, color: colors.textFaint },
  label: { ...type.label, color: colors.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sectionTitle: { marginTop: spacing.lg, marginBottom: spacing.sm, paddingBottom: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border },
  button: {
    minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center',
  },
  buttonSmall: { minHeight: 34, paddingHorizontal: 12 },
  buttonPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  buttonGhost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  buttonDanger: { backgroundColor: 'transparent', borderColor: colors.danger },
  buttonText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  chip: {
    minHeight: 36, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  pill: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  input: {
    minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface,
    color: colors.text, paddingHorizontal: spacing.md, paddingVertical: 10, fontSize: 16,
  },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  center: { padding: spacing.xl, alignItems: 'center', justifyContent: 'center' },
  errorNote: { borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, padding: spacing.sm, marginVertical: spacing.sm },
  empty: { alignItems: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.md },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
});
