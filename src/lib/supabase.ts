/**
 * Supabase client.
 *
 * Keys are read from environment variables that you paste into .env yourself
 * (see .env.example). They are never written in code. The "anon" key is
 * designed to ship inside the app: what protects data is Row Level Security
 * in the database, not the secrecy of this key.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** False until .env has both values. Screens use this to show setup help. */
export const isSupabaseConfigured = url.length > 0 && anonKey.length > 0;

/** Null when not configured, so the app can still open and explain what is missing. */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;
