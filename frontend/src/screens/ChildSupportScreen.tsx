/**
 * ChildSupportScreen — child support amounts by state.
 *
 * This screen used to print a dollar estimate from a made-up "national average"
 * obligation table and a made-up shared-custody discount. No state's guideline
 * formula is recorded in the app with a source, so it now says that for the
 * chosen state and points to where the official calculation comes from, instead
 * of showing a number. (Listed for the owner in notes/debug_pass.md section F.)
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { useTheme, RADIUS } from '../constants/theme';
import { getUserState, stateName } from '../utils/userState';
import { StatePicker } from '../components/StatePicker';
import { UnreviewedNotice } from '../components/LegalSource';
import { t, useLang } from '../i18n';

function ChildSupportScreen({ navigation, route }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const s = React.useMemo(() => makeStyles(colors), [colors]);
  const initial = String((route?.params as { state?: string } | undefined)?.state || '').toUpperCase();
  const [state, setState] = useState(initial);
  useEffect(() => {
    if (!initial) getUserState().then(u => { if (u?.code) setState(prev => prev || u.code); }).catch(() => {});
  }, [initial]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={s.content} testID="child-support-screen">
      <View style={[s.header, { backgroundColor: colors.navy }]}>
        <Text maxFontSizeMultiplier={1.4} style={[s.title, { color: colors.textOnNavy }]}>{t('cs_title')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[s.sub, { color: colors.textOnNavy }]}>{t('cs_sub')}</Text>
      </View>

      <Text maxFontSizeMultiplier={1.4} style={s.label}>{t('div_your_state')}</Text>
      <StatePicker value={state} onChange={setState} testID="child-support-state" />

      {!!state && (
        <View style={s.card} testID="child-support-unavailable">
          <Text maxFontSizeMultiplier={1.4} style={s.cardTitle}>{t('cs_unavailable_title', { state: stateName(state) })}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.body}>{t('cs_unavailable_body')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.cardTitle}>{t('cs_where_title')}</Text>
          {['cs_where_agency', 'cs_where_court', 'cs_where_lawyer'].map(k => (
            <Text key={k} maxFontSizeMultiplier={1.4} style={s.body}>• {t(k)}</Text>
          ))}
        </View>
      )}
      <UnreviewedNotice inset={false} />

      <TouchableOpacity accessibilityRole="button" testID="child-support-guide" style={s.secondary} onPress={() => navigation.navigate('FamilyCourt', { tab: 'support' })}>
        <Text maxFontSizeMultiplier={1.3} style={s.secondaryText}>{t('cs_open_guide')}</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" testID="child-support-lawyer" style={s.secondary} onPress={() => navigation.navigate('LawyersTab')}>
        <Text maxFontSizeMultiplier={1.3} style={s.secondaryText}>{t('cs_find_lawyer')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const makeStyles = (c: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  content: { padding: 16, paddingBottom: 48, width: '100%', maxWidth: 760, alignSelf: 'center' },
  header: { borderRadius: RADIUS.lg, padding: 20, marginBottom: 8 },
  title: { fontSize: 21, fontWeight: '800', marginBottom: 6 },
  sub: { fontSize: 13, lineHeight: 19 },
  label: { fontSize: 14, fontWeight: '800', color: c.textBrand, marginTop: 16, marginBottom: 8 },
  card: { backgroundColor: c.bgCard, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 14, marginTop: 14, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: c.textPrimary },
  body: { fontSize: 14, lineHeight: 20, color: c.textSecond },
  secondary: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: c.navy, alignItems: 'center', justifyContent: 'center', marginTop: 12, paddingHorizontal: 12 },
  secondaryText: { color: c.textBrand, fontSize: 15, fontWeight: '700', textAlign: 'center' },
});

export default React.memo(ChildSupportScreen);
