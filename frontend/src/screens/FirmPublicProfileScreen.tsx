import { useHaptics } from '../hooks/useHaptics';
import { useToast } from '../components/ToastProvider';
/**
 * FirmPublicProfileScreen.tsx — Public-facing firm profile for clients
 * Navigated to from FirmDiscoveryScreen when user taps a firm card.
 * Shows firm details, attorneys, practice areas, and contact options.
 */
import React, { useState, useEffect, useCallback} from 'react';
import {
  View, Text, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator,
  Linking, StyleSheet, LayoutAnimation} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { api } from '../services/api';
import { t } from '../i18n';
import { useTheme } from '../constants/theme';

type RouteParams = { firmId: number; firmName?: string };

interface Attorney { id: number; display_name: string; firm_role: string; }
interface FirmProfile {
  id: number; name: string; city: string; state: string;
  practice_areas: string; accepting_clients: boolean;
  free_consultation: boolean; website: string; phone: string;
  description: string; referral_code: string; attorneys: Attorney[];
}

function FirmPublicProfileScreen() {
  const { impact, success, error: hapticError } = useHaptics();
  const { showToast } = useToast();
  const navigation = useNavigation<any>();
  const route      = useRoute<RouteProp<Record<string, RouteParams>, string>>();
  const { colors } = useTheme();
  const { firmId, firmName } = route.params;

  const [firm, setFirm]       = useState<FirmProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    navigation.setOptions({ title: firmName || 'Firm Profile' });
    api.get(`/firms/${firmId}/public-profile`)
      .then(r => setFirm(r.data))
      .catch(() => setError('Could not load firm profile. Please try again.'))
      .finally(() => setLoading(false));
  }, [firmId]);

  const callFirm = () => {
    if (!firm?.phone) { showToast('No phone number listed'); return; }
    Linking.openURL(`tel:${firm.phone}`).catch(() => showToast('Could not open phone'));
  };

  const openWebsite = () => {
    if (!firm?.website) { showToast('No website listed'); return; }
    const url = firm.website.startsWith('http') ? firm.website : `https://${firm.website}`;
    Linking.openURL(url).catch(() => showToast('Could not open website'));
  };

  const contactFirm = () => {
    navigation.navigate('LawyersTab');  // Opens the Lawyers tab to find attorneys
  };

  if (loading) return (
    <View style={[s.center, { backgroundColor: colors.primary }]}>
      <ActivityIndicator color={colors.blue} />
    </View>
  );

  if (error || !firm) return (
    <View style={[s.center, { backgroundColor: colors.primary }]}>
      <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textPrimary, fontSize: 16, textAlign: 'center', padding: 24 }}>
        {error || 'Firm not found'}
      </Text>
      <TouchableOpacity
        onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityRole="button"
          accessibilityHint="Double-tap to activate"
        accessibilityLabel="Go back to firm directory"
        style={[s.btn, { backgroundColor: colors.blue }]}
      >
        <Text style={s.btnText}>Go Back</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: colors.primary }}
                contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>

      {/* Header */}
      <View style={[s.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <Text maxFontSizeMultiplier={1.3} style={[s.firmName, { color: colors.textPrimary }]}>
          {firm.name}
        </Text>
        {(firm.city || firm.state) && (
          <Text maxFontSizeMultiplier={1.3} style={[s.location, { color: colors.textMuted }]}>
            📍 {[firm.city, firm.state].filter(Boolean).join(', ')}
          </Text>
        )}
        <View style={s.badges}>
          {firm.accepting_clients && (
            <View style={[s.badge, { backgroundColor: '#E1F5EE' }]}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#0F6E56' }}>● Accepting clients</Text>
            </View>
          )}
          {firm.free_consultation && (
            <View style={[s.badge, { backgroundColor: '#E6F1FB' }]}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.blue }}>Free consultation</Text>
            </View>
          )}
        </View>
      </View>

      {/* Description */}
      {!!firm.description && (
        <View style={[s.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <Text maxFontSizeMultiplier={1.3} style={[s.sectionTitle, { color: colors.textMuted }]}>About</Text>
          <Text maxFontSizeMultiplier={1.3} style={[s.body, { color: colors.textPrimary }]}>{firm.description}</Text>
        </View>
      )}

      {/* Practice Areas */}
      {!!firm.practice_areas && (
        <View style={[s.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <Text maxFontSizeMultiplier={1.3} style={[s.sectionTitle, { color: colors.textMuted }]}>Practice Areas</Text>
          <Text maxFontSizeMultiplier={1.3} style={[s.body, { color: colors.textPrimary }]}>{firm.practice_areas}</Text>
        </View>
      )}

      {/* Attorneys */}
      {firm.attorneys?.length > 0 && (
        <View style={[s.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <Text maxFontSizeMultiplier={1.3} style={[s.sectionTitle, { color: colors.textMuted }]}>Attorneys</Text>
          {firm.attorneys.map(att => (
            <View key={att.id} style={s.attRow}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>{(att.display_name || 'A')[0].toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={1.3} style={[s.attName, { color: colors.textPrimary }]}>{att.display_name}</Text>
                <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, color: colors.textMuted }}>
                  {att.firm_role?.replace('_', ' ') || 'Attorney'}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Referral code */}
      {!!firm.referral_code && (
        <View style={[s.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <Text maxFontSizeMultiplier={1.3} style={[s.sectionTitle, { color: colors.textMuted }]}>Referral Code</Text>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 24, fontWeight: '800', color: colors.textPrimary, letterSpacing: 2 }}>
            {firm.referral_code}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>
            Share this code with clients so they can find your firm directly.
          </Text>
        </View>
      )}

      {/* Contact actions */}
      <View style={s.actions}>
        {firm.phone && (
          <TouchableOpacity
            style={[s.btn, { backgroundColor: '#0d7a3e', flex: 1 }]}
            onPress={callFirm}
            accessibilityRole="button"
          accessibilityHint="Double-tap to activate"
            accessibilityLabel={`Call ${firm.name}`}
          >
            <Text style={s.btnText}>📞 Call</Text>
          </TouchableOpacity>
        )}
        {firm.website && (
          <TouchableOpacity
            style={[s.btn, { backgroundColor: colors.blue, flex: 1 }]}
            onPress={openWebsite}
            accessibilityRole="button"
          accessibilityHint="Double-tap to activate"
            accessibilityLabel={`Visit ${firm.name} website`}
          >
            <Text style={s.btnText}>🌐 Website</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[s.btn, { backgroundColor: COLORS.navy, flex: 1 }]}
          onPress={contactFirm}
          accessibilityRole="button"
          accessibilityHint="Double-tap to activate"
          accessibilityLabel={`Find attorneys at ${firm.name}`}
        >
          <Text style={s.btnText}>Find Attorneys</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card:        { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12 },
  firmName:    { fontSize: 22, fontWeight: '800', marginBottom: 6 },
  location:    { fontSize: 14, marginBottom: 10 },
  badges:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge:       { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 },
  sectionTitle:{ fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  body:        { fontSize: 14, lineHeight: 21 },
  attRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8,
                 borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.08)' },
  avatar:      { width: 36, height: 36, borderRadius: 18, backgroundColor: '#E6F1FB',
                 alignItems: 'center', justifyContent: 'center' },
  avatarText:  { fontSize: 15, fontWeight: '700', color: COLORS.blue },
  attName:     { fontSize: 14, fontWeight: '600' },
  actions:     { flexDirection: 'row', gap: 10, marginTop: 8 },
  btn:         { paddingVertical: 14, paddingHorizontal: 12, borderRadius: 10,
                 alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  btnText:     { color: colors.bg, fontWeight: '700', fontSize: 14 },
});
export default React.memo(FirmPublicProfileScreen);
