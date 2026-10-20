/**
 * ConflictCheckScreen — check names against the attorney's firm before taking a client.
 *
 *   POST /conflicts/check { parties: [{ name }] }  the firm's conflict index, the parties on its
 *        matters and its matters' clients / opposing parties. Names are compared after
 *        normalizing (case, accents, punctuation, word order, Inc./LLC): equal → exact match,
 *        one name inside the other ("Smith" / "John Smith") → possible match.
 *   POST /conflicts/index { parties: [{ name, role }] }  add people to the firm's index.
 * Only the caller's own firm is searched. Without a firm the screen offers to start one.
 */
import React, { useCallback, useEffect, useState } from 'react';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api, apiErrorMessage } from '../services/api';
import { SignInNeeded, useHasSession } from '../components/SignInNeeded';
import { COLORS, FONTS, RADIUS, useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';

type Match = { matched_name: string; role: string | null; match: 'exact' | 'partial'; matter_title: string | null; matter_status: string | null; source: string };
type Result = { clear: boolean; conflicts: { name: string; matches: Match[] }[]; checked_count: number; index_size: number };
const ROLES = ['client', 'adverse', 'former_client', 'witness', 'expert'] as const;
const roleLabel = (r: string | null) => (r && (ROLES as readonly string[]).includes(r) ? t(`cc_role_${r}`) : r || '');
const splitNames = (txt: string) => [...new Set(txt.split('\n').map(n => n.trim()).filter(Boolean))];

function ConflictCheckScreen({ navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { hasSession, recheck } = useHasSession();
  const [firm, setFirm] = useState<{ name: string } | null | undefined>(undefined);
  const [names, setNames] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [addNames, setAddNames] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]>('client');
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState<{ text: string; tone: 'ok' | 'warn' | 'error' } | null>(null);

  const loadFirm = useCallback(() => {
    api.get('/firm-acquisition/status').then(r => setFirm(r.data?.has_firm ? { name: r.data.firm?.name } : null)).catch(() => setFirm(null));
  }, []);
  useEffect(() => { if (hasSession) loadFirm(); }, [hasSession, loadFirm]);

  const check = async () => {
    const list = splitNames(names);
    if (!list.length) { setError(t('x_conflict_check_enter_at_least_one')); return; }
    setChecking(true); setError(''); setResult(null);
    try { setResult((await api.post<Result>('/conflicts/check', { parties: list.map(name => ({ name })) })).data); }
    catch (e) { setError(apiErrorMessage(e, t('x_conflict_check_conflict_check_failed'))); }
    finally { setChecking(false); }
  };
  const add = async () => {
    const list = splitNames(addNames);
    if (!list.length) { setAddMsg({ text: t('x_conflict_check_enter_at_least_one'), tone: 'error' }); return; }
    setAdding(true); setAddMsg(null);
    try {
      const r = await api.post('/conflicts/index', { parties: list.map(name => ({ name, role })) });
      const n = Number(r.data?.added_count || 0);
      const c = Number(r.data?.conflict_count || 0);
      setAddMsg(c ? { text: t('cc_added_conflicts', { n, c }), tone: 'warn' } : { text: t(n === 1 ? 'cc_added_one' : 'cc_added_other', { n }), tone: 'ok' });
      setAddNames('');
    } catch (e) { setAddMsg({ text: apiErrorMessage(e, t('x_conflict_check_conflict_check_failed')), tone: 'error' }); }
    finally { setAdding(false); }
  };

  if (hasSession === false) return <View style={{ flex: 1, backgroundColor: colors.bg }}><SignInNeeded navigation={navigation} title={t('x_conflict_check_conflict_interest_check')} body={t('cc_signin_body')} onSignedIn={recheck} /></View>;
  if (hasSession === null || firm === undefined) return <View style={[s.center, { backgroundColor: colors.bg }]}><ActivityIndicator size="large" color={colors.navy} /></View>;

  return (
    <ScrollView testID="conflict-check-screen" style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Text maxFontSizeMultiplier={1.3} style={s.h1} accessibilityRole="header">{t('x_conflict_check_conflict_interest_check')}</Text>
      {!firm ? (
        <View style={s.card} testID="cc-no-firm">
          <Text maxFontSizeMultiplier={1.4} style={s.line}>{t('cc_no_firm')}</Text>
          <TouchableOpacity accessibilityRole="button" style={s.primaryBtn} onPress={() => navigation.navigate('FirmAcquisition' as never)}>
            <Text maxFontSizeMultiplier={1.4} style={s.primaryText}>{t('cc_start_firm')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <Text maxFontSizeMultiplier={1.4} style={s.line}>{t('cc_intro', { firm: firm.name })}</Text>
          <TextInput testID="cc-names" style={s.area} value={names} onChangeText={setNames} multiline maxLength={4000}
            placeholder={t('x_conflict_check_john_smith_acme_corporation')} placeholderTextColor={colors.placeholder} accessibilityLabel={t('x_conflict_check_enter_party_names_one')} />
          <TouchableOpacity accessibilityRole="button" testID="cc-run" style={[s.primaryBtn, checking && { opacity: 0.6 }]} disabled={checking} onPress={check}>
            {checking ? <ActivityIndicator color={colors.textOnNavy} /> : <Text maxFontSizeMultiplier={1.4} style={s.primaryText}>{t('x_conflict_check_run_conflict_check_2')}</Text>}
          </TouchableOpacity>
          {!!error && <Text maxFontSizeMultiplier={1.4} style={s.error} testID="cc-error">{error}</Text>}
          {result && (
            <View testID="cc-result" style={[s.banner, { backgroundColor: result.clear ? colors.legalBg : colors.emergencyBg, borderColor: result.clear ? colors.legal : colors.emergency }]}>
              <Text maxFontSizeMultiplier={1.4} style={[s.bannerTitle, { color: result.clear ? colors.legalDark : colors.emergencyDark }]}>
                {result.clear ? t('x_conflict_check_no_conflicts_found') : t(result.conflicts.length === 1 ? 'cc_found_one' : 'cc_found_other', { n: result.conflicts.length })}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={s.line}>{t('cc_checked', { n: result.checked_count, m: result.index_size })}</Text>
              {result.index_size === 0 && <Text maxFontSizeMultiplier={1.4} style={s.line}>{t('cc_index_empty')}</Text>}
            </View>
          )}
          {result?.conflicts.map(c => (
            <View key={c.name} style={s.card} testID="cc-conflict">
              <Text maxFontSizeMultiplier={1.4} style={s.title}>{c.name}</Text>
              {c.matches.map((m, i) => (
                <View key={`${m.matched_name}-${i}`} style={s.matchRow}>
                  <Text maxFontSizeMultiplier={1.3} style={[s.badge, { backgroundColor: m.match === 'exact' ? colors.emergencyDark : colors.warnDark }]}>{t(m.match === 'exact' ? 'cc_exact' : 'cc_possible')}</Text>
                  <View style={{ flex: 1 }}>
                    <Text maxFontSizeMultiplier={1.4} style={s.matchName}>{m.matched_name}</Text>
                    <Text maxFontSizeMultiplier={1.3} style={s.line}>{[roleLabel(m.role), m.matter_title].filter(Boolean).join(' · ')}</Text>
                  </View>
                </View>
              ))}
            </View>
          ))}

          <Text maxFontSizeMultiplier={1.3} style={[s.h2, { marginTop: 28 }]}>{t('cc_add_title')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.line}>{t('cc_add_body')}</Text>
          <View style={s.chips}>
            {ROLES.map(r => (
              <TouchableOpacity key={r} accessibilityRole="radio" aria-checked={role === r} accessibilityState={{ checked: role === r }} testID={`cc-role-${r}`}
                style={[s.chip, role === r && { backgroundColor: colors.navy, borderColor: colors.navy }]} onPress={() => setRole(r)}>
                <Text maxFontSizeMultiplier={1.2} style={[s.chipText, role === r && { color: colors.textOnNavy }]}>{t(`cc_role_${r}`)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput testID="cc-add-names" style={s.area} value={addNames} onChangeText={setAddNames} multiline maxLength={4000}
            placeholder={t('cc_add_ph')} placeholderTextColor={colors.placeholder} accessibilityLabel={t('cc_add_title')} />
          {!!addMsg && <Text maxFontSizeMultiplier={1.4} testID="cc-add-msg" style={{ marginTop: 8, color: addMsg.tone === 'ok' ? colors.legalDark : addMsg.tone === 'warn' ? colors.warnDark : colors.danger }}>{addMsg.text}</Text>}
          <TouchableOpacity accessibilityRole="button" testID="cc-add" style={[s.ghostBtn, adding && { opacity: 0.6 }]} disabled={adding} onPress={add}>
            <Text maxFontSizeMultiplier={1.4} style={s.ghostText}>{t('cc_add_cta')}</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  h1: { fontSize: 22, ...FONTS.heavy, color: colors.textBrand, marginBottom: 6 },
  h2: { fontSize: 17, ...FONTS.heavy, color: colors.textPrimary, marginBottom: 4 },
  title: { fontSize: 15, ...FONTS.heavy, color: colors.textPrimary },
  line: { fontSize: 14, lineHeight: 20, color: colors.textSecond, marginTop: 2 },
  area: { borderWidth: 1, borderColor: colors.inputBorder, borderRadius: RADIUS.md, padding: 12, fontSize: 14, minHeight: 110, textAlignVertical: 'top', marginTop: 12, color: colors.inputText, backgroundColor: colors.inputBg },
  primaryBtn: { minHeight: 48, borderRadius: RADIUS.md, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', marginTop: 12, paddingHorizontal: 12 },
  primaryText: { color: colors.textOnNavy, fontSize: 15, ...FONTS.heavy, textAlign: 'center' },
  ghostBtn: { minHeight: 44, paddingHorizontal: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignSelf: 'flex-start', marginTop: 10, backgroundColor: colors.bgCard },
  ghostText: { fontSize: 14, ...FONTS.semi, color: colors.info },
  error: { color: colors.danger, marginTop: 10, fontSize: 14 },
  banner: { borderRadius: RADIUS.md, padding: 14, marginTop: 16, borderWidth: 1 },
  bannerTitle: { fontSize: 16, ...FONTS.heavy, marginBottom: 2 },
  card: { backgroundColor: colors.bgCard, borderRadius: RADIUS.lg, padding: 14, marginTop: 10, borderWidth: 1, borderColor: colors.border },
  matchRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 8 },
  badge: { color: COLORS.white, fontSize: 11, ...FONTS.heavy, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill, overflow: 'hidden' },
  matchName: { fontSize: 14, ...FONTS.semi, color: colors.textPrimary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: { minHeight: 44, paddingHorizontal: 12, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', backgroundColor: colors.bgCard },
  chipText: { fontSize: 13, ...FONTS.semi, color: colors.textSecond },
});

export default React.memo(ConflictCheckScreen);
