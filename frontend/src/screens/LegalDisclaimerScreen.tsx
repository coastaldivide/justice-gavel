import { useToast } from '../components/ToastProvider';
import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, LayoutAnimation} from 'react-native';
import { COLORS } from '../constants/theme';
import { api, apiErrorMessage } from '../services/api';
import { getToken } from '../utils/secureStorage';
import { t, perLang, useLang } from '../i18n';

const VERSION = '2026-01-01.1';

const DISCLAIMER_SECTIONS = perLang(() => [
  {
    icon: '⚖️',
    title: t('upl_heading'),
    body: t('x_legal_disclaimer_justice_gavel_legal_information'),
  },
  {
    icon: '🤖',
    title: t('x_legal_disclaimer_ai_generated_content'),
    body: t('x_legal_disclaimer_ai_outputs_may_be'),
  },
  {
    icon: '🔒',
    title: t('x_legal_disclaimer_data'),
    body: t('x_legal_disclaimer_case_information_private_not'),
  },
  {
    icon: '🚨',
    title: t('x_legal_disclaimer_emergencies'),
    body: t('x_legal_disclaimer_if_someone_else_immediate'),
  },
  {
    icon: '⚠️',
    title: t('x_legal_disclaimer_no_guarantees'),
    body: t('x_legal_disclaimer_legal_outcomes_depend_facts'),
  },
]);

interface Props {
  /** Set when rendered directly (e.g. a gate in App.tsx). Absent when mounted
   *  by the guest navigator (deep link `legal-disclaimer`) — react-navigation
   *  passes only route/navigation, so calling it unconditionally would crash. */
  onAccepted?: () => void;
  navigation?: import('../types/navigation').AppNavigation;
  route?: import('../types/navigation').AppRoute;
}

function LegalDisclaimerScreen({ onAccepted, navigation }: Props) {
  useLang();
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, []);
  const { showToast } = useToast();
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [loading, setLoading] = React.useState(false);
  const [accepting, setAccepting] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const handleScroll = (e: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const isBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 40;
    if (isBottom) setScrolledToBottom(true);
  };

  // Signed in: the acceptance is recorded on the account (an error is shown,
  // never skipped). Signed out (the guest deep link): there is no account yet —
  // the Terms screen after sign-up records it — so just continue.
  const handleAccept = async () => {
    if (loading) return;
    if (!agreed) {
      showToast(t('x_legal_disclaimer_must_check_confirmation_box'));
      return;
    }
    setAccepting(true);
    setLoading(true);
    try {
      if (await getToken().catch(() => null)) await api.post('/auth/disclaimer/accept', { version: VERSION });
      if (onAccepted) onAccepted();
      else if (navigation?.canGoBack()) navigation.goBack();
      else navigation?.navigate('Onboarding');
    } catch (e) {
      showToast(apiErrorMessage(e, t('x_legal_disclaimer_could_not_record_acceptance')), 'error');
    } finally {
      setAccepting(false);
      setLoading(false);
    }
  };

  return (
    <View style={s.root}>
      {/* Header — always visible, non-scrollable */}
      <View style={s.header}>
        <Text style={s.headerTitle} maxFontSizeMultiplier={1.4}>{t('x_legal_disclaimer_before_continue')}</Text>
        <Text style={s.headerSub} maxFontSizeMultiplier={1.4}>
          {t('x_legal_disclaimer_please_read_our_legal')}
        </Text>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        onScroll={handleScroll}
        scrollEventThrottle={100}
      >
        
          {DISCLAIMER_SECTIONS().length === 0 && (
            <View style={{ alignItems: 'center', paddingVertical: 32 }}>
              <Text style={{ color: COLORS.textSecond, fontSize: 14 }}>{t('x_court_forms_no_results_yet')}</Text>
            </View>
          )}
{DISCLAIMER_SECTIONS().map((sec, i) => (
          <View key={`section-${i}`} style={s.section}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionIcon} maxFontSizeMultiplier={1.4}>{sec.icon}</Text>
              <Text style={s.sectionTitle} maxFontSizeMultiplier={1.4}>{sec.title}</Text>
            </View>
            <Text style={s.sectionBody} maxFontSizeMultiplier={1.4}>{sec.body}</Text>
          </View>
        ))}

        {/* Formal acceptance text */}
        <View style={s.formalBlock}>
          <Text style={s.formalText} maxFontSizeMultiplier={1.4}>
            {t('x_legal_disclaimer_by_tapping_i_understand')}{' '}
            <Text style={s.link} maxFontSizeMultiplier={1.4}>{t('onb_terms_tos')}</Text>{' '}{t('x_legal_disclaimer_modal_text')}{' '}
            <Text style={s.link} maxFontSizeMultiplier={1.4}>{t('onb_terms_pp')}</Text>.
          </Text>
          <Text style={s.formalVersion} maxFontSizeMultiplier={1.4}>{t('x_legal_disclaimer_version', { VERSION })}</Text>
        </View>
      </ScrollView>

      {/* Sticky footer — appears after scrolling */}
      {scrolledToBottom && (
        <View style={s.footer}>
          <TouchableOpacity
            accessibilityRole="checkbox"
            style={s.checkRow}
            onPress={() => setAgreed(!agreed)}
          >
            <View style={[s.checkbox, agreed && s.checkboxChecked]}>
              {agreed && <Text style={s.checkmark} maxFontSizeMultiplier={1.4}>✓</Text>}
            </View>
            <Text style={s.checkLabel} maxFontSizeMultiplier={1.4}>
              {t('x_legal_disclaimer_i_have_read_understand')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
            style={[s.acceptBtn, (!agreed || accepting) && s.acceptBtnDisabled]}
            onPress={handleAccept}
            disabled={!agreed || accepting}
          >
            {accepting
              ? <ActivityIndicator color={COLORS.white} />
              : <Text style={s.acceptBtnText} maxFontSizeMultiplier={1.4}>{t('x_legal_disclaimer_i_understand_accept')}</Text>
            }
          </TouchableOpacity>
        </View>
      )}

      {!scrolledToBottom && (
        <View style={s.scrollHint}>
          <Text style={s.scrollHintText} maxFontSizeMultiplier={1.4}>{t('x_legal_disclaimer_scroll_read_accept')}</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:             { flex: 1, backgroundColor: COLORS.navy },
  header:           { paddingHorizontal: 20, paddingTop: 52, paddingBottom: 16, backgroundColor: COLORS.navy },
  headerTitle:      { fontSize: 22, fontWeight: '800', color: COLORS.white, marginBottom: 6 },
  headerSub:        { fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 18 },
  scroll:           { flex: 1, backgroundColor: COLORS.bg },
  scrollContent:    { padding: 20, paddingBottom: 40 },
  section:          { backgroundColor: COLORS.white, borderRadius: 12, padding: 16, marginBottom: 12,
                       shadowColor: COLORS.textPrimary, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  sectionHeader:    { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  sectionIcon:      { fontSize: 20, marginRight: 10 },
  sectionTitle:     { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  sectionBody:      { fontSize: 14, color: COLORS.textSecond, lineHeight: 21 },
  formalBlock:      { backgroundColor: COLORS.warnBg, borderRadius: 12, padding: 16, borderWidth: 1.5, borderColor: COLORS.steelMid },
  formalText:       { fontSize: 13, color: COLORS.warnDark, lineHeight: 20 },
  formalVersion:    { fontSize: 11, color: COLORS.warnDark, marginTop: 8 },
  link:             { color: COLORS.blue, textDecorationLine: 'underline' },
  footer:           { backgroundColor: COLORS.white, padding: 16, paddingBottom: 32,
                       borderTopWidth: 1, borderTopColor: COLORS.border },
  checkRow:         { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  checkbox:         { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: COLORS.navy,
                       marginRight: 12, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxChecked:  { backgroundColor: COLORS.navy },
  checkmark:        { color: COLORS.textOnNavy, fontSize: 14, fontWeight: '800' }, // design-audit-ignore: rendered only when checked (navy fill)
  checkLabel:       { flex: 1, fontSize: 13, color: COLORS.textSecond, lineHeight: 19 },
  acceptBtn:        { backgroundColor: COLORS.navy, paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
  acceptBtnDisabled:{ opacity: 0.45 },
  acceptBtnText:    { color: COLORS.white, fontSize: 15, fontWeight: '800' },
  scrollHint:       { backgroundColor: COLORS.navy, padding: 10, alignItems: 'center' },
  scrollHintText:   { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600' },
});
export default React.memo(LegalDisclaimerScreen);