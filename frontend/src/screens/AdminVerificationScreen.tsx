/**
 * AdminVerificationScreen — the staff review queues (admin role only; the server
 * checks the role on every call: routes/admin/queue.js). Every decision is audit-logged.
 *
 *   Bar numbers      attorneys' submissions: look the number up on the state bar's site
 *                    (link), then approve, or reject with a reason the attorney sees
 *   Listing claims   "this listing is mine": approval links the claimant's profile
 *   Listing reports  "something is wrong with this listing": resolved / dismissed
 *   Reviews          held or reported reviews: publish / hide
 * Directory rows are never edited from here.
 */
import React, { useCallback, useEffect, useState } from 'react';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, Linking, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api, apiErrorMessage } from '../services/api';
import { SignInNeeded, useHasSession } from '../components/SignInNeeded';
import { useStoredUser, isAdminUser } from '../hooks/useStoredUser';
import { useConfirm } from '../hooks/useConfirm';
import { stateName } from '../utils/userState';
import { FONTS, RADIUS, useTheme } from '../constants/theme';
import { t, useLang, locale } from '../i18n';
import { IconLabel, ICONS } from '../components/AppIcon';

type Q = 'bar' | 'claims' | 'reports' | 'reviews';
type Bar = { user_id: number; display_name: string | null; email: string; bar_number: string; bar_state: string; bar_submitted_at: string | null; lookup_url: string | null };
type Claim = { id: number; table_name: string; listing_name: string | null; listing_state: string | null; claimant_name: string | null; claimant_email: string; license_number: string | null; license_state: string | null; listing_bar_number: string | null; listing_license: string | null; note: string | null; created_at: string };
type Report = { id: number; table_name: string; listing_name: string | null; listing_city: string | null; listing_state: string | null; reason: string; details: string | null; created_at: string };
type Review = { id: number; entity_type: string; listing_name: string | null; rating: number; comment: string | null; status: string; open_reports: number; report_reasons: string | null; created_at: string };
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric' }) : '');

function AdminVerificationScreen({ navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { confirm } = useConfirm();
  const { hasSession, recheck } = useHasSession();
  const { user, ready } = useStoredUser();
  const [q, setQ] = useState<Q>('bar');
  const [counts, setCounts] = useState<Record<Q, number> | null>(null);
  const [rows, setRows] = useState<unknown[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const allowed = isAdminUser(user);

  const load = useCallback(async (which: Q) => {
    setError(''); setRows(null);
    try {
      const [sum, list] = await Promise.all([api.get('/admin/queue/summary'), api.get(`/admin/queue/${which}`)]);
      setCounts(sum.data as Record<Q, number>);
      const key = which === 'bar' ? 'pending' : which;
      setRows((list.data?.[key] || []) as unknown[]);
    } catch (e) { setError(apiErrorMessage(e, t('adm_load_error'))); setRows([]); }
    finally { setRefreshing(false); }
  }, []);
  useEffect(() => { if (hasSession && allowed) load(q); }, [hasSession, allowed, q, load]);

  const decide = (key: string, path: string, body: object, title: string) => confirm(title, t('adm_confirm_body'), { confirmLabel: t('adm_confirm_cta') }).then(async ok => {
    if (!ok) return;
    setBusy(key); setNotice(null);
    try { await api.post(path, body); setNotice({ text: t('adm_done'), tone: 'ok' }); load(q); }
    catch (e) { setNotice({ text: apiErrorMessage(e, t('adm_failed')), tone: 'error' }); }
    finally { setBusy(null); }
  });

  if (hasSession === false) return <View style={{ flex: 1, backgroundColor: colors.bg }}><SignInNeeded navigation={navigation} title={t('adm_title')} body={t('adm_signin_body')} onSignedIn={recheck} /></View>;
  if (hasSession === null || !ready) return <View style={[s.center, { backgroundColor: colors.bg }]}><ActivityIndicator size="large" color={colors.textBrand} /></View>;
  if (!allowed) return <View testID="admin-not-allowed" style={[s.center, { backgroundColor: colors.bg, padding: 24 }]}><Text maxFontSizeMultiplier={1.4} style={[s.title, { textAlign: 'center' }]}>{t('adm_forbidden')}</Text></View>;

  const tabs: Q[] = ['bar', 'claims', 'reports', 'reviews'];
  return (
    <View testID="admin-verification-screen" style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabBar}>
        {tabs.map(x => (
          <TouchableOpacity key={x} accessibilityRole="tab" aria-selected={q === x} accessibilityState={{ selected: q === x }} testID={`adm-tab-${x}`}
            style={[s.tab, q === x && { borderBottomColor: colors.navy }]} onPress={() => setQ(x)}>
            <Text maxFontSizeMultiplier={1.2} style={[s.tabText, q === x && { color: colors.textPrimary }]}>{t(`adm_tab_${x}`)}{counts ? ` (${counts[x]})` : ''}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(q); }} />}>
        {!!notice && <View testID="adm-notice" style={[s.notice, { borderColor: notice.tone === 'ok' ? colors.legal : colors.danger, backgroundColor: notice.tone === 'ok' ? colors.legalBg : colors.errorBg }]}><Text maxFontSizeMultiplier={1.4} style={{ color: notice.tone === 'ok' ? colors.legalDark : colors.danger }}>{notice.text}</Text></View>}
        {!!error && <View style={s.card}><Text maxFontSizeMultiplier={1.4} style={{ color: colors.danger }}>{error}</Text></View>}
        {rows === null && <ActivityIndicator style={{ marginTop: 24 }} color={colors.textBrand} />}
        {rows?.length === 0 && !error && <View style={s.card} testID="adm-empty"><Text maxFontSizeMultiplier={1.4} style={s.line}>{t('adm_empty')}</Text></View>}

        {q === 'bar' && (rows as Bar[] | null)?.map(b => (
          <View key={b.user_id} style={s.card} testID="adm-bar">
            <Text maxFontSizeMultiplier={1.4} style={s.title}>{b.display_name || b.email}</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.line}>{b.email}</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.line}>{t('adm_bar_line', { bar: b.bar_number, state: stateName(b.bar_state) })} · {fmtDay(b.bar_submitted_at)}</Text>
            {!!b.lookup_url && (
              <TouchableOpacity accessibilityRole="link" style={s.ghostBtn} onPress={() => Linking.openURL(b.lookup_url as string).catch(() => {})}>
                <IconLabel icon={ICONS.external} textStyle={s.ghostText}>{t('adm_bar_lookup', { state: stateName(b.bar_state) })}</IconLabel>
              </TouchableOpacity>
            )}
            <TextInput style={s.field} value={reasons[b.user_id] || ''} onChangeText={v => setReasons(r => ({ ...r, [b.user_id]: v }))} maxLength={500}
              placeholder={t('adm_reject_reason')} placeholderTextColor={colors.placeholder} accessibilityLabel={t('adm_reject_reason')} />
            <View style={s.row}>
              <TouchableOpacity accessibilityRole="button" testID="adm-bar-approve" style={[s.okBtn, busy !== null && { opacity: 0.5 }]} disabled={busy !== null}
                onPress={() => decide(`b${b.user_id}`, `/admin/queue/bar/${b.user_id}`, { approved: true }, t('adm_bar_approve_title', { name: b.display_name || b.email }))}>
                <Text maxFontSizeMultiplier={1.3} style={s.btnText}>{t('adm_approve')}</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" testID="adm-bar-reject" style={[s.noBtn, (busy !== null || !(reasons[b.user_id] || '').trim()) && { opacity: 0.5 }]} disabled={busy !== null || !(reasons[b.user_id] || '').trim()}
                onPress={() => decide(`b${b.user_id}`, `/admin/queue/bar/${b.user_id}`, { approved: false, reason: (reasons[b.user_id] || '').trim() }, t('adm_bar_reject_title', { name: b.display_name || b.email }))}>
                <Text maxFontSizeMultiplier={1.3} style={s.btnText}>{t('adm_reject')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {q === 'claims' && (rows as Claim[] | null)?.map(c => (
          <View key={c.id} style={s.card} testID="adm-claim">
            <Text maxFontSizeMultiplier={1.4} style={s.title}>{c.listing_name}{c.listing_state ? ` · ${stateName(c.listing_state)}` : ''}</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.line}>{t(c.table_name === 'lawyers' ? 'adm_claim_lawyer' : 'adm_claim_agent')} · {c.claimant_name || ''} ({c.claimant_email})</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.line}>{t('adm_claim_license', { given: [c.license_number, c.license_state].filter(Boolean).join(' / ') || '—', listed: (c.listing_bar_number || c.listing_license) || '—' })}</Text>
            {!!c.note && <Text maxFontSizeMultiplier={1.4} style={s.line}>“{c.note}”</Text>}
            <View style={s.row}>
              <TouchableOpacity accessibilityRole="button" style={[s.okBtn, busy !== null && { opacity: 0.5 }]} disabled={busy !== null} onPress={() => decide(`c${c.id}`, `/admin/queue/claims/${c.id}`, { decision: 'approve' }, t('adm_claim_approve_title'))}>
                <Text maxFontSizeMultiplier={1.3} style={s.btnText}>{t('adm_approve')}</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" style={[s.noBtn, busy !== null && { opacity: 0.5 }]} disabled={busy !== null} onPress={() => decide(`c${c.id}`, `/admin/queue/claims/${c.id}`, { decision: 'reject' }, t('adm_claim_reject_title'))}>
                <Text maxFontSizeMultiplier={1.3} style={s.btnText}>{t('adm_reject')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {q === 'reports' && (rows as Report[] | null)?.map(r => (
          <View key={r.id} style={s.card} testID="adm-report">
            <Text maxFontSizeMultiplier={1.4} style={s.title}>{r.listing_name}{r.listing_city ? ` · ${r.listing_city}` : ''}{r.listing_state ? `, ${r.listing_state}` : ''}</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.line}>{r.reason} · {fmtDay(r.created_at)}</Text>
            {!!r.details && <Text maxFontSizeMultiplier={1.4} style={s.line}>“{r.details}”</Text>}
            <View style={s.row}>
              <TouchableOpacity accessibilityRole="button" style={[s.okBtn, busy !== null && { opacity: 0.5 }]} disabled={busy !== null} onPress={() => decide(`r${r.id}`, `/admin/queue/reports/${r.id}`, { status: 'resolved' }, t('adm_report_resolve_title'))}>
                <Text maxFontSizeMultiplier={1.3} style={s.btnText}>{t('adm_resolved')}</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" style={[s.noBtn, busy !== null && { opacity: 0.5 }]} disabled={busy !== null} onPress={() => decide(`r${r.id}`, `/admin/queue/reports/${r.id}`, { status: 'dismissed' }, t('adm_report_dismiss_title'))}>
                <Text maxFontSizeMultiplier={1.3} style={s.btnText}>{t('adm_dismiss')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {q === 'reviews' && (rows as Review[] | null)?.map(r => (
          <View key={r.id} style={s.card} testID="adm-review">
            <Text maxFontSizeMultiplier={1.4} style={s.title}>{r.listing_name} · {t('adm_rating_of_5', { n: Math.max(0, Math.min(5, r.rating)) })}</Text>
            {!!r.comment && <Text maxFontSizeMultiplier={1.4} style={s.line}>“{r.comment}”</Text>}
            <Text maxFontSizeMultiplier={1.3} style={s.line}>{fmtDay(r.created_at)}{r.open_reports ? ` · ${t('adm_reports_n', { n: r.open_reports })}` : ''}</Text>
            <View style={s.row}>
              <TouchableOpacity accessibilityRole="button" style={[s.okBtn, busy !== null && { opacity: 0.5 }]} disabled={busy !== null} onPress={() => decide(`v${r.id}`, `/admin/queue/reviews/${r.id}`, { action: 'publish' }, t('adm_review_publish_title'))}>
                <Text maxFontSizeMultiplier={1.3} style={s.btnText}>{t('adm_publish')}</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" style={[s.noBtn, busy !== null && { opacity: 0.5 }]} disabled={busy !== null} onPress={() => decide(`v${r.id}`, `/admin/queue/reviews/${r.id}`, { action: 'hide' }, t('adm_review_hide_title'))}>
                <Text maxFontSizeMultiplier={1.3} style={s.btnText}>{t('adm_hide')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabBar: { flexGrow: 0, backgroundColor: colors.bgCard, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { minHeight: 46, paddingHorizontal: 14, justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontSize: 14, ...FONTS.bold, color: colors.textMuted },
  notice: { marginHorizontal: 12, marginTop: 12, padding: 12, borderRadius: RADIUS.md, borderWidth: 1 },
  card: { backgroundColor: colors.bgCard, marginHorizontal: 12, marginTop: 10, borderRadius: RADIUS.lg, padding: 14, borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 15, ...FONTS.heavy, color: colors.textPrimary },
  line: { fontSize: 13, lineHeight: 19, color: colors.textSecond, marginTop: 2 },
  row: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  okBtn: { minHeight: 44, paddingHorizontal: 16, borderRadius: RADIUS.md, backgroundColor: colors.legalDark, justifyContent: 'center' },
  noBtn: { minHeight: 44, paddingHorizontal: 16, borderRadius: RADIUS.md, backgroundColor: colors.emergencyDark, justifyContent: 'center' },
  btnText: { color: colors.textOnNavy, fontSize: 14, ...FONTS.heavy },
  ghostBtn: { minHeight: 44, paddingHorizontal: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignSelf: 'flex-start', marginTop: 8 },
  ghostText: { fontSize: 14, ...FONTS.semi, color: colors.info },
  field: { borderWidth: 1, borderColor: colors.inputBorder, borderRadius: RADIUS.md, paddingHorizontal: 10, minHeight: 44, color: colors.inputText, backgroundColor: colors.inputBg, fontSize: 14, marginTop: 10 },
});

export default React.memo(AdminVerificationScreen);
