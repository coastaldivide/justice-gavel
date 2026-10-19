import { useToast } from '../components/ToastProvider';
import { AppIcon } from '../components/AppIcon';
import React, { useRef, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, LayoutAnimation} from 'react-native';
import { setContacts, getContacts, getUserName, setUserName } from '../services/storage';
import {  useTheme, COLORS } from '../constants/theme';
import { t, useLang } from '../i18n';

interface Contact { value: string; label: string; }

function ContactsScreen(): React.JSX.Element {
  useLang();
  const { showToast } = useToast();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const mountedRef = useRef(true);
  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); return () => { mountedRef.current = false; }; }, []);

  const [contacts, setLocalContacts] = useState<Contact[]>([
    { value: '', label: t('x_contacts_contact_1') },
    { value: '', label: t('x_contacts_contact_2') },
    { value: '', label: t('x_contacts_contact_3') },
  ]);
  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  useEffect(() => {
    (async () => {
      const stored = await getContacts() as string[];
      setLocalContacts([
        { value: stored[0] || '', label: t('x_contacts_contact_1') },
        { value: stored[1] || '', label: t('x_contacts_contact_2') },
        { value: stored[2] || '', label: t('x_contacts_contact_3') },
      ]);
      setDisplayName(await getUserName());
    })();
  }, []);

  const removeContact = (i: number) => {
    if (contacts.length <= 1) { setLocalContacts([{ value: '', label: '' }]); }
    else { setLocalContacts(prev => prev.filter((_, idx) => idx !== i)); }
  };

  const updateContact = (idx: number, val: string) => {
    setLocalContacts(prev => prev.map((c, i) => i === idx ? { ...c, value: val } : c));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    const values = contacts.map(c => c.value?.trim() || '');
    await setContacts(values);
    await setUserName(displayName);
    setSaving(false);
    setSaved(true);
    showToast(t('x_contacts_emergency_contacts_have_been'));
  };

  const typeHint = (val: string) => {
    if (!val) return '';
    if (val.includes('@')) return t('x_contacts_email');
    if (/\d{7,}/.test(val.replace(/\D/g, ''))) return t('x_contacts_phone');
    return '';
  };

  return (
    <KeyboardAvoidingView
      testID="contacts-screen"
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}>
        <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

      <View style={styles.infoCard}>
        <Text maxFontSizeMultiplier={1.4} style={styles.infoIcon}>ℹ️</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.infoText}>
          {t('x_contacts_when_tap_sos_these')}
        </Text>
      </View>

      <Text maxFontSizeMultiplier={1.4} style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('x_contacts_name_shown_alerts')}</Text>
      <View style={[styles.inputWrap, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <AppIcon name="person-outline" size={20} color={COLORS.navy} />
        <TextInput
          accessibilityLabel={t('x_contacts_e_g_jamie_smith')}
          style={[styles.input, { color: colors.textPrimary }]}
          placeholder={t('x_contacts_e_g_jamie_smith')}
          placeholderTextColor={colors.textMuted}
          value={displayName}
          onChangeText={v => { setDisplayName(v); setSaved(false); }}
          textContentType="name"

          returnKeyType="next"
          blurOnSubmit
        />
      </View>

      <Text maxFontSizeMultiplier={1.4} style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('x_contacts_emergency_contacts')}</Text>
      <Text maxFontSizeMultiplier={1.4} style={[styles.sectionHint, { color: colors.textMuted }]}>{t('x_contacts_enter_phone_number_email')}</Text>

      {contacts.map((c, i) => (
        <View key={`row-${i}`} style={styles.contactRow}>
          <View style={[styles.inputWrap, { flex: 1, marginBottom: 0, backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.numBadge}>{i + 1}</Text>
            <TextInput
              style={[styles.input, { color: colors.textPrimary }]}
              placeholder={t('x_contacts_contact_phone_email', { value: i + 1 })}
              placeholderTextColor={colors.textMuted}
              value={c.value}
              onChangeText={v => updateContact(i, v)}
              keyboardType={c.value.includes('@') ? 'email-address' : 'default'}
              autoCapitalize="none"
            />
          </View>
          <TouchableOpacity
            accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
            accessibilityLabel={t('x_contacts_remove_contact', { value: i + 1 })}
            onPress={() => removeContact(i)}
            style={{ padding: 8 }}
          >
            <Text style={{ color: colors.emergency, fontSize: 18, fontWeight: '700' }}>✕</Text>
          </TouchableOpacity>
          {!!typeHint(c.value) && <Text maxFontSizeMultiplier={1.4} style={styles.typeHint}>{typeHint(c.value)}</Text>}
        </View>
      ))}
      <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} activeOpacity={0.6} style={[styles.saveBtn, saving && styles.saveBtnDisabled]} onPress={save} disabled={saving}
       accessibilityLabel={saved ? t('x_attorney_dashboard_saved') : t('x_contacts_save_contacts')}>
        {saving ? <ActivityIndicator color={colors.bgCard} /> : <Text maxFontSizeMultiplier={1.4} style={styles.saveBtnText}>{saved ? t('x_attorney_dashboard_saved') : t('x_contacts_save_contacts')}</Text>}
      </TouchableOpacity>

      <View style={[styles.tipsCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.tipsTitle, { color: colors.textPrimary }]}>{t('x_contacts_tips')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.tipItem, { color: colors.textSecond }]}>{t('x_contacts_phone_numbers_receive_sms')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.tipItem, { color: colors.textSecond }]}>{t('x_contacts_email_addresses_receive_detailed')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.tipItem, { color: colors.textSecond }]}>{t('x_contacts_tell_contacts_about_justice')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.tipItem, { color: colors.textSecond }]}>{t('x_contacts_make_sure_contacts_1')}</Text>
      </View>

      {/* Empty state */}
      {contacts?.length === 0 && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 }}>
          <Text style={{ fontSize: 40 }}>👥</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, fontWeight: '600', color: colors?.textPrimary || colors.bg, textAlign: 'center' }}>{t('x_contacts_no_contacts_saved')}</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: colors?.textMuted || colors.steel, textAlign: 'center', lineHeight: 20 }}>{t('x_contacts_add_attorneys_bondsmen_family')}</Text>
        </View>
      )}
      </ScrollView>
      </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40 },
  infoCard: { backgroundColor: COLORS.bgSubtle, borderRadius: 14, padding: 16, flexDirection: 'row', gap: 8, marginBottom: 20, borderWidth: 1, borderColor: COLORS.steel },
  infoIcon: { fontSize: 18, marginTop: 1 },
  infoText: { flex: 1, fontSize: 12, color: COLORS.navy, lineHeight: 19 },
  sectionLabel: { fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6, marginTop: 8 },
  sectionHint: { fontSize: 12, marginBottom: 10 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, marginBottom: 10 },
  inputIcon: { fontSize: 16, lineHeight: 24, marginRight: 8 },
  input: { flex: 1, paddingVertical: 13, fontSize: 15,
    lineHeight: 22, },
  numBadge: { width: 22, height: 22, borderRadius: 12, backgroundColor: COLORS.navy, color: COLORS.bgCard, textAlign: 'center', lineHeight: 22, fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginRight: 10 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  typeHint: { fontSize: 11, color: colors.textBrand, fontFamily: 'Inter_600SemiBold', fontWeight: '600', minWidth: 70 },
  saveBtn: { backgroundColor: COLORS.navy, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 12, marginBottom: 20 },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: COLORS.bgCard, fontSize: 16, lineHeight: 24, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  tipsCard: { borderRadius: 14, padding: 16, borderWidth: 1 },
  tipsTitle: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginBottom: 8 },
  tipItem: { fontSize: 12, lineHeight: 20 },
});
export default React.memo(ContactsScreen);
