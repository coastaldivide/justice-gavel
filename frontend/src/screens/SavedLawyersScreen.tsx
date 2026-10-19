import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../components/ToastProvider';
import { SkeletonLoader } from '../components/SkeletonLoader';
import type {} from '../types/navigation';
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
import React, { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Linking, RefreshControl, Platform, KeyboardAvoidingView, LayoutAnimation } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { unwrapList, api, apiErrorMessage } from '../services/api';
import { t, useLang, locale }   from '../i18n';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';

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

// Module-level link helpers: no hooks; failures reported via onError.
function callPhone(phone: string, onError?: () => void) {
  Linking.openURL('tel:' + phone.replace(/\D/g, '')).catch(() => onError?.());
}
function sendSMS(phone: string, onError?: () => void) {
  Linking.openURL('sms:' + phone.replace(/\D/g, '')).catch(() => onError?.());
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
  useLang();
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const styles = makeStyles();
  const [note,        setNote]        = useState(lawyer.notes || '');
  const [editingNote, setEditingNote] = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [reviewing,    setReviewing]    = useState(false);
  const [rating,       setRating]       = useState(0);
  const [reviewText,   setReviewText]   = useState('');
  const [submitting,   setSubmitting]   = useState(false);

  const saveNote = useCallback(async () => {
    setSaving(true);
    try {
      await api.patch(`/saved/lawyers/${lawyer.id}`, { notes: note.trim() });
      onNoteChange(lawyer.id, note.trim());
      setEditingNote(false);
    } catch {
      showToast(t('home_sos_failed'));
    } finally {
      setSaving(false);
    }
  }, [lawyer.id, note, onNoteChange, showToast]);

  const submitReview = async () => {
    if (rating === 0) { showToast(t('x_saved_lawyers_tap_star_rate_before')); return; }
    setSubmitting(true);
    try {
      await api.post('/reviews', {
        entity_type: 'lawyer',
        entity_id:   lawyer.provider_id || lawyer.id,
        rating,
        comment:     reviewText.trim(),
        anonymous:   0 });
      showToast(t('x_saved_lawyers_thank_review_helps_others'));
      setReviewing(false);
      setRating(0);
      setReviewText('');
    } catch (e: any) {
      showToast(apiErrorMessage(e, t('x_attorney_dashboard_try_again')), 'info');
    } finally { setSubmitting(false); }
  };

  const confirmRemove = () => {
    confirm(t('x_check_in_manager_remove', { name: lawyer.name }), t('x_saved_lawyers_they_will_be_removed'), { confirmLabel: t('saved_remove'), destructive: true })
      .then(ok => { if (ok) onRemove(lawyer.id); });
  };

  const savedDate = lawyer.saved_at
    ? new Date(lawyer.saved_at).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <View style={[styles.card, { backgroundColor: COLORS.bgCard, borderColor: COLORS.border }]}
      testID="saved-lawyers-screen">
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
            <Text maxFontSizeMultiplier={1.4} style={[styles.cardRating, { color: COLORS.goldText }]}>
              ★ {lawyer.rating.toFixed(1)}
            </Text>
          )}
          {(lawyer as import('../types/api').Lawyer).gavel_level === 1 && <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.bail, marginTop: 3 }}>{t('x_match_bronze_gavel')}</Text>}
          {(lawyer as import('../types/api').Lawyer).gavel_level === 2 && <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.textSecond, marginTop: 3 }}>{t('x_match_silver_gavel')}</Text>}
          {((lawyer as import('../types/api').Lawyer).gavel_level ?? 0) >= 3 && <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.goldText, marginTop: 3 }}>{t('x_nav_golden_gavel')}</Text>}
        </View>
        <TouchableOpacity accessibilityRole="button"
          style={styles.removeBtn}
          onPress={confirmRemove}
          accessibilityLabel={t('x_saved_lawyers_remove_from_saved', { name: lawyer.name })}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.removeBtnText}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Specialties */}
      {lawyer.specialties?.length > 0 && (
        <View style={styles.tagRow}>
          {lawyer.specialties.slice(0, 4).map((s, i) => (
            <View key={`row-${i}`} style={[styles.tag, { backgroundColor: COLORS.navy + '12', borderColor: COLORS.navy + '30' }]}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.tagText, { color: COLORS.navy }]}>{s}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Action buttons */}
      <View style={styles.actionRow}>
        {lawyer.phone && (
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.actionBtn, { backgroundColor: COLORS.legal }]}
            accessibilityLabel={t('saved_call')} onPress={() => callPhone(String(lawyer.phone), () => showToast(t('x_bail_search_calling_unavailable_this_device'), 'error'))}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.actionBtnText}>📞 {t('saved_call')}</Text>
          </TouchableOpacity>
        )}
        {lawyer.phone && (
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.actionBtn, { backgroundColor: COLORS.blue }]}
            accessibilityLabel={t('x_match_text')} onPress={() => sendSMS(String(lawyer.phone), () => showToast(t('x_saved_lawyers_texting_unavailable_this_device'), 'error'))}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.actionBtnText}>{t('x_match_text')}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.actionBtn, { backgroundColor: COLORS.navy }]}
          onPress={() => navigation.navigate('MoreTab', {
            screen: 'Booking',
            params: { lawyerName: lawyer.name, lawyerPhone: lawyer.phone || '', lawyerId: lawyer.provider_id } })}
          >
          <Text maxFontSizeMultiplier={1.4} style={styles.actionBtnText}>{t('x_saved_lawyers_book')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.actionBtn, { backgroundColor: COLORS.warnDark }]}
          accessibilityLabel={t('x_lawyer_profile_write_review')} onPress={() => setReviewing(r => !r)}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.actionBtnText}>{t('x_saved_lawyers_review')}</Text>
        </TouchableOpacity>
      </View>

      {reviewing && (
        <View style={[styles.reviewBox, { backgroundColor: COLORS.bgCard, borderColor: COLORS.border }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.reviewTitle, { color: COLORS.textPrimary }]}>{t('x_saved_lawyers_leave_review')}</Text>
          <View style={styles.starRow}>
            {[1,2,3,4,5].map(s => (
              <TouchableOpacity
          accessibilityRole="button" key={s} onPress={() => setRating(s)}
                accessibilityLabel={t(s === 1 ? 'x_saved_lawyers_star_one' : 'x_saved_lawyers_star_other', { s })}
              >
                <Text maxFontSizeMultiplier={1.4} style={[styles.star, { color: s <= rating ? COLORS.gold : COLORS.border }]}>★</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={[styles.reviewInput, { backgroundColor: COLORS.bg, borderColor: COLORS.border, color: COLORS.textPrimary }]}
            placeholder={t('x_saved_lawyers_optional_describe_experience')}
            placeholderTextColor={COLORS.textMuted}
            value={reviewText}
            onChangeText={setReviewText}
            multiline
              maxLength={2000}
            numberOfLines={3}

          returnKeyType="next"
          blurOnSubmit
        />
          <TouchableOpacity accessibilityRole="button" activeOpacity={0.6}
            style={[styles.reviewSubmit, { backgroundColor: COLORS.warnDark, opacity: submitting ? 0.6 : 1 }]}
            onPress={submitReview}
            disabled={submitting}
            accessibilityLabel={t('x_saved_lawyers_submit_review')}
          accessibilityHint={t('cp_double_tap')}
          >
            {submitting
              ? <ActivityIndicator color={COLORS.bgCard} size="small" />
              : <Text maxFontSizeMultiplier={1.4} style={styles.reviewSubmitText}>{t('x_saved_lawyers_submit_review_2')}</Text>
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
              <TouchableOpacity
                accessibilityRole="button" activeOpacity={0.6}
                style={[styles.notesBtn, { backgroundColor: COLORS.navy }]}
                onPress={saveNote}
                disabled={saving}
               accessibilityLabel={saving ? t('x_attorney_dashboard_saving') : t('x_saved_lawyers_save_note')}>
                <Text maxFontSizeMultiplier={1.4} style={styles.notesBtnText}>{saving ? t('x_attorney_dashboard_saving') : t('x_saved_lawyers_save_note')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                style={[styles.notesBtn, { backgroundColor: COLORS.border }]}
                accessibilityLabel={t('case_cancel')} onPress={() => { setNote(lawyer.notes || ''); setEditingNote(false); }}
              >
                <Text maxFontSizeMultiplier={1.4} style={[styles.notesBtnText, { color: COLORS.textSecond }]}>{t('case_cancel')}</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        ) : (
          <TouchableOpacity
          accessibilityRole="button" onPress={() => setEditingNote(true)} activeOpacity={0.75}
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
function SavedLawyersScreen({ navigation }: any): React.JSX.Element {
  useLang();
  const { confirm } = useConfirm();
  const { showToast } = useToast();

  // Mounted guard -- prevents setState after unmount (crash in strict mode)
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); return () => { mountedRef.current = false; }; }, []);

  const { colors } = useTheme();
  const [lawyers,   setLawyers]   = useState<SavedLawyer[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);
  const [error,     setError]     = useState('');

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const res = await api.get('/saved/lawyers');
      setLawyers(unwrapList(res.data, 'lawyers'));
    } catch (e: any) {
      setError(apiErrorMessage(e, t('x_saved_lawyers_could_not_load_saved')));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Load on focus: picks up lawyers saved from other screens when returning here.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRemove = useCallback((id: number) => {
confirm(t('x_saved_lawyers_remove_attorney'), t('x_saved_lawyers_remove_this_attorney_from'),
      { confirmLabel: t('saved_remove'), destructive: true }).then(async ok => { if (!ok) return;
      try {
              await api.delete(`/saved/lawyers/${id}`);
              setLawyers(prev => prev.filter(l => l.id !== id));
            } catch {
              showToast(t('home_sos_failed'));
            }
    })
  }, [confirm, showToast]);

  const handleNoteChange = useCallback((id: number, note: string) => {
    setLawyers(prev => prev.map(l => l.id === id ? { ...l, notes: note } : l));
  }, []);

  if (loading) return <SkeletonLoader count={5} label={t('saved_title')} />;

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      {error ? (
        <View style={styles.center}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.errorText, { color: colors.emergency }]}>{error}</Text>
          <TouchableOpacity
          accessibilityRole="button" style={styles.retryBtn} accessibilityLabel={t('help_now_error_retry')} onPress={() => load()}
            >
            <Text maxFontSizeMultiplier={1.4} style={styles.retryBtnText}>{t('help_now_error_retry')}</Text>
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
            accessibilityRole="button"
            style={[styles.findBtn, { backgroundColor: COLORS.navy }]}
            accessibilityLabel={t('saved_find_lawyers')} onPress={() => navigation.navigate('LawyersTab')}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.findBtnText}>{t('saved_find_lawyers')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlashList testID="saved-lawyers-list"
          keyboardShouldPersistTaps="handled"
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
            <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 }}>
              {t('x_saved_lawyers_no_saved_attorneys_browse')}
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
              {t(lawyers.length === 1 ? 'x_saved_lawyers_saved_one' : 'x_saved_lawyers_saved_other', { length: lawyers.length })}
            </Text>
          }
        />
      )}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
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
const styles = makeStyles();
export default React.memo(SavedLawyersScreen);