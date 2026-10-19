/**
 * FeedbackButton.tsx — Floating beta feedback button
 * Shows in beta/dev mode on every screen.
 * Taps open a 2-field modal: "What went wrong?" + optional contact.
 */
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, TextInput,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { api } from '../services/api';
import { useToast } from './Toast';
import { COLORS } from '../constants/theme';
import { t, useLang } from '../i18n';

interface Props {
  screen: string;   // current screen name for logging
}

export default function FeedbackButton({ screen }: Props) {
  useLang();
  const [visible, setVisible]     = useState(false);
  const [issue, setIssue]         = useState('');
  const [contact, setContact]     = useState('');
  const [loading, setLoading]     = useState(false);
  const { showToast } = useToast();

  // Only show in development / beta builds
  if (!__DEV__ && process.env.EXPO_PUBLIC_BETA !== 'true') return null;

  const submit = async () => {
    if (!issue.trim()) { showToast(t('x_feedback_button_please_describe_issue_before'), 'warning'); return; }
    setLoading(true);
    try {
      await api.post('/feedback/ui', { screen, issue: issue.trim(), contact: contact.trim() });
      showToast(t('x_feedback_button_thank_feedback_received'), 'success');
      setIssue(''); setContact(''); setVisible(false);
    } catch {
      showToast(t('x_feedback_button_could_not_submit_please'), 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setVisible(true)}
        accessibilityRole="button"
        accessibilityLabel={t('x_feedback_button_submit_feedback_about_this')}
        accessibilityHint={t('x_feedback_button_opens_feedback_form_beta')}
      >
        <Text style={styles.fabText}>?</Text>
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <Text maxFontSizeMultiplier={1.3} style={styles.title}>{t('x_feedback_button_beta_feedback')}</Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.subtitle}>{t('x_feedback_button_screen', { screen })}</Text>

            <TextInput
              style={styles.input}
              value={issue}
              onChangeText={setIssue}
              placeholder={t('x_feedback_button_what_went_wrong_felt')}
              multiline
              numberOfLines={4}
              maxLength={2000}
              textAlignVertical="top"
              accessibilityLabel={t('x_feedback_button_describe_issue')}
            />
            <TextInput
              style={[styles.input, { height: 44 }]}
              value={contact}
              onChangeText={setContact}
              placeholder={t('x_feedback_button_email_phone_optional')}
              keyboardType="email-address"
              maxLength={200}
              accessibilityLabel={t('x_feedback_button_contact_information_optional')}
            />

            <View style={styles.buttons}>
              <TouchableOpacity
                style={styles.cancel}
                onPress={() => setVisible(false)}
                accessibilityRole="button"
                accessibilityLabel={t('x_feedback_button_cancel_feedback')}
              >
                <Text style={styles.cancelText}>{t('case_cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submit, loading && { opacity: 0.6 }]}
                onPress={submit}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel={t('x_feedback_button_submit_feedback')}
              >
                {loading
                  ? <ActivityIndicator color={COLORS.white} size="small" />
                  : <Text style={styles.submitText}>{t('x_feedback_button_send_feedback')}</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab:        { position: 'absolute', bottom: 80, right: 16, width: 44, height: 44,
                borderRadius: 22, backgroundColor: COLORS.navy, alignItems: 'center',
                justifyContent: 'center', zIndex: 999, elevation: 4 },
  fabText:    { color: COLORS.white, fontSize: 22, fontWeight: '700', lineHeight: 24 },
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal:      { backgroundColor: COLORS.white, borderTopLeftRadius: 20, borderTopRightRadius: 20,
                padding: 24, paddingBottom: 40 },
  title:      { fontSize: 18, fontWeight: '700', color: COLORS.navy, marginBottom: 4 },
  subtitle:   { fontSize: 12, color: COLORS.textSecond, marginBottom: 16 },
  input:      { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 12,
                fontSize: 14, minHeight: 100, marginBottom: 12 },
  buttons:    { flexDirection: 'row', gap: 12 },
  cancel:     { flex: 1, padding: 14, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border,
                alignItems: 'center' },
  cancelText: { fontSize: 15, color: COLORS.textSecond },
  submit:     { flex: 2, padding: 14, borderRadius: 8, backgroundColor: COLORS.navy,
                alignItems: 'center' },
  submitText: { fontSize: 15, color: COLORS.white, fontWeight: '700' },
});
