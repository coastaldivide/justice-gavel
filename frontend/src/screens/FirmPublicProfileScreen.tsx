import { useTheme, type ThemeColors } from '../constants/theme';
/**
 * FirmPublicProfileScreen.tsx — Public-facing firm profile for clients
 * Navigated to from FirmDiscoveryScreen when user taps a firm card.
 * Shows firm details, attorneys, practice areas, and contact options.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { api, apiErrorMessage } from '../services/api';
import { ContactActions } from '../components/ContactActions';
import { t, useLang } from '../i18n';
import { IconLabel, ICONS } from '../components/AppIcon';

type RouteParams = { firmId: number; firmName?: string };

interface Attorney { id: number; display_name: string; firm_role: string; }
interface FirmProfile {
  id: number; name: string; city: string; state: string;
  practice_areas: string; accepting_clients: boolean;
  free_consultation: boolean; website: string; phone: string;
  description: string; attorneys: Attorney[];
}

function FirmPublicProfileScreen() {
  useLang();
  const navigation = useNavigation<any>();
  const route      = useRoute<RouteProp<Record<string, RouteParams>, string>>();
  const { colors } = useTheme();
  const s = makeS(colors);
  const { firmId, firmName } = route.params ?? ({} as Partial<RouteParams>);

  const [firm, setFirm]       = useState<FirmProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: firmName || t('x_nav_firm_profile') });
  }, [navigation, firmName]);

  const loadFirm = useCallback(async () => {
    if (!firmId) { setLoading(false); return; }
    try {
      const r = await api.get(`/firms/${firmId}/public-profile`);
      setFirm(r.data);
      setError('');
    } catch (e) {
      setError(apiErrorMessage(e, t('x_firm_public_profile_could_not_load_firm')));
    } finally {
      setLoading(false);
    }
  }, [firmId]);

  useEffect(() => { loadFirm(); }, [loadFirm]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadFirm();
    setRefreshing(false);
  }, [loadFirm]);

  if (loading) return (
    <View style={[s.center, { backgroundColor: colors.bg }]}>
      <ActivityIndicator color={colors.info} />
    </View>
  );

  if (error || !firm) return (
    <View style={[s.center, { backgroundColor: colors.bg }]}>
      <Text testID="firm-profile-error" maxFontSizeMultiplier={1.3} style={{ color: colors.textPrimary, fontSize: 16, textAlign: 'center', padding: 24 }}>
        {error || t('x_firm_public_profile_firm_not_found')}
      </Text>
      <TouchableOpacity
        onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
        accessibilityLabel={t('x_firm_public_profile_go_back_firm_directory')}
        style={[s.btn, { backgroundColor: colors.blue }]}
      >
        <Text style={s.btnText}>{t('x_firm_public_profile_go_back')}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: colors.bg }}
                contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textPrimary} />}>

      {/* Header */}
      <View style={[s.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <Text maxFontSizeMultiplier={1.3} style={[s.firmName, { color: colors.textPrimary }]}>
          {firm.name}
        </Text>
        {(firm.city || firm.state) && (
          <IconLabel icon={ICONS.location} textStyle={[s.location, { color: colors.textMuted }]} maxFontSizeMultiplier={1.3}>{[firm.city, firm.state].filter(Boolean).join(', ')}</IconLabel>
        )}
        <View style={s.badges}>
          {firm.accepting_clients && (
            <View style={[s.badge, { backgroundColor: colors.legalBg }]}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: colors.legal }}>{t('x_firm_discovery_accepting_clients')}</Text>
            </View>
          )}
          {firm.free_consultation && (
            <View style={[s.badge, { backgroundColor: colors.infoBg }]}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textBrand }}>{t('hn_free_consult')}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Description */}
      {!!firm.description && (
        <View style={[s.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <Text maxFontSizeMultiplier={1.3} style={[s.sectionTitle, { color: colors.textMuted }]}>{t('x_firm_public_profile_about')}</Text>
          <Text maxFontSizeMultiplier={1.3} style={[s.body, { color: colors.textPrimary }]}>{firm.description}</Text>
        </View>
      )}

      {/* Practice Areas */}
      {!!firm.practice_areas && (
        <View style={[s.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <Text maxFontSizeMultiplier={1.3} style={[s.sectionTitle, { color: colors.textMuted }]}>{t('x_firm_public_profile_practice_areas')}</Text>
          <Text maxFontSizeMultiplier={1.3} style={[s.body, { color: colors.textPrimary }]}>{firm.practice_areas}</Text>
        </View>
      )}

      {/* Attorneys */}
      {firm.attorneys?.length > 0 && (
        <View style={[s.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <Text maxFontSizeMultiplier={1.3} style={[s.sectionTitle, { color: colors.textMuted }]}>{t('x_firm_public_profile_attorneys')}</Text>
          {firm.attorneys.map(att => (
            <View key={att.id} style={s.attRow}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>{(att.display_name || 'A')[0].toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={1.3} style={[s.attName, { color: colors.textPrimary }]}>{att.display_name}</Text>
                <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, color: colors.textMuted }}>
                  {att.firm_role?.replace('_', ' ') || t('x_attorney_dashboard_attorney')}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {(!!firm.phone || !!firm.website) && <ContactActions listing={{ name: firm.name, phone: firm.phone, website: firm.website }} />}
    </ScrollView>
  );
}

const makeS = (colors: ThemeColors) => StyleSheet.create({
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
  avatar:      { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.infoBg,
                 alignItems: 'center', justifyContent: 'center' },
  avatarText:  { fontSize: 15, fontWeight: '700', color: colors.info },
  attName:     { fontSize: 14, fontWeight: '600' },
  btn:         { paddingVertical: 14, paddingHorizontal: 12, borderRadius: 10,
                 alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  btnText:     { color: colors.white, fontWeight: '700', fontSize: 14 },
});
export default React.memo(FirmPublicProfileScreen);