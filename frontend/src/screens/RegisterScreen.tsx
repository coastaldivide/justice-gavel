
import React, { useState, useRef } from 'react';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api, apiErrorMessage } from '../services/api';
import { startSession, type AccountType } from '../services/session';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';
import JTBLogo from '../components/JTBLogo';
import { isValidIdentifier } from '../utils/identifier';
import { t, useLang } from '../i18n';
import { IconLabel, ICONS } from '../components/AppIcon';

const ACCOUNT_TYPES: { type: AccountType; labelKey: string; a11yKey: string }[] = [
  { type: 'consumer',   labelKey: 'x_rg_i_need_legal_help', a11yKey: 'x_rg_defendant_family_member_account' },
  { type: 'attorney',   labelKey: 'x_rg_i_am_attorney',     a11yKey: 'x_rg_attorney_account' },
  { type: 'bail_agent', labelKey: 'rg_i_am_bail_agent',     a11yKey: 'rg_bail_agent_account' },
];

function RegisterScreen({ navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [identifier, setIdentifier]   = useState('');
  const [password, setPassword]       = useState('');
  const [displayName, setDisplayName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('consumer');
  const isAttorney = accountType === 'attorney';
  const [barNumber, setBarNumber]   = useState('');
  const [barState, setBarState]     = useState('');
  const [firmName, setFirmName]     = useState('');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [showPass, setShowPass]       = useState(false);
  const passRef = useRef<TextInput>(null);
  const nameRef = useRef<TextInput>(null);

  const normalizedIdentifier = (() => {
    const trimmed = identifier.trim();
    const digits = trimmed.replace(/\D/g, '');
    // Normalize 10-digit US phone to E.164
    if (digits.length === 10 && !trimmed.includes('@')) return '+1' + digits;
    if (digits.length === 11 && digits.startsWith('1') && !trimmed.includes('@')) return '+' + digits;
    return trimmed;
  })();

  const onRegister = async () => {
if (loading) return;
    if (!normalizedIdentifier) { setError(t('x_rg_enter_email_phone_number')); return; }
    if (!isValidIdentifier(normalizedIdentifier)) { setError(t('rg_identifier_invalid')); return; }
    if (!password || password.length < 8) { setError(t('x_rg_password_must_be_at')); return; }
    setError(''); setLoading(true);
    try {
      const res = await api.post('/auth/register', {
        identifier: normalizedIdentifier, password,
        displayName: displayName.trim() || undefined,
        accountType,
        isAttorney,
        barNumber: isAttorney ? barNumber : undefined,
        barState: isAttorney ? barState : undefined,
        firmName: isAttorney ? firmName : undefined,
      });
      if (!res.data?.token) throw new Error(t('x_rg_registration_failed_please_try'));
      const inApp = !!navigation.getParent()?.getState()?.routeNames?.includes('HomeTab');
      await startSession(res.data);
      // Schedule D7 re-engagement push (fires only if user stays free)
      api.post('/push/d7-reengage').catch(() => undefined);
      // Opened from inside the app: leave the form (the guest flow swaps navigators
      // itself). App.tsx then opens the account's home screen (after the Terms gate).
      if (inApp) {
        if (navigation.canGoBack()) navigation.goBack();
        else navigation.navigate('HomeTab');
      }
    } catch (e: unknown) {
      setError(apiErrorMessage(e, t('x_rg_registration_failed_please_try')));
    } finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView testID="register-screen" style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        <View style={styles.logoSection}>
          <View style={styles.logoWrap}>
            <JTBLogo size={72} />
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.wordmark}>{t('create_account')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.tagline}>{t('x_rg_free_use_legal_help')}</Text>
        </View>

        <View style={styles.form}>
          <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('x_lg_email_phone_number')}</Text>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              placeholder={t('x_lg_email_phone_number_2')}
              placeholderTextColor={COLORS.textSecond}
              value={identifier}
              onChangeText={(v) => { setIdentifier(v); setError(''); }}

          maxLength={254}
              autoCapitalize="none"
          testID="register-email-input" accessibilityLabel={t('x_lg_email_address_phone_number')} autoComplete="email"
          importantForAutofill="yes" keyboardType={identifier.includes("@") || (!identifier.match(/^[0-9]/) && identifier.length > 0) ? "email-address" : "phone-pad"}
              textContentType="username" returnKeyType="next"
              onSubmitEditing={() => passRef.current?.focus()}
              selectionColor={COLORS.steel}
            />
          </View>

          <Text maxFontSizeMultiplier={1.4} style={[styles.label, { marginTop: 16 }]}>{t('password')}</Text>
          <View style={styles.inputWrap}>
            <TextInput
              ref={passRef}
              style={[styles.input, { flex: 1 }]}
              placeholder={t('x_rg_at_least_8_characters')}
              placeholderTextColor={COLORS.textSecond}
              testID="register-password-input" accessibilityLabel={t('password')} secureTextEntry={!showPass}
              value={password}
              onChangeText={v => { setPassword(v); setError(''); }}
              textContentType="newPassword" returnKeyType="next"
              onSubmitEditing={() => nameRef.current?.focus()}
              selectionColor={COLORS.steel}
            />
            <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} accessibilityLabel={showPass ? t('x_lg_hide_password') : t('x_lg_show_password')} onPress={() => setShowPass(s => !s)}
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.showBtnText}>{showPass ? t('x_lg_hide') : t('x_lg_show')}</Text>
            </TouchableOpacity>
          </View>

{/* ── Account type selector ────────────────────────────────── */}
      <Text maxFontSizeMultiplier={1.4} style={[styles.label, { marginTop: 16 }]}>{t('rg_account_type')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12, gap: 8 }}>
        {ACCOUNT_TYPES.map(opt => {
          const on = accountType === opt.type;
          return (
            <TouchableOpacity
              key={opt.type}
              testID={`register-type-${opt.type}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, checked: on }}
              accessibilityLabel={t(opt.a11yKey)}
              onPress={() => setAccountType(opt.type)}
              style={{
                flexGrow: 1, flexBasis: '30%', minWidth: 96, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
                backgroundColor: on ? colors.navy : 'transparent',
                borderWidth: 1, borderColor: on ? colors.navy : colors.border,
              }}
            >
              <Text maxFontSizeMultiplier={1.3} style={{ color: on ? colors.white : COLORS.textSecond, fontWeight: '700', fontSize: 13, textAlign: 'center' }}>
                {t(opt.labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {accountType === 'bail_agent' && (
        <Text testID="register-bail-hint" maxFontSizeMultiplier={1.4} style={{ color: COLORS.textMuted, fontSize: 12, lineHeight: 18, marginBottom: 8 }}>
          {t('rg_bail_agent_hint')}
        </Text>
      )}
      {/* ── Attorney-only fields ─────────────────────────────────── */}
      {isAttorney && (
        <View style={{ gap: 8, marginBottom: 8 }}>
          <TextInput
            accessibilityLabel={t('hn_bar_number')}
            placeholder={t('x_rg_bar_number_optional')}
            value={barNumber}
            onChangeText={setBarNumber}
            autoCapitalize="characters"
            placeholderTextColor={COLORS.textSecond}
            style={styles.proInput}
          />
          <TextInput
            accessibilityLabel={t('x_rg_state_bar_e_g')}
            placeholder={t('x_rg_state_bar_e_g')}
            value={barState}
            onChangeText={tItem => setBarState(tItem.toUpperCase().slice(0,2))}
            maxLength={2}
            autoCapitalize="characters"
            placeholderTextColor={COLORS.textSecond}
            style={styles.proInput}
          />
          <TextInput
            accessibilityLabel={t('x_firm_acquisition_firm_name')}
            placeholder={t('x_rg_firm_name_optional')}
            value={firmName}
            onChangeText={setFirmName}
            placeholderTextColor={COLORS.textSecond}
            style={styles.proInput}
          />
        </View>
      )}

          <Text maxFontSizeMultiplier={1.4} style={[styles.label, { marginTop: 16 }]}>
            {t('settings.display_name')}{' '}<Text maxFontSizeMultiplier={1.4} style={styles.optional}>{t('x_check_in_optional')}</Text>
          </Text>
          <View style={styles.inputWrap}>
                  <TextInput
              ref={nameRef}
              style={styles.input}
              placeholder={t('x_rg_how_should_we_address')}
              placeholderTextColor={COLORS.textSecond}
              value={displayName} onChangeText={setDisplayName}
              textContentType="name" returnKeyType="done"
              onSubmitEditing={onRegister}
              selectionColor={COLORS.steel}
        maxLength={200}
            />
          </View>

          {!!error && (
            <View testID="register-error-message" style={styles.errorBox}>
              <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={styles.errorText} maxFontSizeMultiplier={1.4}>{error}</IconLabel>
            </View>
          )}
          <TouchableOpacity
            accessibilityRole="button"

            accessibilityLabel={t('create_account')}
          accessibilityHint={t('x_rg_creates_new_justice_gavel')}
            style={[styles.primaryBtn, loading && styles.btnDisabled]}
            testID="register-submit-button" onPress={onRegister} disabled={loading} activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color={colors.bgCard} />
              : <Text maxFontSizeMultiplier={1.4} style={styles.primaryBtnText}>{t('create_account')}</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={styles.loginLink}
            onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('HomeTab')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.loginText}>
              {t('onboard_signin')}{' '}
              <Text maxFontSizeMultiplier={1.4} style={styles.loginHighlight}>{t('ja_sign_in')}</Text>
            </Text>
          </TouchableOpacity>
        
    </View>

        <Text maxFontSizeMultiplier={1.4} style={styles.privacy}>
          {t('x_rg_by_creating_account_agree')}{' '}
            <Text maxFontSizeMultiplier={1.4}
              style={{ color: colors.textBrand, textDecorationLine: 'underline' }}
              onPress={() => navigation.navigate('TermsOfService')}
            >{t('onb_terms_tos')}</Text>{t('x_rg_we_never_sell_data')}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, paddingHorizontal: 28, paddingBottom: 40 },
  logoSection: { alignItems: 'center', paddingTop: Platform.OS === 'ios' ? 56 : 44, paddingBottom: 24 },
  logoWrap: {
    width: 76, height: 76, borderRadius: RADIUS.lg, overflow: 'hidden',
    marginBottom: 14, shadowColor: COLORS.steel, shadowOpacity: 0.25,
    shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 10,
  },
  wordmark: { fontSize: 28, ...FONTS.black, color: colors.textPrimary, letterSpacing: 0.5, marginBottom: 4 },
  tagline: { fontSize: 12, ...FONTS.medium, color: colors.info },
  form: {
    backgroundColor: COLORS.bgCard, borderRadius: RADIUS.xxl,
    padding: 24, borderWidth: 1, borderColor: COLORS.border, ...SHADOW.lg,
  },
  label: { fontSize: 12, ...FONTS.bold, color: COLORS.textMuted, marginBottom: 8, letterSpacing: 0.5, textTransform: 'uppercase' },
  optional: { ...FONTS.reg, color: COLORS.textSecond, textTransform: 'none' },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: RADIUS.md, borderWidth: 1.5, borderColor: COLORS.border,
    paddingHorizontal: 16,
  },
  input: { flex: 1, paddingVertical: 16, fontSize: 15, lineHeight: 22, color: COLORS.bgCard, ...FONTS.medium },
  proInput: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, padding: 12, fontSize: 15, color: COLORS.bgCard, backgroundColor: 'rgba(255,255,255,0.05)' },
  showBtn: { paddingLeft: 10, paddingVertical: 6 },
  showBtnText: { fontSize: 12, lineHeight: 20, color: COLORS.info, ...FONTS.semi },
  errorBox: {
    backgroundColor: 'rgba(183,28,28,0.15)', borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: 'rgba(183,28,28,0.3)', padding: 12, marginTop: 12,
  },
  errorText: { color: COLORS.textPrimary, fontSize: 12, lineHeight: 20, ...FONTS.medium },
  primaryBtn: {
    backgroundColor: COLORS.navy, borderRadius: RADIUS.lg, paddingVertical: 16,
    alignItems: 'center', marginTop: 24,
    borderWidth: 1, borderColor: COLORS.steel, ...SHADOW.md,
  },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: COLORS.bgCard, fontSize: 16, lineHeight: 24, ...FONTS.black, letterSpacing: 0.5 },
  loginLink: { alignItems: 'center', marginTop: 16 },
  loginText: { fontSize: 14, lineHeight: 21, color: COLORS.textMuted },
  loginHighlight: { color: COLORS.info, ...FONTS.bold },
  privacy: { textAlign: 'center', color: colors.textMuted, fontSize: 11, marginTop: 24, lineHeight: 18 },
});

// Module-level fallback for helper components
export default React.memo(RegisterScreen);