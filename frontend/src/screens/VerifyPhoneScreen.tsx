/**
 * VerifyPhoneScreen — prove your phone number with a 6-digit code by text (security fix,
 * migration 40). A bail agent's check-in enrollment (and the "Your bail agent" card) is linked to
 * an account only through a VERIFIED phone number, never by an e-mail or a number typed into a
 * profile.
 *
 * API: GET /api/me/phone, POST /api/me/phone/verify { phone }, POST /api/me/phone/confirm { code }.
 * Codes expire after 10 minutes; 5 wrong tries end a code. Without text messages on the server
 * the screen says so and sends nothing.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { useToast } from '../components/ToastProvider';
import { FONTS, RADIUS, useTheme } from '../constants/theme';
import { getToken } from '../utils/secureStorage';
import { SignInNeeded } from '../components/SignInNeeded';
import { t, useLang } from '../i18n';
import { IconLabel, ICONS } from '../components/AppIcon';

interface PhoneStatus {
  phone: string | null; phone_verified: boolean; verified_at: string | null; sms_available: boolean;
  pending: { phone_masked: string; expires_at: string } | null;
}

export default function VerifyPhoneScreen({ navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { showToast } = useToast();
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const [phase, setPhase] = useState<'loading' | 'ok' | 'error' | 'signed_out'>('loading');
  const [st, setSt] = useState<PhoneStatus | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    if (!(await getToken().catch(() => null))) { if (mounted.current) setPhase('signed_out'); return; }
    try {
      const r = await api.get<PhoneStatus>('/me/phone');
      if (!mounted.current) return;
      setSt(r.data); setPhase('ok');
      if (r.data.phone && !phone) setPhone(r.data.phone);
      if (r.data.pending) setSentTo(r.data.pending.phone_masked);
    } catch { if (mounted.current) setPhase('error'); }
  }, [phone]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.post<{ phone_masked: string }>('/me/phone/verify', { phone: phone.trim() });
      setSentTo(r.data.phone_masked); setCode('');
      showToast(t('vp_sent', { phone: r.data.phone_masked }), 'success');
    } catch (e) { setErr(apiErrorMessage(e, t('vp_send_failed'))); }
    finally { if (mounted.current) setBusy(false); }
  };
  const confirm = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.post<{ linked: number }>('/me/phone/confirm', { code: code.trim() });
      showToast(r.data.linked > 0 ? t('vp_verified_linked', { n: r.data.linked }) : t('vp_verified'), 'success');
      setSentTo(null); setCode('');
      await load();
    } catch (e) { setErr(apiErrorMessage(e, t('vp_confirm_failed'))); }
    finally { if (mounted.current) setBusy(false); }
  };

  if (phase === 'loading') return <View style={s.screen}><ActivityIndicator style={{ marginTop: 40 }} color={colors.textBrand} accessibilityLabel={t('loading')} /></View>;
  if (phase === 'signed_out') return <View style={s.screen} testID="verify-phone-screen"><SignInNeeded navigation={navigation} body={t('vp_sign_in')} onSignedIn={load} /></View>;
  if (phase === 'error' || !st) {
    return (
      <View style={[s.screen, s.pad]} testID="verify-phone-screen">
        <Text maxFontSizeMultiplier={1.4} style={s.text}>{t('vp_load_failed')}</Text>
        <TouchableOpacity accessibilityRole="button" style={s.secondary} onPress={load}><Text style={s.secondaryText}>{t('try_again')}</Text></TouchableOpacity>
      </View>
    );
  }
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled" testID="verify-phone-screen">
      <Text maxFontSizeMultiplier={1.3} style={s.title} accessibilityRole="header">{t('vp_title')}</Text>
      <Text maxFontSizeMultiplier={1.4} style={s.text}>{t('vp_why')}</Text>
      {st.phone_verified && (
        <View style={s.okBox} testID="verify-phone-done">
          <IconLabel icon={ICONS.statusOk} color={colors.textPrimary} textStyle={s.strong}>{t('vp_is_verified', { phone: st.phone || '' })}</IconLabel>
        </View>
      )}
      {!st.sms_available ? (
        <Text maxFontSizeMultiplier={1.4} style={s.warn} testID="verify-phone-no-sms">{t('vp_no_sms')}</Text>
      ) : (
        <>
          <Text maxFontSizeMultiplier={1.4} style={s.label}>{t('vp_phone_label')}</Text>
          <TextInput accessibilityLabel={t('vp_phone_label')} testID="verify-phone-input" style={s.input} value={phone} onChangeText={setPhone}
            keyboardType="phone-pad" placeholder="(615) 555-0123" placeholderTextColor={colors.textMuted} maxLength={20} />
          <Text maxFontSizeMultiplier={1.4} style={s.small}>{t('vp_consent')}</Text>
          <TouchableOpacity accessibilityRole="button" testID="verify-phone-send" style={s.primary} disabled={busy || !phone.trim()} onPress={send}>
            <Text maxFontSizeMultiplier={1.3} style={s.primaryText}>{sentTo ? t('vp_send_again') : t('vp_send')}</Text>
          </TouchableOpacity>
          {!!sentTo && (
            <View testID="verify-phone-code-box">
              <Text maxFontSizeMultiplier={1.4} style={s.label}>{t('vp_code_label', { phone: sentTo })}</Text>
              <TextInput accessibilityLabel={t('vp_code_a11y')} testID="verify-phone-code" style={s.input} value={code} onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad" maxLength={6} placeholder="123456" placeholderTextColor={colors.textMuted} />
              <TouchableOpacity accessibilityRole="button" testID="verify-phone-confirm" style={s.primary} disabled={busy || code.length !== 6} onPress={confirm}>
                <Text maxFontSizeMultiplier={1.3} style={s.primaryText}>{t('vp_confirm')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
      {!!err && <Text maxFontSizeMultiplier={1.4} style={s.error} testID="verify-phone-error">{err}</Text>}
    </ScrollView>
  );
}

const makeStyles = (c: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  pad: { padding: 16, paddingBottom: 48 },
  title: { color: c.textPrimary, fontSize: 22, ...FONTS.black, marginBottom: 8 },
  text: { color: c.textSecond, fontSize: 15, lineHeight: 22 },
  strong: { color: c.textPrimary, fontSize: 15, ...FONTS.semiBold },
  small: { color: c.textMuted, fontSize: 12, lineHeight: 17, marginTop: 6 },
  label: { color: c.textPrimary, fontSize: 14, ...FONTS.semiBold, marginTop: 16, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: RADIUS.md, padding: 12, fontSize: 17, color: c.textPrimary, backgroundColor: c.bgCard },
  primary: { backgroundColor: c.navy, borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  primaryText: { color: c.textOnNavy, fontSize: 15, ...FONTS.black },
  secondary: { borderWidth: 1, borderColor: c.border, borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  secondaryText: { color: c.textPrimary, fontSize: 15, ...FONTS.semiBold },
  okBox: { backgroundColor: c.bgCard, borderRadius: RADIUS.md, borderWidth: 1, borderColor: c.border, padding: 12, marginTop: 12 },
  warn: { color: c.warnDark, fontSize: 14, marginTop: 12 },
  error: { color: c.emergencyDark, fontSize: 14, marginTop: 12 },
});
