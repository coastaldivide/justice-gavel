import { useHaptics } from '../hooks/useHaptics';
import { useToast } from '../components/ToastProvider';
/**
 * FirmDiscoveryScreen.tsx — Public firm directory for defendants and clients
 * Lets users browse firms by state/practice area
 * and tap through to a firm's public profile before contacting them.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { KeyboardAvoidingView, Platform, LayoutAnimation} from 'react-native';
import { FlashListCompat as FlashList } from '../components/FlashListCompat';
import {
  View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api } from '../services/api';
import { t } from '../i18n';
import { useTheme } from '../constants/theme';

interface Firm {
  id: number;
  name: string;
  city: string;
  state: string;
  practice_areas: string;
  accepting_clients: boolean;
  free_consultation: boolean;
  attorney_count: number;
}

function FirmDiscoveryScreen() {
  const { impact, success, error: hapticError } = useHaptics();
  const { showToast } = useToast();
  const navigation = useNavigation<any>();
  const { colors }  = useTheme();
  const [firms, setFirms]           = useState<Firm[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stateFilter, setStateFilter] = useState('');
  const [areaFilter, setAreaFilter]   = useState('');
  const [code, setCode]               = useState('');
  const [codeLoading, setCodeLoading] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (stateFilter.trim()) params.state = stateFilter.trim().toUpperCase();
      if (areaFilter.trim())  params.practice_area = areaFilter.trim();
      const res = await api.get('/firms/directory', { params });
      setFirms(res.data?.firms ?? []);
    } catch {
      setFirms([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [stateFilter, areaFilter]);

  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); load(); }, [load]);

  const redeemCode = async () => {
    const c = code.trim().toUpperCase();
    if (!c || c.length < 4) { showToast('Enter a referral code'); return; }
    setCodeLoading(true);
    try {
      const res = await api.get(`/firms/referral/${c}`);
      const firm = res.data?.firm;
      if (firm) navigation.navigate('FirmPublicProfile', { firmId: firm.id, firmName: firm.name });
    } catch {
      showToast('No firm found with that referral code. Check the code and try again.');
    } finally {
      setCodeLoading(false);
    }
  };

  const renderFirm = ({ item }: { item: Firm }) => (
    <TouchableOpacity
      style={[s.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
      onPress={() => navigation.navigate('FirmPublicProfile', { firmId: item.id, firmName: item.name })}
      accessibilityRole="button"
      accessibilityLabel={`View ${item.name} firm profile`}
      accessibilityHint="Opens this firm's public profile and contact options"
    >
      <View style={s.cardHeader}>
        <Text maxFontSizeMultiplier={1.3} style={[s.firmName, { color: colors.textPrimary }]} numberOfLines={1}>
          {item.name}
        </Text>
        {item.free_consultation && (
          <View style={s.badge}>
            <Text style={s.badgeText}>Free consult</Text>
          </View>
        )}
      </View>
      <Text maxFontSizeMultiplier={1.3} style={[s.location, { color: colors.textMuted }]}>
        {[item.city, item.state].filter(Boolean).join(', ')}
        {item.attorney_count > 0 ? ` · ${item.attorney_count} attorney${item.attorney_count > 1 ? 's' : ''}` : ''}
      </Text>
      {!!item.practice_areas && (
        <Text maxFontSizeMultiplier={1.3} style={[s.areas, { color: colors.textSecond }]} numberOfLines={2}>
          {item.practice_areas}
        </Text>
      )}
      <View style={s.cardFooter}>
        <Text style={[s.status, { color: item.accepting_clients ? '#0d7a3e' : '#9ca3af' }]}>
          {item.accepting_clients ? '● Accepting clients' : '○ Not accepting clients'}
        </Text>
        <Text style={[s.arrow, { color: colors.textMuted }]}>›</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[s.container, { backgroundColor: colors.primary }]}>
      {/* Referral code entry */}
      <View style={[s.codeBar, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <TextInput
          style={[s.codeInput, { color: colors.textPrimary }]}
          value={code}
          onChangeText={setCode}
          placeholder="Have a referral code?"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          maxLength={12}
        />
        <TouchableOpacity
          style={s.codeBtn}
          onPress={redeemCode}
          disabled={codeLoading}
          accessibilityRole="button"
        >
          {codeLoading
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={s.codeBtnText}>Find Firm</Text>}
        </TouchableOpacity>
      </View>

      {/* Filters */}
      <View style={s.filters}>
        <TextInput
          style={[s.filterInput, { color: colors.textPrimary, borderColor: colors.border }]}
          value={stateFilter}
          onChangeText={setStateFilter}
          onEndEditing={() => load()}
          placeholder="State (e.g. TN)"
          placeholderTextColor={colors.textMuted}
          maxLength={2}
          autoCapitalize="characters"
        />
        <TextInput
          style={[s.filterInput, { flex: 2, color: colors.textPrimary, borderColor: colors.border }]}
          value={areaFilter}
          onChangeText={setAreaFilter}
          onEndEditing={() => load()}
          placeholder="Practice area (e.g. criminal)"
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Filter by practice area"
        />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.blue} />
      ) : (
        <FlashList
          estimatedItemSize={80}
          data={firms ?? []}
          keyExtractor={item => String(item.id)}
          renderItem={renderFirm}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={[s.emptyIcon]}>🏛️</Text>
              <Text maxFontSizeMultiplier={1.3} style={[s.emptyTitle, { color: colors.textPrimary }]}>No firms found</Text>
              <Text maxFontSizeMultiplier={1.3} style={[s.emptyBody, { color: colors.textMuted }]}>
                Try a different state or practice area, or ask your attorney for a referral code.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1 },
  codeBar:     { flexDirection: 'row', margin: 16, marginBottom: 8, borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  codeInput:   { flex: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
  // @ts-ignore
  codeBtn:     { backgroundColor: COLORS.navy, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 44 },
  // @ts-ignore
  codeBtnText: { color: colors.bg, fontWeight: '700', fontSize: 13 },
  filters:     { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 4 },
  filterInput: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, minHeight: 44 },
  card:        { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12 },
  cardHeader:  { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  firmName:    { flex: 1, fontSize: 16, fontWeight: '700' },
  badge:       { backgroundColor: '#E1F5EE', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText:   { fontSize: 11, fontWeight: '600', color: '#0F6E56' },
  location:    { fontSize: 13, marginBottom: 4 },
  areas:       { fontSize: 13, marginBottom: 8 },
  cardFooter:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  status:      { fontSize: 12, fontWeight: '500' },
  arrow:       { fontSize: 22, fontWeight: '300' },
  empty:       { alignItems: 'center', paddingTop: 60 },
  emptyIcon:   { fontSize: 48, marginBottom: 12 },
  emptyTitle:  { fontSize: 17, fontWeight: '700', marginBottom: 8 },
  emptyBody:   { fontSize: 14, textAlign: 'center', lineHeight: 20, maxWidth: 280 },
});
export default React.memo(FirmDiscoveryScreen);