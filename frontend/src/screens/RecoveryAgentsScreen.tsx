import ScreenHeader from '../components/ScreenHeader';
/**
 * RecoveryAgentsScreen
 *
 * Directory of licensed fugitive recovery agents (bail enforcement agents).
 * Accessible ONLY from the Bondsman Dashboard -- never shown to defendants.
 *
 * Features:
 * - Search by state with real-time state law display
 * - Filter by armed/unarmed certification
 * - Sort by proximity (GPS) or rating
 * - One-tap call
 * - Clear disclaimer and state law notice on every result
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ScreenProps } from '../types/navigation';
import {View, Text, FlatList, TouchableOpacity, StyleSheet, Linking, Alert, ActivityIndicator, Switch, ScrollView} from 'react-native';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
import * as Location from 'expo-location';
import { api } from '../services/api';
import {useTheme} from '../constants/theme';
import EmergencyStrip from '../components/EmergencyStrip';

type Agent = {
  id: number;
  name: string;
  city: string;
  state: string;
  phone: string;
  address: string;
  rating: number;
  reviews: number;
  armed_certified: number;
  license_number: string;
  license_required: number;
  available_24_7: number;
  hours: string;
  website: string;
  bio: string;
};

type StateLaw = {
  allowed: boolean;
  license: boolean;
  law?: string;
  notes: string;
};

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IN','IA',
  'KS','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY',
  // Not included: IL, KY, DC -- commercial bail effectively banned there
];

export default function RecoveryAgentsScreen({ navigation }: ScreenProps): JSX.Element {
  const { colors, isDark } = useTheme();

  const [agents, setAgents]       = useState<Agent[]>([]);
  const [stateLaw, setStateLaw]   = useState<StateLaw | null>(null);
  const [loading, setLoading]     = useState(false);
  const [selectedState, setState] = useState('');
  const [armedOnly, setArmedOnly] = useState(false);
  const [error, setError]         = useState('');
  const [searched, setSearched]   = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [userLat, setUserLat]     = useState<number | null>(null);
  const [userLng, setUserLng]     = useState<number | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    // Get user location for proximity sorting
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status === 'granted') {
        Location.getCurrentPositionAsync({}).then(loc => {
          if (mountedRef.current) {
            setUserLat(loc.coords.latitude);
            setUserLng(loc.coords.longitude);
          }
        }).catch(() => {});
      }
    });
    return () => { mountedRef.current = false; };
  }, []);

  const onRefresh = useCallback(async () => {
    if (!selectedState) return;  // no search to refresh if nothing selected
    setRefreshing(true);
    await search().catch(() => {});
    setRefreshing(false);
  }, [selectedState, search]);

  const search = useCallback(async () => {
    if (!selectedState) {
      Alert.alert('Select a state', 'Choose a state to search for recovery agents.');
      return;
    }
    hapticImpact();
    setLoading(true);
    setError('');
    setSearched(true);

    try {
      const params: Record<string, string> = { state: selectedState };
      if (armedOnly) params.armed = '1';
      if (userLat !== null && userLng !== null) {
        params.lat = String(userLat);
        params.lng = String(userLng);
      }

      const res = await api.get('/recovery-agents', { params });
      if (!mountedRef.current) return;
      setAgents(res.data?.agents || []);
      setStateLaw(res.data?.state_law || null);
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      setError('Could not load agents. Check your connection and try again.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [selectedState, armedOnly, userLat, userLng]);

  const call = (phone: string, name: string) => {
    hapticImpact();
    Alert.alert(
      `Call ${name}`,
      phone,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Call', onPress: () => Linking.openURL(`tel:${phone}`).catch(() => {}) },
      ]
    );
  };

  const openWeb = (url: string) => {
    hapticImpact();
    Linking.openURL(url.startsWith('http').catch(() => {}) ? url : `https://${url}`).catch(() => {});
  };

  const renderAgent = useCallback(({ item }: { item: Agent }) => (
    <View style={[styles.agentCard, { backgroundColor: colors.bgCard,
      borderLeftColor: item.armed_certified ? colors.emergencyDark : colors.navy,
      borderLeftWidth: 4 }]}>

      {/* Header row */}
      <View style={styles.agentHeader}>
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.agentName,
            { color: colors.textPrimary }]}>
            {item.name}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={[styles.agentLocation,
            { color: colors.textMuted }]}>
            {item.city}, {item.state}
          </Text>
        </View>
        <View style={styles.ratingBox}>
          {item.rating > 0 && (
            <Text maxFontSizeMultiplier={1.2} style={[styles.rating,
              { color: colors.gold }]}>
              ★ {item.rating.toFixed(1)}
            </Text>
          )}
          {item.reviews > 0 && (
            <Text maxFontSizeMultiplier={1.2} style={[styles.reviews,
              { color: colors.textFaint }]}>
              ({item.reviews})
            </Text>
          )}
        </View>
      </View>

      {/* Badges */}
      <View style={styles.badgeRow}>
        {item.armed_certified ? (
          <View style={[styles.badge, { backgroundColor: colors.emergencyBg }]}>
            <Text maxFontSizeMultiplier={1.2} style={[styles.badgeText,
              { color: colors.emergencyDark }]}>🔫 Armed Certified</Text>
          </View>
        ) : (
          <View style={[styles.badge, { backgroundColor: colors.bgSubtle }]}>
            <Text maxFontSizeMultiplier={1.2} style={[styles.badgeText,
              { color: colors.textMuted }]}>Unarmed</Text>
          </View>
        )}
        {item.license_number ? (
          <View style={[styles.badge, { backgroundColor: colors.legalBg }]}>
            <Text maxFontSizeMultiplier={1.2} style={[styles.badgeText,
              { color: colors.legalDark }]}>✓ Licensed</Text>
          </View>
        ) : null}
        {item.available_24_7 ? (
          <View style={[styles.badge, { backgroundColor: colors.infoBg }]}>
            <Text maxFontSizeMultiplier={1.2} style={[styles.badgeText,
              { color: colors.blue }]}>24/7</Text>
          </View>
        ) : null}
      </View>

      {/* Address */}
      {item.address ? (
        <Text maxFontSizeMultiplier={1.3} style={[styles.address,
          { color: colors.textSecond }]} numberOfLines={2}>
          📍 {item.address}
        </Text>
      ) : null}

      {/* Bio */}
      {item.bio ? (
        <Text maxFontSizeMultiplier={1.3} style={[styles.bio,
          { color: colors.textMuted }]} numberOfLines={3}>
          {item.bio}
        </Text>
      ) : null}

      {/* Action buttons */}
      <View style={styles.actionRow}>
        {item.phone ? (
          <TouchableOpacity
            style={[styles.callBtn, { backgroundColor: colors.legalDark }]}
            onPress={() => call(item.phone, item.name)}
            accessibilityRole="button"
            activeOpacity={0.85}
          >
            <Text maxFontSizeMultiplier={1.2} style={styles.callBtnText}>
              📞 Call
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.callBtn, { backgroundColor: colors.bgSubtle }]}>
            <Text maxFontSizeMultiplier={1.2} style={[styles.callBtnText,
              { color: colors.textMuted }]}>No phone listed</Text>
          </View>
        )}
        {item.website ? (
          <TouchableOpacity
            style={[styles.webBtn, { borderColor: colors.border }]}
            onPress={() => openWeb(item.website)}
            accessibilityRole="button"
            activeOpacity={0.85}
            accessibilityRole="link"
          >
            <Text maxFontSizeMultiplier={1.2} style={[styles.webBtnText,
              { color: colors.blue }]}>🌐 Website</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  ), [colors]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Search controls */}
      <View style={[styles.searchBox, { backgroundColor: colors.bgCard,
        borderBottomColor: colors.border }]}>

        {/* State picker -- horizontal scroll */}
        <Text maxFontSizeMultiplier={1.3} style={[styles.searchLabel,
          { color: colors.textSecond }]}>
          Select State
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', gap: 6, paddingRight: 16 }}>
            {US_STATES.map(st => (
              <TouchableOpacity
                accessibilityRole="button"
                key={st}
                style={[styles.statePill,
                  { backgroundColor: selectedState === st ? colors.navy : colors.bgSubtle,
                    borderColor: selectedState === st ? colors.navy : colors.border }]}
                onPress={() => {
                  hapticImpact();
                  setState(st);
                }}
                accessibilityRole="button"
              >
                <Text maxFontSizeMultiplier={1.2} style={[styles.statePillText,
                  { color: selectedState === st ? '#fff' : colors.textSecond }]}>
                  {st}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {/* Armed filter */}
        <View style={styles.filterRow}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.filterLabel,
            { color: colors.textSecond }]}>
            Armed certified only
          </Text>
          <Switch
            value={armedOnly}
            onValueChange={setArmedOnly}
            trackColor={{ false: colors.border, true: colors.emergencyDark }}
            thumbColor="#fff"
          />
        </View>

        {/* Search button */}
        <TouchableOpacity
          style={[styles.searchBtn,
            { backgroundColor: selectedState ? colors.navy : colors.bgSubtle }]}
          onPress={search}
          disabled={!selectedState || loading}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          <Text maxFontSizeMultiplier={1.2} style={[styles.searchBtnText,
            { color: selectedState ? '#fff' : colors.textMuted }]}>
            {loading ? 'Searching…' : '🔍  Search Recovery Agents'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* State law banner */}
      {stateLaw && (
        <View style={[styles.lawBanner, {
          backgroundColor: stateLaw.allowed
            ? (isDark ? colors.surface : colors.legalBg)
            : (isDark ? colors.surface : colors.errorBg),
          borderLeftColor: stateLaw.allowed ? colors.legalDark : colors.emergencyDark,
        }]}>
          <Text maxFontSizeMultiplier={1.2} style={[styles.lawTitle, {
            color: stateLaw.allowed ? colors.legalDark : colors.emergencyDark,
          }]}>
            {stateLaw.allowed ? '✅' : '⛔'}  {selectedState} -- {
              stateLaw.allowed
                ? stateLaw.license ? 'License required' : 'No license requirement'
                : 'Commercial bail restricted'
            }
          </Text>
          {stateLaw.law ? (
            <Text maxFontSizeMultiplier={1.3} style={[styles.lawCode,
              { color: colors.textMuted }]}>
              {stateLaw.law}
            </Text>
          ) : null}
          <Text maxFontSizeMultiplier={1.3} style={[styles.lawNote,
            { color: colors.textSecond }]}>
            {stateLaw.notes}
          </Text>
        </View>
      )}

      {/* Disclaimer */}
      <View style={[styles.disclaimer, { backgroundColor: colors.bgSubtle,
        borderLeftColor: colors.warnDark }]}>
        <Text maxFontSizeMultiplier={1.2} style={[styles.disclaimerText,
          { color: colors.textMuted }]}>
          ⚖️ This directory is for licensed bondsmen only. Always verify agent
          credentials and state licensing requirements before engagement.
          Not legal advice.
        </Text>
      </View>

      {/* Results */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.navy} />
          <Text maxFontSizeMultiplier={1.3} style={[styles.loadingText,
            { color: colors.textMuted }]}>
            Searching {selectedState}…
          </Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.errorText,
            { color: colors.emergencyDark }]}>
            {error}
          </Text>
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: colors.navy }]}
            onPress={search} accessibilityRole="button" accessibilityLabel="Try again">
            <Text maxFontSizeMultiplier={1.2} style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : searched && agents.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>🔍</Text>
          <Text maxFontSizeMultiplier={1.3} style={[styles.emptyText,
            { color: colors.textMuted }]}>
            No licensed recovery agents found in {selectedState}.{'\n'}
            Try a neighboring state or contact your state DOI.
          </Text>
        </View>
      ) : (
        <FlatList
          onRefresh={onRefresh}
          refreshing={refreshing}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={5}
          removeClippedSubviews={true}
          data={agents}
          keyExtractor={item => String(item.id)}
          renderItem={renderAgent}
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            agents.length > 0 ? (
              <Text maxFontSizeMultiplier={1.3} style={[styles.resultCount,
                { color: colors.textMuted }]}>
                {agents.length} agent{agents.length !== 1 ? 's' : ''} found in {selectedState}
              </Text>
            ) : null
          }
          ListEmptyComponent={null}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  searchBox:     { padding: 14, borderBottomWidth: 1 },
  searchLabel:   { fontSize: 12, fontWeight: '700', letterSpacing: 0.5,
                   marginBottom: 8, textTransform: 'uppercase' },
  statePill:     { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
                   borderWidth: 1 },
  statePillText: { fontSize: 12, fontWeight: '700' },
  filterRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                   marginBottom: 10 },
  filterLabel:   { fontSize: 13, fontWeight: '600' },
  searchBtn:     { borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  searchBtnText: { fontSize: 15, fontWeight: '800' },

  lawBanner:     { borderLeftWidth: 5, padding: 14, gap: 4 },
  lawTitle:      { fontSize: 13, fontWeight: '800' },
  lawCode:       { fontSize: 11, fontStyle: 'italic' },
  lawNote:       { fontSize: 12, lineHeight: 18 },

  disclaimer:    { borderLeftWidth: 4, padding: 10 },
  disclaimerText:{ fontSize: 11, lineHeight: 16, fontStyle: 'italic' },

  center:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadingText:   { marginTop: 12, fontSize: 14 },
  errorText:     { fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryBtn:      { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24 },
  retryText:     { color: '#fff', fontWeight: '700', fontSize: 14 },
  emptyIcon:     { fontSize: 48, marginBottom: 12 },
  emptyText:     { fontSize: 14, textAlign: 'center', lineHeight: 21 },
  resultCount:   { fontSize: 12, marginBottom: 8 },

  agentCard:     { borderRadius: 14, padding: 16, marginBottom: 12, elevation: 1 },
  agentHeader:   { flexDirection: 'row', marginBottom: 8 },
  agentName:     { fontSize: 15, fontWeight: '800', marginBottom: 2 },
  agentLocation: { fontSize: 12 },
  ratingBox:     { alignItems: 'flex-end' },
  rating:        { fontSize: 14, fontWeight: '800' },
  reviews:       { fontSize: 11 },

  badgeRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  badge:         { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  badgeText:     { fontSize: 11, fontWeight: '700' },

  address:       { fontSize: 12, lineHeight: 17, marginBottom: 6 },
  bio:           { fontSize: 12, lineHeight: 17, marginBottom: 8, fontStyle: 'italic' },

  actionRow:     { flexDirection: 'row', gap: 8 },
  callBtn:       { flex: 2, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  callBtnText:   { color: '#fff', fontWeight: '800', fontSize: 14 },
  webBtn:        { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center',
                   borderWidth: 1 },
  webBtnText:    { fontWeight: '700', fontSize: 13 },
});
