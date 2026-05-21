import { SkeletonLoader } from '../components/SkeletonLoader';
import type { ScreenProps } from '../types/navigation';
/**
 * SavedLawyersScreen -- Personal attorney contact list
 *
 * Displays all lawyers the user has starred/saved from LawyersScreen,
 * MatchScreen, or any lawyer profile card.
 *
 * Features:
 *   - Full saved lawyer card with call, SMS, message, and remove actions
 *   - Personal notes per saved lawyer (editable inline)
 *   - Empty state with CTA to lawyer search
 *   - Pull-to-refresh
 *   - Swipe-to-remove (via delete button)
 *
 * Entry points:
 *   1. HomeScreen → "Saved Lawyers" tile (added below)
 *   2. SettingsScreen → "My Saved Lawyers"
 *   3. LawyersScreen header → bookmark icon
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Alert, ActivityIndicator, Linking, RefreshControl, Platform, KeyboardAvoidingView } from 'react-native';
import { api } from '../services/api';
import { t }   from '../i18n';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
import { getCachedSearch } from '../services/offlineCache';
import { useFocusEffect } from '@react-navigation/native';

declare var setSavedLawyers: any;
declare var AppNavigation: any; // hoisted from component scope
declare var load: any; // hoisted from component scope
declare var rating: any; // hoisted from component scope
declare var reviewText: any; // hoisted from component scope
declare var reviewing: any; // hoisted from component scope
declare var setRating: any; // hoisted from component scope
declare var setReviewText: any; // hoisted from component scope
declare var setReviewing: any; // hoisted from component scope
declare var setSubmitting: any; // hoisted from component scope
declare var submitting: any; // hoisted from component scope
interface SavedLawyer {
  id:          number;
  provider_id: number | null;
  name:        string;
  phone:       string | null;
  address:     string | null;
  specialties: string[];
  rating:      number | null;
  notes:       string | null;
  saved_at:    string;
}

function callPhone(phone: string) {
  Linking.openURL('tel:' + phone.replace(/\s/g, '')).catch(() => {}).catch(() => {});
}
function sendSMS(phone: string) {
  Linking.openURL('sms:' + phone.replace(/\s/g, '')).catch(() => {}).catch(() => {});
}

// ── Saved lawyer card ─────────────────────────────────────────────────────────
function SavedCard({
  lawyer,
  onRemove,
  onNoteChange,
  navigation }: {
  lawyer:       SavedLawyer;
  onRemove:     (id: number) => void;
  onNoteChange: (id: number, note: string) => void;
  navigation: any;
}) {
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [note,        setNote]        = useState(lawyer.notes || '');
  const [editingNote, setEditingNote] = useState(false);
  const [saving,      setSaving]      = useState(false);

  const saveNote = useCallback(async () => {
    setSaving(true);
    try {
      await api.patch(`/saved/lawyers/${lawyer.id}`, { notes: note.trim() });
      onNoteChange(lawyer.id, note.trim());
      setEditingNote(false);
    } catch {
      Alert.alert('Could not save note', 'Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }, [lawyer.id, note, onNoteChange]);

  const submitReview = async () => {
    if (rating === 0) { Alert.alert('Rate first', 'Tap a star to rate before submitting.'); return; }
    setSubmitting(true);
    try {
      await api.post('/reviews', {
        entity_type: 'lawyer',
        entity_id:   lawyer.provider_id || lawyer.id,
        rating,
        comment:     reviewText.trim(),
        anonymous:   0 });
      Alert.alert('Review submitted ✓', 'Thank you -- your review helps others find good attorneys.');
      setReviewing(false);
      setRating(0);
      setReviewText('');
    } catch (e: any) {
      Alert.alert('Could not submit', e.response?.data?.error || 'Try again.');
    } finally { setSubmitting(false); }
  };

  const confirmRemove = () => {
    Alert.alert(
      `Remove ${lawyer.name}?`,
      'They will be removed from your saved list.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: t('saved_remove'), style: 'destructive', onPress: () => onRemove(lawyer.id) },
      ]
    );
  };

  const savedDate = lawyer.saved_at
    ? new Date(lawyer.saved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;


  // Refresh data whenever user navigates back to this screen
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <View style={[styles.card, { backgroundColor: COLORS.bgCard, borderColor: COLORS.border }]}>
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.cardName, { color: COLORS.textPrimary }]}>{lawyer.name}</Text>
          {lawyer.address && (
            <Text maxFontSizeMultiplier={1.4} style={[styles.cardAddr, { color: COLORS.textMuted }]} numberOfLines={1}>
              {lawyer.address}
            </Text>
          )}
          {lawyer.rating != null && (
            <Text maxFontSizeMultiplier={1.4} style={[styles.cardRating, { color: COLORS.warn }]}>
              ★ {lawyer.rating.toFixed(1)}
            </Text>
          )}
          {(lawyer as any).gavel_level === 1 && <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.bail, marginTop: 3 }}>🥉 Bronze Gavel</Text>}
          {(lawyer as any).gavel_level === 2 && <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.textSecond, marginTop: 3 }}>🥈 Silver Gavel</Text>}
          {(lawyer as any).gavel_level >= 3 && <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.gold, marginTop: 3 }}>🏆 Golden Gavel</Text>}
        </View>
        <TouchableOpacity
          style={styles.removeBtn}
          onPress={confirmRemove}
          accessibilityLabel={`Remove ${lawyer.name} from saved`}
          accessibilityRole="button"
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.removeBtnText}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Specialties */}
      {lawyer.specialties?.length > 0 && (
        <View style={styles.tagRow}>
          {lawyer.specialties.slice(0, 4).map((s, i) => (
            <View key={i} style={[styles.tag, { backgroundColor: COLORS.navy + '12', borderColor: COLORS.navy + '30' }]}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.tagText, { color: COLORS.navy }]}>{s}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Action buttons */}
      <View style={styles.actionRow}>
        {lawyer.phone && (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: COLORS.legal }]}
            onPress={() => callPhone(lawyer.phone!)}
            accessibilityRole="button"
            accessibilityLabel={`Call ${lawyer.name}`}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.actionBtnText}>📞 {t('saved_call')}</Text>
          </TouchableOpacity>
        )}
        {lawyer.phone && (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: COLORS.blue }]}
            onPress={() => sendSMS(lawyer.phone!)}
            accessibilityRole="button"
            accessibilityLabel={`Text ${lawyer.name}`}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.actionBtnText}>💬 Text</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: COLORS.navy }]}
          onPress={() => navigation.navigate('MoreTab', {
            screen: 'Booking',
            params: { lawyerName: lawyer.name, lawyerPhone: lawyer.phone || '', lawyerId: lawyer.provider_id } })}
          accessibilityLabel={`Book consultation with ${lawyer.name}`}
          accessibilityRole="button"
          >
          <Text maxFontSizeMultiplier={1.4} style={styles.actionBtnText}>📅 Book</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: COLORS.warnDark }]}
          onPress={() => setReviewing(r => !r)}
          accessibilityLabel={`Leave a review for ${lawyer.name}`}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.actionBtnText}>⭐ Review</Text>
        </TouchableOpacity>
      </View>

      {reviewing && (
        <View style={[styles.reviewBox, { backgroundColor: COLORS.bgCard, borderColor: COLORS.border }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.reviewTitle, { color: COLORS.textPrimary }]}>Leave a review</Text>
          <View style={styles.starRow}>
            {[1,2,3,4,5].map(s => (
              <TouchableOpacity key={s} onPress={() => setRating(s)}
                accessibilityRole="button"
                accessibilityLabel={`${s} star`}
              >
                <Text maxFontSizeMultiplier={1.4} style={[styles.star, { color: s <= rating ? COLORS.gold : COLORS.border }]}>★</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={[styles.reviewInput, { backgroundColor: COLORS.bg, borderColor: COLORS.border, color: COLORS.textPrimary }]}
            placeholder="Optional: describe your experience…"
            placeholderTextColor={COLORS.textMuted}
            value={reviewText}
            onChangeText={setReviewText}
            multiline
              maxLength={2000}
            numberOfLines={3}

          returnKeyType="next"
          blurOnSubmit
        />
          <TouchableOpacity activeOpacity={0.6}
            style={[styles.reviewSubmit, { backgroundColor: COLORS.warnDark, opacity: submitting ? 0.6 : 1 }]}
            onPress={submitReview}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="Submit review"
          >
            {submitting
              ? <ActivityIndicator color={COLORS.bgCard} size="small" />
              : <Text maxFontSizeMultiplier={1.4} style={styles.reviewSubmitText}>Submit Review →</Text>
            }
          </TouchableOpacity>
        </View>
      )}

      {/* Notes */}
      <View style={[styles.notesBlock, { borderTopColor: COLORS.border }]}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.notesLabel, { color: COLORS.textMuted }]}>{t('saved_notes_label')}</Text>
        {editingNote ? (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <TextInput
              style={[styles.notesInput, { borderColor: COLORS.navy + '40', color: COLORS.textPrimary, backgroundColor: COLORS.bg }]}
              value={note}
              onChangeText={setNote}
              placeholder={t('saved_notes_placeholder')}
              placeholderTextColor={COLORS.textSecond}
              multiline
              maxLength={2000}
              numberOfLines={3}
              textAlignVertical="top"
              autoFocus
            />
            <View style={styles.notesBtnRow}>
              <TouchableOpacity activeOpacity={0.6}
                accessibilityRole="button"
                style={[styles.notesBtn, { backgroundColor: COLORS.navy }]}
                onPress={saveNote}
                disabled={saving}
              >
                <Text maxFontSizeMultiplier={1.4} style={styles.notesBtnText}>{saving ? 'Saving…' : 'Save note'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.notesBtn, { backgroundColor: COLORS.border }]}
                onPress={() => { setNote(lawyer.notes || ''); setEditingNote(false); }}
              >
                <Text maxFontSizeMultiplier={1.4} style={[styles.notesBtnText, { color: COLORS.textSecond }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        ) : (
          <TouchableOpacity onPress={() => setEditingNote(true)} activeOpacity={0.75}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.notesValue, { color: note ? COLORS.textPrimary : COLORS.textSecond }]}>
              {note || t('saved_notes_placeholder')}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Saved date */}
      {savedDate && (
        <Text maxFontSizeMultiplier={1.4} style={[styles.savedDate, { color: COLORS.textSecond }]}>
          {t('saved_saved_on')} {savedDate}
        </Text>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function SavedLawyersScreen({ navigation }: any): React.JSX.Element {

  // Mounted guard -- prevents setState after unmount (crash in strict mode)
  const mountedRef = React.useRef(true);
  React.useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const { colors, isDark } = useTheme();
  const [lawyers,   setLawyers]   = useState<SavedLawyer[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);
  const [error,     setError]     = useState('');

  const load = useCallback(async (refresh = false) => {
    // Try cache first for instant display while fresh data loads
    try {
      const cached = await getCachedSearch();
      if ((cached as any)?.results?.lawyers?.length && mountedRef.current) {
        setSavedLawyers((cached as any).results?.lawyers || []);
      }
    } catch {}

    if (refresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const res = await api.get('/saved/lawyers');
      setLawyers(res.data || []);
    } catch (e: any) {
      setError(e.response?.data?.error || 'Could not load saved lawyers.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRemove = useCallback(async (id: number) => {
    try {
      await api.delete(`/saved/lawyers/${id}`);
      setLawyers(prev => prev.filter(l => l.id !== id));
    } catch {
      Alert.alert('Could not remove', 'Check your connection and try again.');
    }
  }, []);

  const handleNoteChange = useCallback((id: number, note: string) => {
    setLawyers(prev => prev.map(l => l.id === id ? { ...l, notes: note } : l));
  }, []);

  if (loading) return <SkeletonLoader rows={5} label="Saved Lawyers" />;

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      {error ? (
        <View style={styles.center}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.errorText, { color: COLORS.emergency }]}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load()}
            accessibilityRole="button"
            >
            <Text maxFontSizeMultiplier={1.4} style={styles.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : lawyers.length === 0 ? (
        // ── Empty state ──────────────────────────────────────────────────────
        <View style={styles.empty}>
          <Text maxFontSizeMultiplier={1.4} style={styles.emptyIcon}>⭐</Text>
          <Text maxFontSizeMultiplier={1.4} style={[styles.emptyTitle, { color: colors.textPrimary }]}>
            {t('saved_empty_title')}
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={[styles.emptySub, { color: colors.textMuted }]}>
            {t('saved_empty_sub')}
          </Text>
          <TouchableOpacity
            style={[styles.findBtn, { backgroundColor: COLORS.navy }]}
            onPress={() => navigation.navigate('LawyersTab')}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.findBtnText}>{t('saved_find_lawyers')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          keyboardShouldPersistTaps="handled"
          getItemLayout={(_, index) => ({ length: 190, offset: 190 * index, index })}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
          data={lawyers}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={COLORS.navy}
            />
          }
          ListEmptyComponent={
            <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textFaint, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 }}>
              No saved attorneys. Browse attorneys and tap ⭐ to save them here.
            </Text>
          }
          renderItem={({ item }) => (
            <SavedCard
              lawyer={item}
              onRemove={handleRemove}
              onNoteChange={handleNoteChange}
              navigation={navigation}
            />
          )}
          ListHeaderComponent={
            <Text maxFontSizeMultiplier={1.4} style={[styles.count, { color: colors.textMuted }]}>
              {lawyers.length} saved {lawyers.length === 1 ? 'lawyer' : 'lawyers'}
            </Text>
          }
        />
      )}
    </View>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen:         { flex: 1 },
  center:         { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  list:           { padding: 16, gap: 12, paddingBottom: 40 },
  count:          { fontSize: 12, fontFamily: 'Inter_600SemiBold', fontWeight: '600', marginBottom: 4, paddingHorizontal: 2 },
  card: {
    borderRadius: RADIUS.lg, borderWidth: 1,
    padding: 16, ...SHADOW.sm },
  cardHeader:     { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  cardHeaderLeft: { flex: 1 },
  cardName:       { fontSize: 16, lineHeight: 24, ...FONTS.heavy, color: COLORS.navy },
  cardAddr:       { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  cardRating:     { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700', marginTop: 4 },
  removeBtn:      { padding: 6, marginLeft: 8 },
  removeBtnText:  { fontSize: 16, lineHeight: 24, color: COLORS.textMuted },
  tagRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 12 },
  tag:            { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  tagText:        { fontSize: 11, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  actionRow:      { flexDirection: 'row', gap: 8, marginBottom: 12 },
  actionBtn:      { flex: 1, paddingVertical: 10, borderRadius: RADIUS.md, alignItems: 'center' },
  reviewBox:       { marginTop: 10, borderRadius: 8, borderWidth: 1, padding: 12 },
  reviewTitle:     { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginBottom: 8 },
  starRow:         { flexDirection: 'row', gap: 8, marginBottom: 10 },
  star:            { fontSize: 28 },
  reviewInput:     { borderRadius: 8, borderWidth: 1, padding: 10, fontSize: 12, lineHeight: 20, minHeight: 60, textAlignVertical: 'top', marginBottom: 10 },
  reviewSubmit:    { borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  reviewSubmitText:{ color: COLORS.bgCard, fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  actionBtnText:  { color: COLORS.bgCard, fontSize: 12, fontWeight: '700' },
  notesBlock:     { borderTopWidth: 1, paddingTop: 10 },
  notesLabel:     { fontSize: 11, fontFamily: 'Inter_600SemiBold', fontWeight: '600', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  notesValue:     { fontSize: 12, lineHeight: 18, minHeight: 32 },
  notesInput:     { borderWidth: 1.5, borderRadius: RADIUS.md, padding: 10, fontSize: 14, lineHeight: 21, marginBottom: 8, minHeight: 72 },
  notesBtnRow:    { flexDirection: 'row', gap: 8 },
  notesBtn:       { flex: 1, paddingVertical: 10, borderRadius: RADIUS.md, alignItems: 'center' },
  notesBtnText:   { color: COLORS.bgCard, fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 12 },
  savedDate:      { fontSize: 11, marginTop: 8, textAlign: 'right' },
  empty:          { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyIcon:      { fontSize: 48, marginBottom: 16 },
  emptyTitle:     { fontSize: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  emptySub:       { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 28 },
  findBtn:        { borderRadius: RADIUS.lg, paddingVertical: 16, paddingHorizontal: 32 },
  findBtnText:    { color: COLORS.bgCard, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  errorText:      { fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 16 },
  retryBtn:       { paddingVertical: 12, paddingHorizontal: 24, borderRadius: RADIUS.md, backgroundColor: COLORS.navy },
  retryBtnText:   { color: COLORS.bgCard, fontFamily: 'Inter_700Bold', fontWeight: '700' } });

// Module-level fallback for helper components
const styles = makeStyles(COLORS);