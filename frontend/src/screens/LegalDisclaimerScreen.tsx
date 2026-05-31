import { GradientHeader } from '../components/GradientHeader';
import { AppIcon } from '../components/AppIcon';
import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { COLORS } from '../constants/theme';
import { api } from '../services/api';

const VERSION = '2026-01-01.1';

const DISCLAIMER_SECTIONS = [
  {
    icon: '⚖️',
    title: 'Not Legal Advice',
    body: 'Justice Gavel is a legal information platform. Nothing on this app — including AI chat, motion drafts, signal alerts, or research — constitutes legal advice. It does not create an attorney-client relationship.',
  },
  {
    icon: '🤖',
    title: 'AI-Generated Content',
    body: 'AI outputs may be incomplete, inaccurate, or outdated. Laws change. Jurisdictions differ. Always verify AI-generated information with a licensed attorney before acting on it.',
  },
  {
    icon: '🔒',
    title: 'Your Data',
    body: 'Your case information is private and not sold to third parties. Attorney-client communications on the attorney platform are handled in compliance with professional responsibility rules. See our Privacy Policy for full details.',
  },
  {
    icon: '🚨',
    title: 'Emergencies',
    body: 'If you or someone else is in immediate physical danger, call 911. If you are experiencing a mental health crisis, call 988 (Suicide & Crisis Lifeline). Do not rely on this app in life-threatening situations.',
  },
  {
    icon: '⚠️',
    title: 'No Guarantees',
    body: 'Legal outcomes depend on facts, jurisdiction, the judge, opposing counsel, and many factors outside our control. Nothing on this platform guarantees any legal result. Justice Gavel, Inc. is not liable for outcomes based on platform content.',
  },
];

interface Props {
  onAccepted: () => void;
}

export default function LegalDisclaimerScreen({ onAccepted }: Props) {
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const handleScroll = (e: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const isBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 40;
    if (isBottom) setScrolledToBottom(true);
  };

  const handleAccept = async () => {
    if (!agreed) {
      Alert.alert('Please confirm', 'You must check the confirmation box to continue.');
      return;
    }
    setAccepting(true);
    try {
      await api.post('/auth/disclaimer/accept', { version: VERSION });
      onAccepted();
    } catch {
      Alert.alert('Error', 'Could not record your acceptance. Please check your connection and try again.');
    } finally {
      setAccepting(false);
    }
  };

  return (
    <View style={s.root}>
      {/* Header — always visible, non-scrollable */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Before You Continue</Text>
        <Text style={s.headerSub}>
          Please read our legal notice carefully.{'\n'}
          Scroll to the bottom to accept.
        </Text>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        onScroll={handleScroll}
        scrollEventThrottle={100}
      >
        {DISCLAIMER_SECTIONS.map((sec, i) => (
          <View key={i} style={s.section}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionIcon}>{sec.icon}</Text>
              <Text style={s.sectionTitle}>{sec.title}</Text>
            </View>
            <Text style={s.sectionBody}>{sec.body}</Text>
          </View>
        ))}

        {/* Formal acceptance text */}
        <View style={s.formalBlock}>
          <Text style={s.formalText}>
            By tapping "I Understand and Accept," you acknowledge that you have read
            this notice, understand that Justice Gavel does not provide legal advice,
            and agree to our{' '}
            <Text style={s.link}>Terms of Service</Text> and{' '}
            <Text style={s.link}>Privacy Policy</Text>.
          </Text>
          <Text style={s.formalVersion}>Version {VERSION}</Text>
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
              {agreed && <Text style={s.checkmark}>✓</Text>}
            </View>
            <Text style={s.checkLabel}>
              I have read and understand this notice. I am not seeking legal advice.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            style={[s.acceptBtn, (!agreed || accepting) && s.acceptBtnDisabled]}
            onPress={handleAccept}
            disabled={!agreed || accepting}
          >
            {accepting
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.acceptBtnText}>I Understand and Accept</Text>
            }
          </TouchableOpacity>
        </View>
      )}

      {!scrolledToBottom && (
        <View style={s.scrollHint}>
          <Text style={s.scrollHintText}>↓ Scroll to read and accept</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:             { flex: 1, backgroundColor: '#0d1b2a' },
  header:           { paddingHorizontal: 20, paddingTop: 52, paddingBottom: 16, backgroundColor: '#0d1b2a' },
  headerTitle:      { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 6 },
  headerSub:        { fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 18 },
  scroll:           { flex: 1, backgroundColor: '#f8fafc' },
  scrollContent:    { padding: 20, paddingBottom: 40 },
  section:          { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12,
                       shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  sectionHeader:    { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  sectionIcon:      { fontSize: 20, marginRight: 10 },
  sectionTitle:     { fontSize: 15, fontWeight: '700', color: '#1a1a2e' },
  sectionBody:      { fontSize: 14, color: '#374151', lineHeight: 21 },
  formalBlock:      { backgroundColor: '#fffbeb', borderRadius: 12, padding: 16, borderWidth: 1.5, borderColor: '#f59e0b' },
  formalText:       { fontSize: 13, color: '#78350f', lineHeight: 20 },
  formalVersion:    { fontSize: 11, color: '#92400e', marginTop: 8 },
  link:             { color: '#1d4ed8', textDecorationLine: 'underline' },
  footer:           { backgroundColor: '#fff', padding: 16, paddingBottom: 32,
                       borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  checkRow:         { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  checkbox:         { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: COLORS.navy,
                       marginRight: 12, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxChecked:  { backgroundColor: COLORS.navy },
  checkmark:        { color: '#fff', fontSize: 14, fontWeight: '800' },
  checkLabel:       { flex: 1, fontSize: 13, color: '#374151', lineHeight: 19 },
  acceptBtn:        { backgroundColor: COLORS.navy, paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
  acceptBtnDisabled:{ opacity: 0.45 },
  acceptBtnText:    { color: '#fff', fontSize: 15, fontWeight: '800' },
  scrollHint:       { backgroundColor: COLORS.navy, padding: 10, alignItems: 'center' },
  scrollHintText:   { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600' },
});
