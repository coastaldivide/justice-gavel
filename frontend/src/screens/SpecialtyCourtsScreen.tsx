/**
 * SpecialtyCourtsScreen — veterans, drug and mental-health courts on record.
 *
 * Rows come from the public GET /api/legaldata/specialty-courts (state filter,
 * request language: eligibility / notes are served translated when a
 * translation of the current English text is stored, otherwise in English and
 * labelled). Each card shows its source as recorded and the date it was
 * recorded; none of it has been reviewed by a lawyer. Route params `state` and
 * `type` preselect the filters (Diversion opens it on its court type).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { FlashListCompat as FlashList } from '../components/FlashListCompat';
import { api, apiErrorMessage, unwrapList } from '../services/api';
import { useTheme } from '../constants/theme';
import { getUserState, stateName } from '../utils/userState';
import { StatePicker } from '../components/StatePicker';
import { ContactActions } from '../components/ContactActions';
import { SourceLine, UnreviewedNotice } from '../components/LegalSource';
import { t, useLang, getLang } from '../i18n';
import { IconLabel, ICONS, type IconName } from '../components/AppIcon';

type CourtType = 'Veterans' | 'Drug Court' | 'Mental Health Court';
interface SpecialtyCourt {
  id: number; name: string; court_type: string; city: string; state: string; county: string | null;
  address: string | null; phone: string | null; url: string | null; eligibility: string | null; notes: string | null;
  lat: number | null; lng: number | null; source_url: string | null; created_at: string | null; text_lang?: string;
}

const TYPES: { key: CourtType | 'ALL'; label: string; icon: IconName }[] = [
  { key: 'ALL', label: 'x_specialty_courts_all_specialty_courts', icon: ICONS.lawyer },
  { key: 'Veterans', label: 'x_specialty_courts_veterans_courts', icon: ICONS.medal },
  { key: 'Drug Court', label: 'x_specialty_courts_drug_courts', icon: ICONS.drug },
  { key: 'Mental Health Court', label: 'x_specialty_courts_mental_health_courts', icon: ICONS.mentalHealth },
];
const typeLabel = (k: string) => t(TYPES.find(x => x.key === k)?.label || 'x_specialty_courts_all_specialty_courts');

function SpecialtyCourtsScreen({ route }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const params = (route?.params || {}) as { state?: string; type?: string };
  const [state, setState] = useState(String(params.state || '').toUpperCase());
  const [stateReady, setStateReady] = useState(!!params.state);
  const [type, setType] = useState<string>(TYPES.some(x => x.key === params.type) ? String(params.type) : 'ALL');
  const [rows, setRows] = useState<SpecialtyCourt[]>([]);
  const [withheld, setWithheld] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (params.state) return;
    getUserState().then(u => { if (u?.code) setState(prev => prev || u.code); }).catch(() => {}).finally(() => setStateReady(true));
  }, [params.state]);

  const load = useCallback(async () => {
    setError('');
    try {
      const query: Record<string, string> = { limit: '200', lang: getLang() };
      if (state) query.state = state;
      const res = await api.get('/legaldata/specialty-courts', { params: query });
      setRows(unwrapList<SpecialtyCourt>(res.data).filter(r => !state || r.state === state));
      setWithheld(Number((res.data as { meta?: { withheld?: number } })?.meta?.withheld) || 0);
    } catch (e) {
      setError(apiErrorMessage(e, t('x_specialty_courts_could_not_load_specialty')));
    } finally { setLoading(false); }
  }, [state]);
  useEffect(() => { if (stateReady) { setLoading(true); load(); } }, [stateReady, load]);

  const shown = type === 'ALL' ? rows : rows.filter(c => c.court_type === type);

  const header = (
    <View>
      <View style={[s.hero, { backgroundColor: colors.navy }]}>
        <Text maxFontSizeMultiplier={1.4} style={[s.heroText, { color: colors.textOnNavy }]}>{t('x_specialty_courts_veterans_treatment_courts_drug')}</Text>
      </View>
      <UnreviewedNotice inset={false} text={t('pen_not_reviewed')} testID="specialty-notice" />
      <View style={{ marginTop: 10 }}>
        <StatePicker value={state} onChange={setState} allowAll testID="specialty-state" />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} style={{ marginTop: 10 }}>
        {TYPES.map(x => (
          <TouchableOpacity key={x.key} accessibilityRole="radio" aria-checked={type === x.key} testID={`specialty-type-${x.key.replace(/ /g, '-')}`}
            onPress={() => setType(x.key)} style={[s.chip, type === x.key && s.chipOn]}>
            <IconLabel icon={x.icon} maxFontSizeMultiplier={1.3} textStyle={[s.chipText, type === x.key && s.chipTextOn]}>{t(x.label)}</IconLabel>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {!loading && !error && (
        <Text maxFontSizeMultiplier={1.4} style={s.count} testID="specialty-count">
          {t(shown.length === 1 ? 'sc_count_one' : 'sc_count_other', { n: shown.length, where: state ? stateName(state) : t('src_all_states') })}
        </Text>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="specialty-courts-screen">
      {loading ? (
        <View style={s.pad}>{header}<ActivityIndicator style={{ marginTop: 30 }} color={colors.textBrand} /></View>
      ) : error ? (
        <View style={s.pad} testID="specialty-error">
          {header}
          <Text maxFontSizeMultiplier={1.4} style={s.error}>{error}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => { setLoading(true); load(); }} style={s.retry}>
            <Text maxFontSizeMultiplier={1.3} style={s.retryText}>{t('retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlashList
          data={shown}
          keyExtractor={(i: SpecialtyCourt) => String(i.id)}
          contentContainerStyle={s.pad}
          ListHeaderComponent={header}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
          renderItem={({ item }: { item: SpecialtyCourt }) => {
            const isOpen = open === item.id;
            return (
              <View style={[s.card, isOpen && { borderColor: colors.navy }]} testID="specialty-court">
                <TouchableOpacity accessibilityRole="button" aria-expanded={isOpen} onPress={() => setOpen(isOpen ? null : item.id)}>
                  <Text maxFontSizeMultiplier={1.3} style={s.badge}>{typeLabel(item.court_type)} · {stateName(item.state)}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={s.name}>{item.name} {isOpen ? '▲' : '▼'}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={s.muted}>
                    {item.county ? t('x_specialty_courts_county', { city: item.city, state: item.state, county: item.county }) : `${item.city}, ${item.state}`}
                  </Text>
                </TouchableOpacity>
                {isOpen && (
                  <View style={{ marginTop: 10, gap: 8 }} testID="specialty-details">
                    {!!item.eligibility && (
                      <View style={[s.box, { backgroundColor: colors.bgSubtle }]}>
                        <Text maxFontSizeMultiplier={1.3} style={s.boxTitle}>{t('mh_who')}</Text>
                        <Text maxFontSizeMultiplier={1.4} style={s.body}>{item.eligibility}</Text>
                      </View>
                    )}
                    {!!item.notes && <IconLabel icon={ICONS.alertNormal} textStyle={s.body} maxFontSizeMultiplier={1.4}>{item.notes}</IconLabel>}
                    {item.text_lang === 'en' && getLang() !== 'en' && <Text maxFontSizeMultiplier={1.3} style={s.muted}>{t('pen_notes_english')}</Text>}
                    <ContactActions listing={{ name: item.name, phone: item.phone, address: item.address, lat: item.lat, lng: item.lng, website: item.url }} />
                    <View style={[s.box, { backgroundColor: colors.bgSubtle }]}>
                      <Text maxFontSizeMultiplier={1.3} style={s.boxTitle}>{t('x_specialty_courts_how_get')}</Text>
                      <Text maxFontSizeMultiplier={1.4} style={s.body}>{t('x_specialty_courts_tell_attorney_interested_this')}</Text>
                    </View>
                  </View>
                )}
                <SourceLine source={item.source_url} recorded={item.created_at} testID="specialty-source" />
              </View>
            );
          }}
          ListEmptyComponent={
            <Text maxFontSizeMultiplier={1.4} style={s.empty} testID="specialty-empty">{withheld > 0 ? t('legal_unverified_withheld', { state: state ? stateName(state) : t('src_all_states') }) : t('sc_none', { where: state ? stateName(state) : t('src_all_states') })}</Text>
          }
        />
      )}
    </View>
  );
}

const makeStyles = (c: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  pad: { padding: 16, paddingBottom: 40 },
  hero: { borderRadius: 12, padding: 14 },
  heroText: { fontSize: 13, lineHeight: 19 },
  chips: { gap: 8, paddingRight: 8 },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 22, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.bgCard },
  chipOn: { borderColor: c.navy, backgroundColor: c.navy },
  chipText: { fontSize: 13, fontWeight: '600', color: c.textSecond },
  chipTextOn: { color: c.textOnNavy },
  count: { fontSize: 12, color: c.textMuted, marginTop: 10, marginBottom: 6 },
  card: { backgroundColor: c.bgCard, borderRadius: 12, marginBottom: 10, padding: 14, borderWidth: 1, borderColor: c.border },
  badge: { fontSize: 11, fontWeight: '800', color: c.textBrand, textTransform: 'uppercase' },
  name: { fontSize: 15, fontWeight: '800', color: c.textPrimary, marginTop: 4, lineHeight: 21 },
  muted: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  box: { borderRadius: 8, padding: 10, gap: 4 },
  boxTitle: { fontSize: 11, fontWeight: '800', color: c.textBrand },
  body: { fontSize: 13, lineHeight: 19, color: c.textSecond },
  error: { color: c.emergencyDark, textAlign: 'center', marginTop: 20 },
  retry: { minHeight: 44, marginTop: 10, paddingHorizontal: 20, borderRadius: 10, borderWidth: 1, borderColor: c.navy, alignSelf: 'center', justifyContent: 'center' },
  retryText: { color: c.textBrand, fontWeight: '700' },
  empty: { color: c.textSecond, textAlign: 'center', marginTop: 30, lineHeight: 20 },
});

export default React.memo(SpecialtyCourtsScreen);
