/**
 * InsuranceScreen — "Legal insurance" entry (Home tile, Settings › My tools).
 *
 * Justice Gavel has no legal-insurance product and no insurance partner. This
 * screen used to "quote" made-up plans from a fake "Justice Gavel Insurance
 * Partners" (Legal Pro at $19.99 when the real plan is $34.99) and its "Enroll
 * now" opened the payments screen with a broken purpose. It now says so plainly
 * and lists the app's real plans and prices from GET /billing/tiers?audience=consumer,
 * with a button to the plans screen (payments stay off until Stripe is set up).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { useTheme } from '../constants/theme';
import { consumerPlansFrom } from './ConsumerSubscriptionScreen';
import { t, useLang, locale } from '../i18n';

interface Plan { key: string; label: string; monthly: number | null; features: string[] }

function InsuranceScreen({ navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const s = React.useMemo(() => makeStyles(colors), [colors]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await api.get('/billing/tiers', { params: { audience: 'consumer' } });
      const cents = new Map<string, number>((r.data?.tiers || []).map((x: { key: string; monthly_cents: number }) => [x.key, x.monthly_cents]));
      setPlans(consumerPlansFrom(r.data).map(p => ({ key: p.key, label: p.label, monthly: cents.get(p.key) ?? null, features: p.features || [] })));
    } catch (e) {
      setError(apiErrorMessage(e, t('ins_load_error')));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const money = (c: number | null) => (c == null ? '' : (c / 100).toLocaleString(locale(), { style: 'currency', currency: 'USD' }));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={s.content} testID="insurance-screen">
      <View style={[s.header, { backgroundColor: colors.navy }]}>
        <Text maxFontSizeMultiplier={1.4} style={[s.title, { color: colors.textOnNavy }]}>{t('x_insurance_legal_insurance')}</Text>
      </View>
      <View style={s.card} testID="insurance-none">
        <Text maxFontSizeMultiplier={1.4} style={s.cardTitle}>{t('ins_none_title')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={s.body}>{t('ins_none_body')}</Text>
      </View>

      <Text maxFontSizeMultiplier={1.4} style={s.section}>{t('ins_plans_title')}</Text>
      {loading && <ActivityIndicator color={colors.navy} style={{ marginTop: 16 }} />}
      {!!error && (
        <View style={s.card} testID="insurance-error">
          <Text maxFontSizeMultiplier={1.4} style={s.error}>{error}</Text>
          <TouchableOpacity accessibilityRole="button" style={s.secondary} onPress={load}>
            <Text maxFontSizeMultiplier={1.3} style={s.secondaryText}>{t('try_again')}</Text>
          </TouchableOpacity>
        </View>
      )}
      {plans.map(p => (
        <View key={p.key} style={s.card} testID="insurance-plan">
          <View style={s.row}>
            <Text maxFontSizeMultiplier={1.4} style={[s.cardTitle, { flex: 1 }]}>{p.label}</Text>
            {p.monthly != null && <Text maxFontSizeMultiplier={1.3} style={s.price} testID={`insurance-price-${p.key}`}>{money(p.monthly)}{t('x_check_in_manager_mo')}</Text>}
          </View>
          {p.features.slice(0, 4).map(f => <Text key={f} maxFontSizeMultiplier={1.4} style={s.body}>• {f}</Text>)}
        </View>
      ))}
      {plans.length > 0 && (
        <TouchableOpacity accessibilityRole="button" testID="insurance-see-plans" style={[s.primary, { backgroundColor: colors.navy }]} onPress={() => navigation.navigate('ConsumerSubscription')}>
          <Text maxFontSizeMultiplier={1.3} style={[s.primaryText, { color: colors.textOnNavy }]}>{t('ins_see_plans')}</Text>
        </TouchableOpacity>
      )}
      <Text maxFontSizeMultiplier={1.3} style={s.muted}>{t('ins_footer')}</Text>
    </ScrollView>
  );
}

const makeStyles = (c: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  content: { padding: 16, paddingBottom: 48, width: '100%', maxWidth: 760, alignSelf: 'center' },
  header: { borderRadius: 14, padding: 18 },
  title: { fontSize: 21, fontWeight: '800' },
  section: { fontSize: 13, fontWeight: '800', color: c.textMuted, marginTop: 18, textTransform: 'uppercase', letterSpacing: 0.6 },
  card: { backgroundColor: c.bgCard, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 14, marginTop: 10, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: c.textPrimary },
  price: { fontSize: 15, fontWeight: '800', color: c.textBrand },
  body: { fontSize: 13, lineHeight: 19, color: c.textSecond },
  error: { color: c.emergencyDark, fontSize: 13 },
  primary: { minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 16, paddingHorizontal: 12 },
  primaryText: { fontSize: 15, fontWeight: '800', textAlign: 'center' },
  secondary: { minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: c.navy, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: c.textBrand, fontWeight: '700' },
  muted: { fontSize: 12, lineHeight: 17, color: c.textMuted, marginTop: 14 },
});

export default React.memo(InsuranceScreen);
