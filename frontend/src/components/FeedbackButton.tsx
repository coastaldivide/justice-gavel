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

interface Props {
  screen: string;   // current screen name for logging
}

export default function FeedbackButton({ screen }: Props) {
  const [visible, setVisible]     = useState(false);
  const [issue, setIssue]         = useState('');
  const [contact, setContact]     = useState('');
  const [loading, setLoading]     = useState(false);
  const { showToast } = useToast();

  // Only show in development / beta builds
  if (!__DEV__ && process.env.EXPO_PUBLIC_BETA !== 'true') return null;

  const submit = async () => {
    if (!issue.trim()) { showToast('Please describe the issue before submitting.', 'warning'); return; }
    setLoading(true);
    try {
      await api.post('/feedback/ui', { screen, issue: issue.trim(), contact: contact.trim() });
      showToast('Thank you — feedback received!', 'success');
      setIssue(''); setContact(''); setVisible(false);
    } catch {
      showToast('Could not submit. Please try again.', 'error');
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
        accessibilityLabel="Submit feedback about this screen"
        accessibilityHint="Opens feedback form for beta testers"
      >
        <Text style={styles.fabText}>?</Text>
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <Text maxFontSizeMultiplier={1.3} style={styles.title}>Beta Feedback</Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.subtitle}>Screen: {screen}</Text>

            <TextInput
              style={styles.input}
              value={issue}
              onChangeText={setIssue}
              placeholder="What went wrong or felt confusing?"
              multiline
              numberOfLines={4}
              maxLength={2000}
              textAlignVertical="top"
              accessibilityLabel="Describe the issue"
            />
            <TextInput
              style={[styles.input, { height: 44 }]}
              value={contact}
              onChangeText={setContact}
              placeholder="Your email or phone (optional)"
              keyboardType="email-address"
              maxLength={200}
              accessibilityLabel="Contact information (optional)"
            />

            <View style={styles.buttons}>
              <TouchableOpacity
                style={styles.cancel}
                onPress={() => setVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Cancel feedback"
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submit, loading && { opacity: 0.6 }]}
                onPress={submit}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel="Submit feedback"
              >
                {loading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.submitText}>Send Feedback</Text>
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
                borderRadius: 22, backgroundColor: '#042C53', alignItems: 'center',
                justifyContent: 'center', zIndex: 999, elevation: 4 },
  fabText:    { color: '#fff', fontSize: 22, fontWeight: '700', lineHeight: 24 },
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal:      { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
                padding: 24, paddingBottom: 40 },
  title:      { fontSize: 18, fontWeight: '700', color: '#042C53', marginBottom: 4 },
  subtitle:   { fontSize: 12, color: '#9ca3af', marginBottom: 16 },
  input:      { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 12,
                fontSize: 14, minHeight: 100, marginBottom: 12 },
  buttons:    { flexDirection: 'row', gap: 12 },
  cancel:     { flex: 1, padding: 14, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db',
                alignItems: 'center' },
  cancelText: { fontSize: 15, color: '#374151' },
  submit:     { flex: 2, padding: 14, borderRadius: 8, backgroundColor: '#042C53',
                alignItems: 'center' },
  submitText: { fontSize: 15, color: '#fff', fontWeight: '700' },
});
