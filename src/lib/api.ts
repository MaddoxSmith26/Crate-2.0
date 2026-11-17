/**
 * Data access. Every read and write to Supabase goes through this file.
 *
 * Reads use database views that already apply the visibility rules (Row
 * Level Security), and multi-step changes use database functions, so the
 * rules are enforced by the database and not by this code.
 */
import type { PostgrestError } from '@supabase/supabase-js';

import { supabase } from './supabase';

// ------------------------------------------------------------------ types
export interface Profile { id: string; display_name: string }
export interface Group { id: string; name: string; join_code: string }
export interface Album {
  id: string; mbid: string | null; title: string; artist: string; year: number | null;
  cover_url: string | null; genres: string[]; is_manual: boolean;
}
export interface Track {
  id: string; album_id: string; disc: number; position: number; title: string;
  length_ms: number | null; recording_mbid: string | null;
}
export interface CollectionItem {
  copy_id: string; owner_id: string; owner_name: string; album_id: string; title: string; artist: string;
  year: number | null; cover_url: string | null; pressing_note: string | null; added_at: string;
  loan_id: string | null; lent_to: string | null; lent_to_name: string | null; lent_at: string | null;
}
export interface OwnedAlbum {
  owner_id: string; album_id: string; mbid: string | null; title: string; artist: string;
  active_copies: number; removed_copies: number;
}
export interface AlbumScore {
  user_id: string; album_id: string; title: string; artist: string; year: number | null; cover_url: string | null;
  countable_tracks: number; rated_tracks: number; interlude_tracks: number; rating: number | null;
  status: 'not_started' | 'in_progress' | 'complete';
}
export interface AlbumMark { user_id: string; album_id: string; track_id: string; rating: number | null; is_interlude: boolean }
export interface LoanDetail {
  loan_id: string; copy_id: string; status: 'requested' | 'approved' | 'declined' | 'returned' | 'canceled';
  owner_id: string; owner_name: string; borrower_id: string; borrower_name: string; album_id: string;
  title: string; artist: string; cover_url: string | null; requested_at: string; decided_at: string | null; returned_at: string | null;
}
export interface ShelfItem {
  holder_id: string; copy_id: string; album_id: string; title: string; artist: string; year: number | null;
  cover_url: string | null; genres: string[]; borrowed: boolean; owner_id: string; owner_name: string;
}
export interface Notification {
  id: string; kind: string; title: string; body: string; data: { album_id?: string; loan_id?: string };
  created_at: string; read_at: string | null;
}
export interface WishlistRow {
  item_id: string; user_id: string; user_name: string; album_id: string; title: string; artist: string;
  year: number | null; cover_url: string | null; note: string | null; added_at: string;
  /** Always null on your own wishlist: the database hides claims from the wisher. */
  claim_id: string | null; claimer_id: string | null; claimer_name: string | null; claim_expires_at: string | null;
}
export interface ListenRow {
  listen_id: string; user_id: string; album_id: string; title: string; artist: string; year: number | null;
  cover_url: string | null; listened_at: string; source: 'now_playing' | 'manual'; ended_at: string | null;
}

// ---------------------------------------------------------------- plumbing
const FRIENDLY: Record<string, string> = {
  not_signed_in: 'Please sign in again.',
  already_in_group: 'You are already in a family group. Leave it first to join another.',
  invalid_join_code: 'That join code did not match a family group. Check it and try again.',
  record_not_found: 'That record is no longer in the collection.',
  cannot_borrow_your_own_record: 'That record is already yours.',
  not_in_same_group: 'You can only borrow from people in your family group.',
  record_already_lent_out: 'Someone else has that record right now.',
  already_requested: 'You have already asked to borrow this.',
  loan_not_found: 'That request could not be found.',
  loan_already_decided: 'That request was already answered.',
  loan_not_active: 'That record is not out on loan.',
  record_is_lent_out: 'This record is lent out. Mark it as returned before removing it.',
  wishlist_item_not_found: 'That wishlist item is no longer there.',
  already_claimed: 'Someone is already getting this one.',
  tracks_required: 'An album needs at least one track.',
};

function describe(error: PostgrestError): string {
  for (const [key, message] of Object.entries(FRIENDLY)) {
    if (error.message.includes(key)) return message;
  }
  if (error.code === '42501') return 'You do not have permission to do that.';
  if (error.code === '23505') return 'That is already saved.';
  return error.message || 'Something went wrong. Please try again.';
}

function db() {
  if (!supabase) throw new Error('Supabase is not set up yet. Add your keys to .env and restart.');
  return supabase;
}

function unwrap<T>(result: { data: T | null; error: PostgrestError | null }): T {
  if (result.error) throw new Error(describe(result.error));
  return result.data as T;
}

function ok(result: { error: PostgrestError | null }): void {
  if (result.error) throw new Error(describe(result.error));
}

// ------------------------------------------------------ profiles and groups
export const getProfile = async (id: string) =>
  unwrap<Profile | null>(await db().from('profiles').select('*').eq('id', id).maybeSingle());

export const updateDisplayName = async (id: string, name: string) =>
  ok(await db().from('profiles').update({ display_name: name.trim() }).eq('id', id));

/** Your family group, or null. The database only ever returns groups you are in. */
export const getMyGroup = async () => unwrap<Group | null>(await db().from('groups').select('*').maybeSingle());

/** Everyone you can see: yourself and your family group, by name. */
export const listProfiles = async () =>
  unwrap<Profile[]>(await db().from('profiles').select('*').order('display_name'));

export const createGroup = async (name: string) => unwrap<Group>(await db().rpc('create_group', { p_name: name }));
export const joinGroup = async (code: string) => unwrap<Group>(await db().rpc('join_group', { p_code: code }));
export const leaveGroup = async () => ok(await db().rpc('leave_group'));

// ----------------------------------------------------------------- catalog
export const getAlbum = async (id: string) =>
  unwrap<Album | null>(await db().from('albums').select('*').eq('id', id).maybeSingle());

export const findAlbumByMbid = async (mbid: string) =>
  unwrap<Album | null>(await db().from('albums').select('*').eq('mbid', mbid).maybeSingle());

export const getTracks = async (albumId: string) =>
  unwrap<Track[]>(await db().from('tracks').select('*').eq('album_id', albumId).order('disc').order('position'));

export const getTrack = async (id: string) =>
  unwrap<Track | null>(await db().from('tracks').select('*').eq('id', id).maybeSingle());

export interface NewAlbum {
  mbid: string | null; title: string; artist: string; year: number | null; cover_url: string | null;
  album_key: string; genres: string[];
}
export interface NewTrack { disc: number; position: number; title: string; length_ms: number | null; recording_mbid: string | null }

/** Adds the album to the shared catalog, or returns the one already there. */
export const upsertAlbum = async (album: NewAlbum, tracks: NewTrack[]) =>
  unwrap<string>(await db().rpc('upsert_album', { p_album: album, p_tracks: tracks }));

// -------------------------------------------------------------- collection
/** Records in a collection. Pass an owner for one person, nothing for the whole family. */
export async function listCollection(ownerId?: string) {
  let query = db().from('collection_items').select('*');
  if (ownerId) query = query.eq('owner_id', ownerId);
  return unwrap<CollectionItem[]>(await query.order('artist').order('year').order('title'));
}

export const listCopiesOfAlbum = async (albumId: string) =>
  unwrap<CollectionItem[]>(await db().from('collection_items').select('*').eq('album_id', albumId).order('added_at'));

export const listOwnedAlbums = async (ownerId: string) =>
  unwrap<OwnedAlbum[]>(await db().from('owned_albums').select('*').eq('owner_id', ownerId));

export const addCopy = async (albumId: string, pressingNote: string | null) =>
  ok(await db().from('copies').insert({ album_id: albumId, pressing_note: pressingNote?.trim() || null }));

/** Soft delete: the record leaves the collection but ratings and listens stay. */
export const removeCopy = async (copyId: string) =>
  ok(await db().from('copies').update({ removed_at: new Date().toISOString() }).eq('id', copyId));

// ----------------------------------------------------------------- ratings
export const listMarks = async (albumId: string, userId: string) =>
  unwrap<AlbumMark[]>(await db().from('album_marks').select('*').eq('album_id', albumId).eq('user_id', userId));

/** Saves one person's rating or interlude flag for a track. */
export const saveMark = async (userId: string, trackId: string, rating: number | null, isInterlude: boolean) =>
  ok(
    await db()
      .from('track_marks')
      .upsert(
        { user_id: userId, track_id: trackId, rating: isInterlude ? null : rating, is_interlude: isInterlude, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,track_id' },
      ),
  );

export const clearMark = async (userId: string, trackId: string) =>
  ok(await db().from('track_marks').delete().eq('user_id', userId).eq('track_id', trackId));

export const listScores = async (userId: string) =>
  unwrap<AlbumScore[]>(await db().from('album_scores').select('*').eq('user_id', userId));

/** Everyone's score for one album (only people you are allowed to see). */
export const listScoresForAlbum = async (albumId: string) =>
  unwrap<AlbumScore[]>(await db().from('album_scores').select('*').eq('album_id', albumId));

// --------------------------------------------------------------- borrowing
export const listLoans = async () =>
  unwrap<LoanDetail[]>(await db().from('loan_details').select('*').order('requested_at', { ascending: false }));

export const requestLoan = async (copyId: string) => ok(await db().rpc('request_loan', { p_copy: copyId }));
export const decideLoan = async (loanId: string, approve: boolean) =>
  ok(await db().rpc('decide_loan', { p_loan: loanId, p_approve: approve }));
export const returnLoan = async (loanId: string) => ok(await db().rpc('return_loan', { p_loan: loanId }));
export const cancelLoanRequest = async (loanId: string) => ok(await db().rpc('cancel_loan_request', { p_loan: loanId }));
export const refreshLoanReminders = async () => ok(await db().rpc('refresh_loan_reminders'));

/** Records a person has on hand right now: owned and not lent out, plus borrowed. */
export const listShelf = async (holderId: string) =>
  unwrap<ShelfItem[]>(await db().from('shelf_items').select('*').eq('holder_id', holderId));

// ----------------------------------------------------------- notifications
export const listNotifications = async (userId: string) =>
  unwrap<Notification[]>(
    await db().from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(60),
  );

export const markNotificationRead = async (id: string) =>
  ok(await db().from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id));

export const markAllNotificationsRead = async (userId: string) =>
  ok(await db().from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).is('read_at', null));

// ---------------------------------------------------------------- wishlist
export async function listWishlist(userId?: string) {
  let query = db().from('wishlist_view').select('*');
  if (userId) query = query.eq('user_id', userId);
  return unwrap<WishlistRow[]>(await query.order('added_at', { ascending: false }));
}

export const addToWishlist = async (albumId: string) => ok(await db().from('wishlist_items').insert({ album_id: albumId }));
export const removeFromWishlist = async (itemId: string) => ok(await db().from('wishlist_items').delete().eq('id', itemId));
export const claimWishlistItem = async (itemId: string) => ok(await db().rpc('claim_wishlist_item', { p_item: itemId }));
export const cancelClaim = async (claimId: string) => ok(await db().from('wishlist_claims').delete().eq('id', claimId));

// --------------------------------------------------------------- listening
export const listListens = async (userId: string) =>
  unwrap<ListenRow[]>(await db().from('listen_log').select('*').eq('user_id', userId).order('listened_at', { ascending: false }));

/** Starts a now-playing session and counts one listen for the album. */
export const startListening = async (albumId: string) => ok(await db().rpc('start_listening', { p_album: albumId }));

export const stopListening = async (listenId: string) =>
  ok(await db().from('listens').update({ ended_at: new Date().toISOString() }).eq('id', listenId));

/** Logs a listen after the fact, on the given day. */
export const logListen = async (albumId: string, when: Date) =>
  ok(await db().from('listens').insert({ album_id: albumId, listened_at: when.toISOString(), source: 'manual' }));

export const deleteListen = async (listenId: string) => ok(await db().from('listens').delete().eq('id', listenId));
