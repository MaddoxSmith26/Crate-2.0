import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { isSupabaseConfigured } from '@/lib/supabase';
import { colors, radius, spacing, type } from '@/theme/tokens';

/**
 * Phase 1 placeholder home. It proves the app runs and reports whether the
 * Supabase keys are in place. Sign-in replaces this in phase 2.
 */
export default function Home() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Phase 1 · Scaffold</Text>
      <Text style={styles.wordmark}>Crate</Text>
      <Text style={styles.tagline}>A home for the family record collection.</Text>

      <View style={styles.card}>
        <View style={[styles.dot, { backgroundColor: isSupabaseConfigured ? colors.success : colors.accent }]} />
        <View style={styles.cardText}>
          <Text style={styles.cardTitle}>
            {isSupabaseConfigured ? 'Supabase keys found' : 'Supabase keys not set yet'}
          </Text>
          <Text style={styles.cardBody}>
            {isSupabaseConfigured
              ? 'The app can reach your project. Accounts arrive in phase 2.'
              : 'Copy .env.example to .env, paste your project URL and anon key, then restart the dev server.'}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: spacing.xl * 2, maxWidth: 560, width: '100%', alignSelf: 'center' },
  label: { ...type.label, color: colors.accent, marginBottom: spacing.sm },
  wordmark: { ...type.display, color: colors.text },
  tagline: { ...type.body, color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.xl },
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 7 },
  cardText: { flex: 1 },
  cardTitle: { ...type.body, color: colors.text, fontWeight: '700' },
  cardBody: { ...type.small, color: colors.textMuted, marginTop: spacing.xs },
});
