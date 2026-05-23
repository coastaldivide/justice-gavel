import React, { useRef, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setContacts, getContacts } from '../services/storage';
import {  useTheme, COLORS } from '../constants/theme';

interface Contact { value: string; label: string; }

export default function ContactsScreen(): React.JSX.Element {
  const [submitting, setSubmitting] = React.useState(false);
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const [contacts, setLocalContacts] = useState<Contact[]>([
    { value: '', label: 'Contact 1' },
    { value: '', label: 'Contact 2' },
    { value: '', label: 'Contact 3' },
  ]);
  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  useEffect(() => {
    (async () => {
      const stored = await getContacts() as string[];
      setLocalContacts([
        { value: stored[0] || '', label: 'Contact 1' },
        { value: stored[1] || '', label: 'Contact 2' },
        { value: stored[2] || '', label: 'Contact 3' },
      ]);
      const userData = await AsyncStorage.getItem('user');
      if (userData) {
        const user = (() => { try { return JSON.parse(userData); } catch { return null; } })();
        setDisplayName(user.displayName || user.name || '');
      }
    })();
  }, []);

  const updateContact = (idx: number, val: string) => {
    setLocalContacts(prev => prev.map((c, i) => i === idx ? { ...c, value: val } : c));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    const values = contacts.map(c => c.value?.trim() || '');
    await setContacts(values);
    setSaving(false);
    setSaved(true);
    Alert.alert('Saved', 'Your emergency contacts have been saved.');
  };

  const typeHint = (val: string) => {
    if (!val) return '';
    if (val.includes('@')) return '📧 Email';
    if (/\d{7,}/.test(val.replace(/\D/g, ''))) return '📱 Phone';
    return '';
  };

  return (
    <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}>
        <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

      <View style={styles.infoCard}>
        <Text maxFontSizeMultiplier={1.4} style={styles.infoIcon}>ℹ️</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.infoText}>
          When you tap SOS, these contacts receive an alert with your GPS location. Enter phone numbers or email addresses.
        </Text>
      </View>

      <Text maxFontSizeMultiplier={1.4} style={[styles.sectionLabel, { color: colors.textMuted }]}>Your name (shown in alerts)</Text>
      <View style={[styles.inputWrap, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <Text maxFontSizeMultiplier={1.4} style={styles.inputIcon}>👤</Text>
        <TextInput
          style={[styles.input, { color: colors.textPrimary }]}
          placeholder="e.g. Jamie Smith"
          placeholderTextColor={colors.textMuted}
          value={displayName}
          onChangeText={v => { setDisplayName(v); setSaved(false); }}
          textContentType="name"

          returnKeyType="next"
          blurOnSubmit
        />
      </View>

      <Text maxFontSizeMultiplier={1.4} style={[styles.sectionLabel, { color: colors.textMuted }]}>Emergency contacts</Text>
      <Text maxFontSizeMultiplier={1.4} style={[styles.sectionHint, { color: colors.textMuted }]}>Enter a phone number (e.g. 615-555-0100) or email address</Text>

      {contacts.map((c, i) => (
        <View key={i} style={styles.contactRow}>
          <View style={[styles.inputWrap, { flex: 1, marginBottom: 0, backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.numBadge}>{i + 1}</Text>
            <TextInput
              style={[styles.input, { color: colors.textPrimary }]}
              placeholder={`Contact ${i + 1} phone or email`}
              placeholderTextColor={colors.textMuted}
              value={c.value}
              onChangeText={v => updateContact(i, v)}
              keyboardType={c.value.includes('@') ? 'email-address' : 'default'}
              autoCapitalize="none"
            />
          </View>
          {!!typeHint(c.value) && <Text maxFontSizeMultiplier={1.4} style={styles.typeHint}>{typeHint(c.value)}</Text>}
        </View>
      ))}
      <TouchableOpacity activeOpacity={0.6} style={[styles.saveBtn, saving && styles.saveBtnDisabled]} onPress={save} disabled={saving}
        accessibilityRole="button"
      >
        {saving ? <ActivityIndicator color={colors.bgCard} /> : <Text maxFontSizeMultiplier={1.4} style={styles.saveBtnText}>{saved ? '✓ Saved' : 'Save contacts'}</Text>}
      </TouchableOpacity>

      <View style={[styles.tipsCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.tipsTitle, { color: colors.textPrimary }]}>Tips</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.tipItem, { color: colors.textSecond }]}>• Phone numbers receive an SMS text with your location link</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.tipItem, { color: colors.textSecond }]}>• Email addresses receive a detailed alert email</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.tipItem, { color: colors.textSecond }]}>• Tell your contacts about Justice Gavel so they know what to expect</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.tipItem, { color: colors.textSecond }]}>• Make sure contacts 1 and 2 are people who can act quickly</Text>
      </View>

      {/* Empty state */}
      {contacts?.length === 0 && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 }}>
          <Text style={{ fontSize: 40 }}>👥</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, fontWeight: '600', color: colors?.textPrimary || colors.bg, textAlign: 'center' }}>No contacts saved</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: colors?.textMuted || colors.steel, textAlign: 'center', lineHeight: 20 }}>Add attorneys, bondsmen, or family members you want quick access to.</Text>
        </View>
      )}
      </ScrollView>
      </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40 },
  infoCard: { backgroundColor: COLORS.bgSubtle, borderRadius: 14, padding: 16, flexDirection: 'row', gap: 8, marginBottom: 20, borderWidth: 1, borderColor: '#85B7EB' },
  infoIcon: { fontSize: 18, marginTop: 1 },
  infoText: { flex: 1, fontSize: 12, color: '#042C53', lineHeight: 19 },
  sectionLabel: { fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6, marginTop: 8 },
  sectionHint: { fontSize: 12, marginBottom: 10 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, marginBottom: 10 },
  inputIcon: { fontSize: 16, lineHeight: 24, marginRight: 8 },
  input: { flex: 1, paddingVertical: 13, fontSize: 15,
    lineHeight: 22, },
  numBadge: { width: 22, height: 22, borderRadius: 12, backgroundColor: '#042C53', color: COLORS.bgCard, textAlign: 'center', lineHeight: 22, fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginRight: 10 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  typeHint: { fontSize: 11, color: colors.blue, fontFamily: 'Inter_600SemiBold', fontWeight: '600', minWidth: 70 },
  saveBtn: { backgroundColor: '#042C53', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 12, marginBottom: 20 },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: COLORS.bgCard, fontSize: 16, lineHeight: 24, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  tipsCard: { borderRadius: 14, padding: 16, borderWidth: 1 },
  tipsTitle: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginBottom: 8 },
  tipItem: { fontSize: 12, lineHeight: 20 },
});
