import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Card, Loading, Screen, styles as s } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase';
import { colors, spacing } from '@/theme/tokens';

/** Shown until the Supabase keys are in .env. */
function SetupScreen() {
  return (
    <Screen>
      <View style={{ maxWidth: 560, width: '100%', alignSelf: 'center', paddingTop: spacing.xl }}>
        <Text style={[s.label, { color: colors.accent }]}>Setup</Text>
        <Text style={[s.title, { fontSize: 40 }]}>Crate</Text>
        <Text style={[s.muted, { marginBottom: spacing.lg }]}>A home for the family record collection.</Text>
        <Card>
          <Text style={s.heading}>Supabase keys not set yet</Text>
          <Text style={[s.muted, { marginTop: spacing.xs }]}>
            Copy .env.example to .env, paste your project URL and anon key, then restart the dev server. The README has the steps.
          </Text>
        </Card>
      </View>
    </Screen>
  );
}

/**
 * Signed-out people can only reach sign-in, and signed-in people everything
 * else. When a guard turns false the router leaves those screens by itself.
 */
function Gate() {
  const { loading, session } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
        <Loading label="Opening the crate" />
      </View>
    );
  }
  const signedIn = session !== null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background }, animation: 'fade' }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="add" />
        <Stack.Screen name="add-manual" />
        <Stack.Screen name="album/[id]" />
        <Stack.Screen name="member/[id]" />
        <Stack.Screen name="track/[id]" />
        <Stack.Screen name="compare" />
        <Stack.Screen name="notifications" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {isSupabaseConfigured ? (
        <AuthProvider>
          <Gate />
        </AuthProvider>
      ) : (
        <SetupScreen />
      )}
    </SafeAreaProvider>
  );
}
