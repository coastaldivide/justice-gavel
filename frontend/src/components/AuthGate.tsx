/**
 * AuthGate — Intercepts actions that require a signed-in account.
 * Shows a bottom-sheet prompt to sign in or create an account.
 * Used by all payment screens to gracefully convert browsing users.
 *
 * Usage:
 *   const { requireAuth, AuthGateModal } = useAuthGate(navigation);
 *   ...
 *   <TouchableOpacity onPress={() => requireAuth(() => doPayment())}
           accessibilityRole="button">
          accessibilityLabel='Sign in or create account'
          accessibilityRole='button'
 *   <AuthGateModal />
 */
import React, { useState, useCallback } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
  TextInput, ActivityIndicator,
} from 'react-native';
import { api, apiErrorMessage } from '../services/api';
import { setAppAuth } from '../services/auth';
import { COLORS, FONTS, RADIUS, SHADOW, themeColors, useTheme, type ThemeColors } from '../constants/theme';
import { getToken, setToken, setItem as setSecureItem } from '../utils/secureStorage';
import { t } from '../i18n';

export function useAuthGate(navigation: any, quickMode = false) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [visible, setVisible]     = useState(false);
  const [pendingFn, setPendingFn] = useState<(() => void) | null>(null);

  // Quick signup state (phone + PIN)
  const [phone, setPhone]         = useState('');
  const [pin, setPin]             = useState('');
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError]     = useState('');
  const [showQuickForm, setShowQuickForm] = useState(false);

  const requireAuth = useCallback(async (fn: () => void) => {
    const token = await getToken();
    if (token) {
      fn();
    } else {
      setPendingFn(() => fn);
      setShowQuickForm(quickMode); // quick mode shows inline form
      setVisible(true);
    }
  }, [quickMode]);

  const goToLogin = () => {
    setVisible(false);
    navigation.navigate('MoreTab', { screen: 'Login' });
  };

  const goToRegister = () => {
    setVisible(false);
    navigation.navigate('MoreTab', { screen: 'Register' });
  };

  // Quick phone+PIN signup — fewer fields = fewer drops
  const doQuickSignup = async () => {
    if (!phone.trim() || phone.replace(/\D/g,'').length < 10) {
      setSignupError(t('x_auth_gate_enter_valid_phone_number')); return;
    }
    if (pin.length < 4) {
      setSignupError(t('x_auth_gate_enter_4_digit_pin')); return;
    }
    setSignupLoading(true);
    setSignupError('');
    try {
      const res = await api.post('/auth/register', {
        identifier: phone.trim(),
        password: pin + pin, // double PIN as password (6+ chars)
        displayName: undefined,
      });
      if (!res.data?.token) throw new Error('Unexpected response from the server. Please try again.');
      await setToken(res.data.token);
      try { await setSecureItem('user', JSON.stringify(res.data?.user)); } catch {} // storage failure is non-fatal
      setAppAuth('authed');
      setVisible(false);
      // Execute the pending action
      if (pendingFn) setTimeout(() => pendingFn(), 300);
    } catch (e: unknown) {
      setSignupError(apiErrorMessage(e, t('x_auth_gate_could_not_create_account')));
    } finally {
      setSignupLoading(false);
    }
  };

  const AuthGateModal = () => (
    <Modal visible={visible} transparent animationType="slide">
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setVisible(false)}
                accessibilityRole="button"
              >
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <View style={styles.handle} />

          {showQuickForm ? (
            // ── Quick signup: phone + PIN only ──────────────────────────
            <>
              <Text style={styles.title}>{t('x_auth_gate_quick_sign_up')}</Text>
              <Text style={styles.body}>
                {t('x_auth_gate_phone_number_4_digit')}
              </Text>

              <TextInput
                style={styles.quickInput}
                placeholder={t('x_auth_gate_phone_number')}
                placeholderTextColor={themeColors().textLight}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoFocus
              />
              <TextInput
                style={styles.quickInput}
                placeholder={t('x_auth_gate_4_digit_pin')}
                placeholderTextColor={themeColors().textLight}
                value={pin}
                onChangeText={tItem => setPin(tItem.replace(/\D/g,'').slice(0,4))}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={4}
              />

              {!!signupError && <Text style={styles.quickError}>{signupError}</Text>}
              <TouchableOpacity
                style={[styles.primaryBtn, signupLoading && { opacity: 0.6 }]}
                onPress={doQuickSignup}
                disabled={signupLoading}
              
          accessibilityRole="button">
                {signupLoading
                  ? <ActivityIndicator color={COLORS.white} size="small" />
                  : <Text style={styles.primaryBtnText}>{t('x_auth_gate_create_account_pay')}</Text>
                }
              </TouchableOpacity>

              <TouchableOpacity style={styles.switchLink} onPress={() => setShowQuickForm(false)}
                        accessibilityRole="button"
                      >
                <Text style={styles.switchLinkText}>{t('x_auth_gate_use_email_instead')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            // ── Standard auth gate ───────────────────────────────────────
            <>
              <Text style={styles.title}>{t('x_auth_gate_sign_continue')}</Text>
              <Text style={styles.body}>
                {t('x_auth_gate_free_account_required_takes')}
              </Text>

              <TouchableOpacity style={styles.primaryBtn} onPress={goToRegister} activeOpacity={0.85}
          accessibilityRole="button"
        >
                <Text style={styles.primaryBtnText}>{t('x_auth_gate_create_free_account')}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.secondaryBtn} onPress={goToLogin} activeOpacity={0.85}
          accessibilityRole="button"
        >
                <Text style={styles.secondaryBtnText}>{t('x_auth_gate_already_have_account_sign')}</Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity style={styles.cancelBtn} onPress={() => setVisible(false)}
                    accessibilityRole="button"
                  >
            <Text style={styles.cancelText}>{t('case_cancel')}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );

  return { requireAuth, AuthGateModal };
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bgCard,
    borderTopLeftRadius: RADIUS.xxl, borderTopRightRadius: RADIUS.xxl,
    padding: 28, paddingBottom: 44,
    ...SHADOW.lg,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center', marginBottom: 20,
  },
  title: { fontSize: 22, ...FONTS.black, color: colors.textBrand, marginBottom: 8, textAlign: 'center' },
  body:  { fontSize: 14, ...FONTS.medium, color: colors.textSecond, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  primaryBtn: {
    backgroundColor: colors.navy, borderRadius: RADIUS.lg,
    paddingVertical: 15, alignItems: 'center', marginBottom: 10,
    ...SHADOW.sm,
  },
  primaryBtnText: { color: colors.white, fontSize: 16, lineHeight: 24, ...FONTS.black },
  secondaryBtn: {
    borderWidth: 1.5, borderColor: colors.navy, borderRadius: RADIUS.lg,
    paddingVertical: 13, alignItems: 'center', marginBottom: 10,
  },
  secondaryBtnText: { color: colors.textBrand, fontSize: 14, lineHeight: 21, ...FONTS.bold },
  quickInput: {
    backgroundColor: colors.bg,
    borderWidth: 1.5, borderColor: colors.border,
    borderRadius: RADIUS.md, paddingHorizontal: 14,
    paddingVertical: 13, fontSize: 16, lineHeight: 24, color: colors.textPrimary,
    marginBottom: 10,
  },
  quickError: { color: colors.emergency, fontSize: 13, lineHeight: 20, marginBottom: 8, textAlign: 'center' },
  switchLink: { alignItems: 'center', paddingVertical: 8 },
  switchLinkText: { fontSize: 13, lineHeight: 20, color: colors.textPrimary, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  cancelBtn: { alignItems: 'center', paddingVertical: 8 },
  cancelText: { fontSize: 14, lineHeight: 21, color: colors.textMuted },
});

// Memoize the modal component to prevent re-renders from hook callers
// AuthGateModal is a hook-scoped component, accessed via useAuthGate() return value
// useAuthGate is already exported from its function declaration
