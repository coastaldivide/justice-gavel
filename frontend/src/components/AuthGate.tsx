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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { setAppAuth } from '../services/auth';
import { COLORS, FONTS, RADIUS, SHADOW } from '../constants/theme';
import { getToken, setToken } from '../utils/secureStorage';

export function useAuthGate(navigation: any, quickMode = false) {
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
    navigation.navigate('GuestNav', { screen: 'Login' });
  };

  const goToRegister = () => {
    setVisible(false);
    navigation.navigate('GuestNav', { screen: 'Register' });
  };

  // Quick phone+PIN signup — fewer fields = fewer drops
  const doQuickSignup = async () => {
    if (!phone.trim() || phone.replace(/\D/g,'').length < 10) {
      setSignupError('Enter a valid phone number'); return;
    }
    if (pin.length < 4) {
      setSignupError('Enter a 4-digit PIN'); return;
    }
    setSignupLoading(true);
    setSignupError('');
    try {
      const res = await api.post('/auth/register', {
        identifier: phone.trim(),
        password: pin + pin, // double PIN as password (6+ chars)
        displayName: undefined,
      });
      await setToken(res.data.token);
      try { await AsyncStorage.setItem('user', JSON.stringify(res.data.user)); } catch {} // storage failure is non-fatal
      setAppAuth('authed');
      setVisible(false);
      // Execute the pending action
      if (pendingFn) setTimeout(() => pendingFn(), 300);
    } catch (e: unknown) {
      setSignupError((e as any).response?.data?.error || 'Could not create account. Try again.');
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
              <Text style={styles.title}>Quick Sign Up</Text>
              <Text style={styles.body}>
                Phone number + 4-digit PIN.{'\n'}
                Takes 10 seconds. Then pay.
              </Text>

              <TextInput
                style={styles.quickInput}
                placeholder="Phone number"
                placeholderTextColor={COLORS.textLight}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoFocus
              />
              <TextInput
                style={styles.quickInput}
                placeholder="4-digit PIN"
                placeholderTextColor={COLORS.textLight}
                value={pin}
                onChangeText={t => setPin(t.replace(/\D/g,'').slice(0,4))}
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
                  ? <ActivityIndicator color='#FFFFFF' size="small" />
                  : <Text style={styles.primaryBtnText}>Create Account & Pay</Text>
                }
              </TouchableOpacity>

              <TouchableOpacity style={styles.switchLink} onPress={() => setShowQuickForm(false)}
                        accessibilityRole="button"
                      >
                <Text style={styles.switchLinkText}>Use email instead →</Text>
              </TouchableOpacity>
            </>
          ) : (
            // ── Standard auth gate ───────────────────────────────────────
            <>
              <Text style={styles.title}>Sign in to continue</Text>
              <Text style={styles.body}>
                A free account is required.{'\n'}
                Takes under 30 seconds.
              </Text>

              <TouchableOpacity style={styles.primaryBtn} onPress={goToRegister} activeOpacity={0.85}
          accessibilityRole="button"
        >
                <Text style={styles.primaryBtnText}>Create Free Account</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.secondaryBtn} onPress={goToLogin} activeOpacity={0.85}
          accessibilityRole="button"
        >
                <Text style={styles.secondaryBtnText}>Already have an account? Sign in</Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity style={styles.cancelBtn} onPress={() => setVisible(false)}
                    accessibilityRole="button"
                  >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );

  return { requireAuth, AuthGateModal };
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: RADIUS.xxl, borderTopRightRadius: RADIUS.xxl,
    padding: 28, paddingBottom: 44,
    ...SHADOW.lg,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center', marginBottom: 20,
  },
  title: { fontSize: 22, ...FONTS.black, color: COLORS.navy, marginBottom: 8, textAlign: 'center' },
  body:  { fontSize: 14, ...FONTS.medium, color: COLORS.textSecond, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  primaryBtn: {
    backgroundColor: COLORS.navy, borderRadius: RADIUS.lg,
    paddingVertical: 15, alignItems: 'center', marginBottom: 10,
    ...SHADOW.sm,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, lineHeight: 24, ...FONTS.black },
  secondaryBtn: {
    borderWidth: 1.5, borderColor: COLORS.navy, borderRadius: RADIUS.lg,
    paddingVertical: 13, alignItems: 'center', marginBottom: 10,
  },
  secondaryBtnText: { color: COLORS.navy, fontSize: 14, lineHeight: 21, ...FONTS.bold },
  quickInput: {
    backgroundColor: COLORS.bg,
    borderWidth: 1.5, borderColor: COLORS.border,
    borderRadius: RADIUS.md, paddingHorizontal: 14,
    paddingVertical: 13, fontSize: 16, lineHeight: 24, color: COLORS.textPrimary,
    marginBottom: 10,
  },
  quickError: { color: COLORS.emergency, fontSize: 13, lineHeight: 20, marginBottom: 8, textAlign: 'center' },
  switchLink: { alignItems: 'center', paddingVertical: 8 },
  switchLinkText: { fontSize: 13, lineHeight: 20, color: COLORS.steelDark, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  cancelBtn: { alignItems: 'center', paddingVertical: 8 },
  cancelText: { fontSize: 14, lineHeight: 21, color: COLORS.textMuted },
});

// Memoize the modal component to prevent re-renders from hook callers
// AuthGateModal is a hook-scoped component, accessed via useAuthGate() return value
// useAuthGate is already exported from its function declaration
