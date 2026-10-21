import { AIDisclaimer } from '../components/AIDisclaimer';
import {} from '../components/LegalCharts';
import UPLDisclaimer from '../components/UPLDisclaimer';
import type { ScreenProps } from '../types/navigation';
import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, LayoutAnimation, RefreshControl } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { unwrapList, cachedGet } from '../services/api';
import { useTheme } from '../constants/theme';
import { t, useLang, locale } from '../i18n';
import { IconLabel, ICONS } from '../components/AppIcon';

const STATES = [
  'ALL','AL','AK','AZ','AR','CA','CO','CT','DC','DE','FL','GA','HI',
  'ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS',
  'MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR',
  'PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
];

type Schedule = {
  id: number; state: string; charge: string; charge_type: string;
  severity: string; bail_min: number; bail_max: number | null; bail_note?: string;
  source?: string | null; last_reviewed?: string | null;
};

// Bail ranges only. There is no sourced per-state bail-agent fee data in the
// app yet, so no fee estimate is shown (owner rule) — the agent sets the fee.
// The note is the server's (GET /help/bail-schedule meta.fee_note) in the app's
// language, or the bundled copy of the same text (bc_fee_note).
// Charge names, severities and notes are database records shown as recorded.
const typeLabel = (ct: string) => (ct === 'felony' ? t('bc_type_felony') : ct === 'misdemeanor' ? t('bc_type_misdemeanor') : (ct || '').toUpperCase());

function BailCalculatorScreen({ navigation, route }: ScreenProps) {
  const lang = useLang();
  const params = (route?.params || {}) as { state?: string; chargeType?: string; caseTitle?: string };
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const { colors, isDark } = useTheme();
  const [refreshTick, setRefreshTick] = React.useState(0);
  const [state, setState] = useState(params.state && STATES.includes(params.state) ? params.state : 'TN');
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [selected, setSelected] = useState<Schedule | null>(null);
  const [filter, setFilter] = useState(params.chargeType || '');
  const [meta, setMeta] = useState<{ fee_note?: string; language?: string } | null>(null);
  const feeNote = meta?.fee_note && (meta.language || 'en') === lang ? meta.fee_note : t('bc_fee_note');

  const bg   = colors.bg;
  const card = isDark ? colors.surface : colors.bgCard;
  const text = colors.textPrimary;
  const sub  = colors.textMuted;

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    cachedGet(`/help/bail-schedule?state=${state}&lang=${lang}`)
      .then(r => { if (!cancel) { setSchedules(unwrapList<Schedule>(r.data)); setMeta((r.data as any)?.meta || null); setFetchError(false); setNeedsSignIn(false); } })
      .catch((e: { response?: { status?: number } }) => { if (!cancel) { setSchedules([]); setFetchError(true); setNeedsSignIn(e?.response?.status === 401); } })
      .finally(() => { if (!cancel) { setLoading(false); setRefreshing(false); } });
    return () => { cancel = true; };
  }, [state, refreshTick, lang]);

  const filtered = schedules.filter(s =>
    !filter || (s.charge || "").toLowerCase().includes(filter.toLowerCase())
  );

  const fmt = (n: number) => '$' + n.toLocaleString(locale());

  const onRefresh = () => { setRefreshing(true); setRefreshTick(t => t + 1); };
  return (
    <KeyboardAvoidingView
      testID="bail-calculator-screen"
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1, backgroundColor: bg }} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
      <UPLDisclaimer compact />
      <View style={{ padding: 16 }}>
        {/* Header card */}
        <View style={{
          backgroundColor: colors.primary, borderRadius: 14, padding: 16, marginBottom: 16,
        }}>
          <IconLabel icon={ICONS.money} textStyle={{ color: colors.bgCard, fontWeight: '800', fontSize: 18 }} maxFontSizeMultiplier={1.4}>{t('bc_title')}</IconLabel>
          <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textOnAccent, fontSize: 13, marginTop: 4 }}>
            {t('bc_intro')}
          </Text>
        </View>

        {!!params.caseTitle && (
          <Text testID="bail-case-link" maxFontSizeMultiplier={1.4} style={{ color: text, fontWeight: '700', fontSize: 14, marginBottom: 10 }}>
            {t('bc_for_case', { title: params.caseTitle })}{params.chargeType ? ` (${params.chargeType})` : ''}
          </Text>
        )}
        {/* State selector */}
        <Text maxFontSizeMultiplier={1.4} style={{ color: sub, fontWeight: '600', fontSize: 12, marginBottom: 6, letterSpacing: 0.8 }}>
          {t('bc_state_label')}
        </Text>
        <View style={{
          backgroundColor: card, borderRadius: 10, borderWidth: 1,
          borderColor: colors.border, marginBottom: 12, overflow: 'hidden',
        }}>
          <Picker
            selectedValue={state}
            onValueChange={v => { setState(v as string); setSelected(null); }}
            // On web this is a native <select>: without an explicit background it is
            // white, and the light theme-text colour made the chosen state unreadable.
            style={{ color: text, height: 48, backgroundColor: card, borderWidth: 0, paddingHorizontal: 10 }}
            dropdownIconColor={sub}
          >
            {STATES.map(s => <Picker.Item key={s} label={s === 'ALL' ? t('bc_national') : s} value={s} />)}
          </Picker>
        </View>

        {/* Charge search */}
        <Text maxFontSizeMultiplier={1.4} style={{ color: sub, fontWeight: '600', fontSize: 12, marginBottom: 6, letterSpacing: 0.8 }}>
          {t('bc_search_label')}
        </Text>
        <TextInput
          accessibilityLabel={t('bc_search_placeholder')}
          value={filter}
          onChangeText={setFilter}
          placeholder={t('bc_search_placeholder')}
          placeholderTextColor={sub}
          style={{
            backgroundColor: card, borderRadius: 10, paddingHorizontal: 14,
            paddingVertical: 10, color: text, fontSize: 14, marginBottom: 12,
            borderWidth: 1, borderColor: colors.border,
          }}
          returnKeyType="search" blurOnSubmit={true}
        />

        {loading && <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />}
        {!loading && !fetchError && schedules.length > 0 && filtered.length === 0 && (
          <Text testID="bail-no-match" maxFontSizeMultiplier={1.4} style={{ color: sub, textAlign: 'center', marginVertical: 16 }}>
            {t('bc_no_match', { q: filter })}
          </Text>
        )}
        {!loading && !fetchError && schedules.length === 0 && (
          <Text testID="bail-no-schedules" maxFontSizeMultiplier={1.4} style={{ color: sub, textAlign: 'center', marginVertical: 16 }}>
            {t('bc_no_schedules', { place: state === 'ALL' ? t('bc_national_lower') : state })}
          </Text>
        )}
        {fetchError && !loading && !schedules.length && (
          <View style={{ alignItems:'center', padding:24 }}>
            <Text testID="bail-fetch-error" maxFontSizeMultiplier={1.4} style={{ color: sub, marginBottom: 8, textAlign: 'center' }}>
              {needsSignIn ? t('bc_sign_in') : t('bc_load_failed')}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityHint={t('cp_double_tap')} accessibilityLabel={t('bc_retry')} onPress={() => { setFetchError(false); setRefreshTick(n => n + 1); }}>
              <Text maxFontSizeMultiplier={1.4} style={{ color:colors.primary }}>{t('bc_retry')}</Text>
            </TouchableOpacity>
          </View>
        )}
        {/* Charge list */}
        {filtered.map(s => {
          const isSel = selected?.id === s.id;
          const typeColor = s.charge_type === 'felony'
            ? { bg: colors.emergencyBg, border: colors.emergencyDark, text: colors.emergencyDark }
            : { bg: colors.legalBg, border: colors.legalDark, text: colors.legalDark };

          return (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityHint={t('cp_double_tap')}
              key={s.id}
              testID="bail-schedule-row"
              onPress={() => setSelected(isSel ? null : s)}
              style={{
                backgroundColor: isSel ? (isDark ? colors.bgSubtle : colors.infoBg) : card,
                borderRadius: 12, padding: 13, marginBottom: 8,
                borderWidth: 1.5,
                borderColor: isSel ? colors.primary : (colors.border),
              }}
              accessibilityLabel={s.charge}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{
                  backgroundColor: typeColor.bg, borderRadius: 6,
                  paddingHorizontal: 7, paddingVertical: 3,
                }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ color: typeColor.text, fontWeight: '700', fontSize: 10 }}>
                    {typeLabel(s.charge_type || '')}
                  </Text>
                </View>
                <Text maxFontSizeMultiplier={1.4} style={{ color: text, fontWeight: '600', fontSize: 13, flex: 1 }}>
                  {s.charge}
                </Text>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <Text maxFontSizeMultiplier={1.4} style={{ color: sub, fontSize: 12 }}>{s.severity}</Text>
                <Text maxFontSizeMultiplier={1.4} style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>
                  {s.bail_min === 0 && !s.bail_max ? t('bc_no_bail')
                    : s.bail_max === null ? `${fmt(s.bail_min)}+`
                    : `${fmt(s.bail_min)} - ${fmt(s.bail_max)}`}
                </Text>
              </View>

              {/* Expanded breakdown */}
              {isSel && (
                <View testID="bail-breakdown" style={{
                  marginTop: 12, borderTopWidth: 1,
                  borderTopColor: colors.border, paddingTop: 12, gap: 8,
                }}>
                  <IconLabel icon={ICONS.idea} textStyle={{ color: text, fontWeight: '700', fontSize: 14 }} maxFontSizeMultiplier={1.4}>{t('bc_breakdown')}</IconLabel>

                  {s.bail_min > 0 && (
                    <>
                      <Row label={t('bc_typical_range')} value={
                        s.bail_max ? `${fmt(s.bail_min)} - ${fmt(s.bail_max)}` : `${fmt(s.bail_min)}+`
                      } text={text} sub={sub} />
                      <Row label={t('bc_cash_bail')} value={s.bail_max ? `${fmt(s.bail_min)} - ${fmt(s.bail_max)}` : `${fmt(s.bail_min)}+`} text={text} sub={sub} />
                      <Text testID="bail-fee-note" maxFontSizeMultiplier={1.4} style={{ color: sub, fontSize: 12, lineHeight: 17 }}>
                        {t('bc_agent_fee')} {feeNote}
                      </Text>
                    </>
                  )}

                  {!!s.source && (
                    <Text testID="bail-source" maxFontSizeMultiplier={1.4} style={{ color: sub, fontSize: 11 }}>
                      {t('rc_source')}: {s.source.replace(/_/g, ' ')}{s.last_reviewed ? ` · ${t('rc_last_reviewed')}: ${s.last_reviewed}` : ` · ${t('bc_no_review_date')}`}
                    </Text>
                  )}
                  {s.bail_note ? (
                    <View style={{
                      backgroundColor: isDark ? colors.surface : colors.bgCard,
                      borderRadius: 8, padding: 10,
                    }}>
                      <IconLabel icon={ICONS.alertNormal} textStyle={{ color: isDark ? colors.gold : colors.warnDark, fontSize: 12 }} maxFontSizeMultiplier={1.4}>{s.bail_note}</IconLabel>
                    </View>
                  ) : null}
                  {/* legalBg is the tinted surface in BOTH themes; the old dark-mode
                      background was colors.legal — the same green as the text, so the
                      explanation was invisible. */}
                  <View testID="bail-how-bondsmen-work" style={{
                    backgroundColor: colors.legalBg,
                    borderRadius: 8, padding: 10, marginTop: 4,
                  }}>
                    <Text maxFontSizeMultiplier={1.4} style={{ color: isDark ? colors.legal : colors.legalDark, fontSize: 12, fontWeight: '600' }}>
                      {t('bc_how_title')}
                    </Text>
                    <Text maxFontSizeMultiplier={1.4} style={{ color: isDark ? colors.legal : colors.legalDark, fontSize: 12, marginTop: 4 }}>
                      {t('bc_how_body')}
                    </Text>
                  </View>
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        {/* EmptyState: use <EmptyState icon="📋" title="Nothing here yet" subtitle="Content will appear when available" /> */}

        {/* Innocent until proven guilty context */}
        {!!selected && (
          <View style={{ backgroundColor: colors.bgCard, borderRadius: 12,
            padding: 14, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: colors.gold }}>
            <IconLabel icon={ICONS.lawyer} textStyle={{ fontSize: 13, fontWeight: '700',
              color: colors.textPrimary, marginBottom: 4 }} maxFontSizeMultiplier={1.3}>{t('bc_not_convicted')}</IconLabel>
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, color: colors.textSecond, lineHeight: 18 }}>
              {t('bc_not_convicted_body')}
            </Text>
          </View>
        )}
        {/* Bondsman CTA */}
        <View style={{
          backgroundColor: colors.bail, borderRadius:12,
          padding:14, alignItems:'center', marginTop:8,
        }}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityHint={t('cp_double_tap')}
            onPress={() => navigation.navigate('BailTab')}
          >
            <IconLabel icon={ICONS.bail} textStyle={{ color:colors.bgCard, fontWeight:'700', fontSize:14 }} maxFontSizeMultiplier={1.4}>{t('bc_find_bondsman')}</IconLabel>
            <Text maxFontSizeMultiplier={1.4} style={{ color:colors.textOnAccent, fontSize:11,
              textAlign:'center', marginTop:4 }}>
              {t('bc_find_bondsman_sub')}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: 40 }} />
      </View>

        {/* Real attorney CTA -- now powered by live data */}
        <View style={{ marginHorizontal: 16, marginBottom: 20 }}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityHint={t('cp_double_tap')}
            style={{ backgroundColor: colors.navy, borderRadius: 14,
              paddingVertical: 16, alignItems: 'center' }}
            onPress={() => navigation.navigate('LawyersTab')}
          hitSlop={{  top: 12, bottom: 12, left: 12, right: 12  }}
            activeOpacity={0.85}
          >
            <IconLabel icon={ICONS.lawyer} textStyle={{ color: colors.textOnNavy, fontSize: 15, fontWeight: '800' }} maxFontSizeMultiplier={1.2}>{t('bc_find_attorneys')}</IconLabel>
            <Text maxFontSizeMultiplier={1.3}
              style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 3 }}>
              {t('bc_find_attorneys_sub')}
            </Text>
          </TouchableOpacity>
        </View>

      {/* ── Not legal advice disclaimer ──────────────────────── */}
      <View style={{ backgroundColor: colors.bgCard, borderRadius: 10,
        borderLeftWidth: 4, borderLeftColor: colors.warn,
        padding: 12, marginTop: 16, marginBottom: 8 }}>
        <IconLabel icon={ICONS.lawyer} textStyle={{ fontSize: 11, lineHeight: 16,
          color: colors.textSecond, fontStyle: 'italic' }} maxFontSizeMultiplier={1.3}>{t('bc_disclaimer')}</IconLabel>
      </View>
      </ScrollView>
      <AIDisclaimer variant="banner" />

      </KeyboardAvoidingView>
  );
}

function Row({ label, value, text, sub, highlight, testID }:
  { label:string; value:string; text:string; sub:string; highlight?:string; testID?: string }) {
  useLang();
  return (
    <View testID={testID} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text maxFontSizeMultiplier={1.4} style={{ color: sub, fontSize: 12, flex: 1 }}>{label}</Text>
      <Text maxFontSizeMultiplier={1.4} style={{ color: highlight || text, fontWeight: '600', fontSize: 13 }}>{value}</Text>
    </View>
  );
}

export default React.memo(BailCalculatorScreen);
