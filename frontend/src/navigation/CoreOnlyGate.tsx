/**
 * CoreOnlyGate — stack `screenLayout` that keeps consumers on the core path.
 *
 * A parked screen (constants/features.ts PARKED_SCREENS), or a professional
 * screen opened by a non-professional account, shows a short "not available"
 * card with a way back to the core path instead of the screen. Screens stay
 * registered, so deep links and old notifications never crash.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { t, useLang } from '../i18n';
import { useTheme, FONTS } from '../constants/theme';
import { AppIcon, ICONS } from '../components/AppIcon';
import * as secureStorage from '../utils/secureStorage';
import { CORE_ONLY, PARKED_SCREENS, PRO_SCREENS, isScreenEnabled } from '../constants/features';

/** The signed-in account's role from the stored profile ('' signed out); null while loading. */
export function useAccountRole(): string | null {
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    secureStorage.getItem('user').then((u) => {
      let r = '';
      try { r = String((u ? JSON.parse(u) : null)?.role || ''); } catch { r = ''; }
      if (live) setRole(r);
    }).catch(() => { if (live) setRole(''); });
    return () => { live = false; };
  }, []);
  return role;
}

export function CoreUnavailable({ screen }: { screen: string }) {
  useLang();
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const pro = PRO_SCREENS.has(screen);
  return (
    <View style={[styles.wrap, { backgroundColor: colors.bg }]} testID="core-unavailable">
      <AppIcon name={ICONS.construction} size={36} color={colors.textBrand} />
      <Text maxFontSizeMultiplier={1.4} style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
        {t(pro ? 'core_pro_only_title' : 'core_unavailable_title')}
      </Text>
      <Text maxFontSizeMultiplier={1.5} style={[styles.body, { color: colors.textMuted }]}>
        {t(pro ? 'core_pro_only_body' : 'core_unavailable_body')}
      </Text>
      <TouchableOpacity accessibilityRole="button" testID="core-unavailable-home"
        style={[styles.btn, { backgroundColor: colors.textBrand }]}
        onPress={() => navigation.navigate('MoreTab', { screen: 'JustArrested' })}>
        <Text maxFontSizeMultiplier={1.3} style={[styles.btnText, { color: colors.bg }]}>{t('core_unavailable_cta')}</Text>
      </TouchableOpacity>
    </View>
  );
}

export function CoreOnlyGate({ screen, children }: { screen: string; children: React.ReactNode }) {
  const needsRole = CORE_ONLY && PRO_SCREENS.has(screen);
  const role = useAccountRole();
  if (!CORE_ONLY) return <>{children}</>;
  if (PARKED_SCREENS.has(screen)) return <CoreUnavailable screen={screen} />;
  if (needsRole && role === null) return <View style={{ flex: 1 }} />; // profile still loading
  if (!isScreenEnabled(screen, role)) return <CoreUnavailable screen={screen} />;
  return <>{children}</>;
}

const styles = StyleSheet.create({
  wrap:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  title:   { ...FONTS.black, fontSize: 20, textAlign: 'center' },
  body:    { fontSize: 15, lineHeight: 21, textAlign: 'center', maxWidth: 420 },
  btn:     { marginTop: 8, paddingVertical: 14, paddingHorizontal: 22, borderRadius: 12, minHeight: 48, justifyContent: 'center' },
  btnText: { ...FONTS.bold, fontSize: 16 },
});
