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
 *   - Card with call / text / directions / website (live directory data), profile, remove
 *   - Personal notes per saved lawyer (editable inline)
 *   - Empty state with CTA to lawyer search; signed out → sign-in prompt
 *   - Pull-to-refresh; reloads on focus (saves made on other screens show up)
 *
 * Entry points:
 *   1. HomeScreen → "Saved Lawyers" tile (added below)
 *   2. SettingsScreen → "My Saved Lawyers"
 *   3. LawyersScreen header → bookmark icon
 */
import React, { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, RefreshControl, Platform, KeyboardAvoidingView } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { unwrapList, api, apiErrorMessage } from '../services/api';
import { t, useLang, locale }   from '../i18n';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { ContactActions } from '../components/ContactActions';
import * as secureStorage from '../utils/secureStorage';

interface SavedLawyer {
  id:          number;
  provider_id: number | null;
  name:        string;
  phone:       string | null;
  address:     string | null;
  website?:    string | null;
  lat?:        number | null;
  lng?:        number | null;
  specialties: string[];
  rating:      number | null;
  notes:       string | null;
  saved_at:    string;
  gavel_level?: number;
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
  const { showToast } = useToast();
  const { colors } = useTheme();
  const styles = makeStyles();
  const [note,        setNote]        = useState(lawyer.notes || '');
  const [editingNote, setEditingNote] = useState(false);
  const [saving,      setSaving]      = useState(false);

  const saveNote = useCallback(async () => {
    setSaving(true);
    try {
      await api.patch(`/saved/lawyers/${lawyer.id}`, { notes: note.trim() });
      onNoteChange(lawyer.id, note.trim());
      setEditingNote(false);
    } catch (e) {
      showToast(apiErrorMessage(e, t('x_lawyers_could_not_update_saved')), 'error');
    } finally {
      setSaving(false);
    }
  }, [lawyer.id, note, onNoteChange, showToast]);

  const savedDate = lawyer.saved_at
    ? new Date(lawyer.saved_at).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
      testID="saved-lawyers-screen">
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <TouchableOpacity accessibilityRole="link" disabled={!lawyer.provider_id} testID="saved-open-profile"
            onPress={() => navigation.navigate('MoreTab', { screen: 'LawyerProfile', params: { lawyerId: lawyer.provider_id } })}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.cardName, { color: colors.textBrand }]}>{lawyer.name}</Text>
          </TouchableOpacity>
          {lawyer.address && (
            <Text maxFontSizeMultiplier={1.4} style={[styles.cardAddr, { color: colors.textMuted }]} numberOfLines={1}>
              {lawyer.address}
            </Text>
          )}
          {lawyer.rating != null && (
            <Text maxFontSizeMultiplier={1.4} style={[styles.cardRating, { color: colors.goldText }]}>
              ★ {lawyer.rating.toFixed(1)}
            </Text>
          )}
          {lawyer.gavel_level === 1 && <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.bail, marginTop: 3 }}>{t('x_match_bronze_gavel')}</Text>}
          {lawyer.gavel_level === 2 && <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.textSecond, marginTop: 3 }}>{t('x_match_silver_gavel')}</Text>}
          {(lawyer.gavel_level ?? 0) >= 3 && <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.goldText, marginTop: 3 }}>{t('x_nav_golden_gavel')}</Text>}
        </View>
        <TouchableOpacity accessibilityRole="button"
          style={styles.removeBtn}
          onPress={() => onRemove(lawyer.id)}
          testID="saved-remove"
          accessibilityLabel={t('x_saved_lawyers_remove_from_saved', { name: lawyer.name })}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.removeBtnText, { color: colors.textMuted }]}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Specialties */}
      {lawyer.specialties?.length > 0 && (
        <View style={styles.tagRow}>
          {lawyer.specialties.slice(0, 4).map((s, i) => (
            <View key={`row-${i}`} style={[styles.tag, { backgroundColor: colors.navy + '12', borderColor: colors.navy + '30' }]}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.tagText, { color: colors.navy }]}>{s}</Text>
            </View>
          ))}
        </View>
      )}

      <ContactActions listing={lawyer} />
      {!!lawyer.provider_id && (
        <TouchableOpacity accessibilityRole="button" testID="saved-profile"
          style={[styles.profileBtn, { borderColor: colors.border }]}
          onPress={() => navigation.navigate('MoreTab', { screen: 'LawyerProfile', params: { lawyerId: lawyer.provider_id } })}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.profileBtnText, { color: colors.textBrand }]}>{t('lw_profile')}</Text>
        </TouchableOpacity>
      )}

      {/* Notes */}
      <View style={[styles.notesBlock, { borderTopColor: colors.border }]}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.notesLabel, { color: colors.textMuted }]}>{t('saved_notes_label')}</Text>
        {editingNote ? (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <TextInput
              style={[styles.notesInput, { borderColor: colors.navy + '40', color: colors.textPrimary, backgroundColor: colors.bg }]}
              value={note}
              onChangeText={setNote}
              placeholder={t('saved_notes_placeholder')}
              placeholderTextColor={colors.textSecond}
              multiline
              maxLength={2000}
              numberOfLines={3}
              textAlignVertical="top"
              autoFocus
            />
            <View style={styles.notesBtnRow}>
              <TouchableOpacity
                accessibilityRole="button" activeOpacity={0.6}
                style={[styles.notesBtn, { backgroundColor: colors.navy }]}
                onPress={saveNote}
                disabled={saving}
               accessibilityLabel={saving ? t('x_attorney_dashboard_saving') : t('x_saved_lawyers_save_note')}>
                <Text maxFontSizeMultiplier={1.4} style={styles.notesBtnText}>{saving ? t('x_attorney_dashboard_saving') : t('x_saved_lawyers_save_note')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                style={[styles.notesBtn, { backgroundColor: colors.border }]}
                accessibilityLabel={t('case_cancel')} onPress={() => { setNote(lawyer.notes || ''); setEditingNote(false); }}
              >
                <Text maxFontSizeMultiplier={1.4} style={[styles.notesBtnText, { color: colors.textSecond }]}>{t('case_cancel')}</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        ) : (
          <TouchableOpacity
          accessibilityRole="button" onPress={() => setEditingNote(true)} activeOpacity={0.75}
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.notesValue, { color: note ? colors.textPrimary : colors.textSecond }]}>
              {note || t('saved_notes_placeholder')}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Saved date */}
      {savedDate && (
        <Text maxFontSizeMultiplier={1.4} style={[styles.savedDate, { color: colors.textSecond }]}>
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
  React.useEffect(() => () => { mountedRef.current = false; }, []);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  const { colors } = useTheme();
  const [lawyers,   setLawyers]   = useState<SavedLawyer[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);
  const [error,     setError]     = useState('');

  const load = useCallback(async (refresh = false) => {
    const token = await secureStorage.getToken().catch(() => null);
    setSignedIn(!!token);
    if (!token) { setLoading(false); setRefreshing(false); return; }
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
              await api.delete(`/saved/lawyers/${id}`).catch((e) => { if (e?.response?.status !== 404) throw e; });
              setLawyers(prev => prev.filter(l => l.id !== id));
            } catch (e) {
              showToast(apiErrorMessage(e, t('x_lawyers_could_not_update_saved')), 'error');
            }
    })
  }, [confirm, showToast]);

  const handleNoteChange = useCallback((id: number, note: string) => {
    setLawyers(prev => prev.map(l => l.id === id ? { ...l, notes: note } : l));
  }, []);

  if (loading) return <SkeletonLoader count={5} label={t('saved_title')} />;
  if (signedIn === false) return (
    <View style={[styles.empty, { backgroundColor: colors.bg }]} testID="saved-signed-out">
      <Text maxFontSizeMultiplier={1.4} style={styles.emptyIcon}>⭐</Text>
      <Text maxFontSizeMultiplier={1.4} style={[styles.emptyTitle, { color: colors.textPrimary }]}>{t('saved_sign_in_title')}</Text>
      <Text maxFontSizeMultiplier={1.4} style={[styles.emptySub, { color: colors.textMuted }]}>{t('saved_sign_in_sub')}</Text>
      <TouchableOpacity accessibilityRole="button" style={[styles.findBtn, { backgroundColor: COLORS.navy }]}
        onPress={() => navigation.navigate('MoreTab', { screen: 'Login' })}>
        <Text maxFontSizeMultiplier={1.4} style={styles.findBtnText}>{t('saved_sign_in_button')}</Text>
      </TouchableOpacity>
    </View>
  );

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
  removeBtn:      { padding: 6, marginLeft: 8, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  removeBtnText:  { fontSize: 16, lineHeight: 24 },
  tagRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 12 },
  tag:            { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  tagText:        { fontSize: 11, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  profileBtn:     { borderWidth: 1, borderRadius: RADIUS.md, paddingVertical: 10, alignItems: 'center', marginTop: 8, marginBottom: 12, minHeight: 44, justifyContent: 'center' },
  profileBtnText: { fontSize: 13, fontFamily: 'Inter_700Bold', fontWeight: '700' },
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