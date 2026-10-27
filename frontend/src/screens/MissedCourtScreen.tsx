/**
 * MissedCourtScreen — the page the morning-after text links to
 * (https://justicegavel.app/missed-court[/es|/pt|/vi|/ht|/zh|/ar|/tl]): "If you missed court, act today",
 * then the app's existing missed-court guidance (services/courtDayGuidance.js on the server,
 * bundled here as cg_missed_*), with its sources. Works signed out, browsing or signed in —
 * the person may have only a text from their bail agent, no account.
 * The language in the link switches the app's language for this visit only.
 */
import React, { useEffect } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { useTheme } from '../constants/theme';
import { getLang, isLang, setLang, t, useLang } from '../i18n';
import { GuidanceView, makeStyles, pickGuidance } from './CourtDatesScreen';

function MissedCourtScreen({ navigation, route }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const want = String((route?.params as { lang?: string } | undefined)?.lang || '').toLowerCase();
  useEffect(() => {
    if (isLang(want) && want !== getLang()) setLang(want, { persist: false });
  }, [want]);
  const g = pickGuidance(null);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scroll} testID="missed-court-screen">
      <Text maxFontSizeMultiplier={1.3} style={styles.title} accessibilityRole="header">{t('cg_missed_title')}</Text>
      <View style={[styles.box, { borderColor: colors.danger }]} testID="missed-court-act-today">
        <Text maxFontSizeMultiplier={1.4} style={styles.boxStrong}>{t('mc_act_today')}</Text>
      </View>
      <GuidanceView g={g} which="missed" styles={styles} />
      {navigation?.canGoBack?.() && (
        <TouchableOpacity accessibilityRole="button" testID="missed-court-back" style={styles.secondaryBtn} onPress={() => navigation.goBack()}>
          <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{t('back')}</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

export default React.memo(MissedCourtScreen);
