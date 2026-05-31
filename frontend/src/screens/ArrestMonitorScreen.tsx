import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, KeyboardAvoidingView, Platform, RefreshControl} from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { useNavigation } from '@react-navigation/native';
/**
 * ArrestMonitorScreen -- Pro tier feature
 * Lets users watch for arrest records on up to 5 names/counties.
 * When the nightly scraper finds a match, they get a push notification.
 * Accessible from: HomeScreen tile "My Plan" → upsell, or direct nav from Pro plan
 */
import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';

declare var setError: any;
declare var setWallTapCount: any;
declare var wallTapCount: any;
const MAX_WATCHES = 5;

interface Watch {
  id: number;
  watch_name: string;
  county: string;
  state: string;
  last_checked: string | null;
  last_result: string | null;
  active: number;
}

export default function ArrestMonitorScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);


  // Deduplicate arrest results -- same person + charge + date = one entry
  const deduplicateArrests = (arrests: Record<string, unknown>[]): Record<string, unknown>[] => {
    const seen = new Map<string, any>();
    for (const arrest of arrests) {
      const key = [
        ((arrest as import('../types/api').ArrestRecord).name || '').toLowerCase().trim(),
        ((arrest as import('../types/api').ArrestRecord).charge || (arrest as import('../types/api').ArrestRecord).charges || '').toLowerCase().slice(0, 30),
        ((arrest as any).booking_date || (arrest as any).date || '').slice(0, 10),
      ].join('|');
      if (!seen.has(key)) {
        seen.set(key, arrest);
      } else {
        // Merge sources into the first entry
        const existing = seen.get(key);
        if (arrest.source && !existing.sources) {
          existing.sources = [existing.source, arrest.source].filter(Boolean);
        }
      }
    }
    return [...seen.values()];
  };

  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    load().finally ? load().finally(() => setRefreshing(false)) : (setRefreshing(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [watches,   setWatches]   = useState<Watch[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [isPro,     setIsPro]     = useState(false);
  const [name,      setName]      = useState('');
  const [county,    setCounty]    = useState('');
  const [state,     setState]     = useState('');
  const [adding,    setAdding]    = useState(false);
  const [showForm,  setShowForm]  = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Check subscription tier
      const subRes = await api.get('/billing/subscription').catch(() => ({ data: { tier: 'free' } }));
      const tier = subRes.data?.tier || 'free';
      setIsPro(['legal_pro', 'intel', 'attorney_alert', 'attorney_featured'].includes(tier));

      // Load existing watches
      const res = await api.get('/arrests/monitors').catch(() => ({ data: [] }));
      setWatches(res.data || []);
    } catch (e: any) { __DEV__ && console.warn(e?.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const addWatch = async () => {
    if (!name.trim()) { setError('Enter the full name to start monitoring.'); return; }
    if (watches.length >= MAX_WATCHES) {
      Alert.alert('Limit reached', `Pro plan supports up to ${MAX_WATCHES} active monitors.`); return;
    }
    setAdding(true);
    try {
      await api.post('/arrests/monitors', {
        watch_name: name.trim(),
        county:     county.trim() || 'All',
        state:      state.trim().toUpperCase().slice(0,2) || 'ALL'});
      setName(''); setCounty(''); setShowForm(false);
      await load();
    } catch (e: any) {
      setLoading(false);
      Alert.alert('Could Not Load Alerts', e.response?.data?.error || 'Could not add monitor.');
    }
    setAdding(false);
  };

  const removeWatch = (id: number) => {
    Alert.alert('Stop Monitoring', 'We\'ll stop sending alerts for this person. You can add them again any time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        await api.delete(`/arrests/monitors/${id}`).catch((e) => { __DEV__ && console.warn(e?.message); });
        setWatches(prev => prev.filter(w => w.id !== id));
      }},
    ]);
  };

  // ── Not Pro -- upsell wall ────────────────────────────────────────────────
  if (!loading && !isPro) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.bg }]}
        testID="arrest-monitor-screen">
        <View style={styles.upsellCard}>
          <Text maxFontSizeMultiplier={1.4} style={styles.upsellIcon}>🔔</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.upsellTitle}>Arrest Monitoring</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.upsellBody}>
            Get an instant alert the moment someone you care about is booked into any jail in the US.{'\n\n'}
            Monitor up to 5 names across any county -- 24 hours a day, 7 days a week.
          </Text>
          <View style={styles.upsellFeatures}>
            {[
              '24/7 arrest record scanning',
              'Instant push notification on match',
              'Up to 5 names monitored',
              'Any county in the US',
              'Includes full Pro plan features',
            ].map(f => (
              <View key={f} style={styles.upsellFeatureRow}>
                <Text maxFontSizeMultiplier={1.4} style={styles.upsellCheck}>✓</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.upsellFeatureText}>{f}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.upsellBtn}
            onPress={() => (() => {
              const newCount = wallTapCount + 1;
              setWallTapCount(newCount);
              if (newCount >= 2) {
                Alert.alert(
                  "🔔 You've checked this twice",
                  'Arrest Monitor sends you an instant push notification the moment someone you care about is booked -- no checking required.\n\nPro plan: $14.99/mo.',
                  [
                    { text: 'Not now', style: 'cancel' },
              { text: 'Start Free Trial', onPress: () => navigation.navigate('MoreTab', { screen: 'ConsumerSubscription' }) },
                  ]
                );
              } else {
                navigation.navigate('MoreTab', { screen: 'ConsumerSubscription' });
              }
            })()}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.upsellBtnText}>Upgrade to Legal Pro -- $14.99/mo</Text>
          </TouchableOpacity>
          <TouchableOpacity
          accessibilityRole="button" style={styles.upsellSkip} onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('HomeTab')}
            >
            <Text maxFontSizeMultiplier={1.4} style={styles.upsellSkipText}>Maybe later</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Pro -- monitoring list ────────────────────────────────────────────────
  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.navy} /></View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps='handled' contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>

          {/* Status bar */}
          <View style={styles.statusBar}>
            <View style={styles.statusBadge}>
              <Text maxFontSizeMultiplier={1.4} style={styles.statusDot}>●</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.statusText}>Active</Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={styles.statusCount}>{watches.length} / {MAX_WATCHES} monitors</Text>
          </View>

          {/* Active watches */}
          {watches.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text maxFontSizeMultiplier={1.4} style={styles.emptyIcon}>👁</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.emptyTitle}>No monitors yet</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.emptySub}>
                Add a name below -- we'll alert you the moment they appear in arrest records.
              </Text>
            </View>
          ) : (
            watches.map(w => (
              <View key={w.id} style={styles.watchCard}>
                <View style={{ flex: 1 }}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.watchName}>{w.watch_name}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.watchLocation}>
                    {w.county !== 'All' ? `${w.county}, ` : 'All counties -- '}{w.state}
                  </Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.watchStatus}>
                    {w.last_checked
                      ? `Last checked: ${new Date(w.last_checked).toLocaleDateString()}`
                      : 'Checking tonight'}
                  </Text>
                  {w.last_result === 'found' && (
                    <View style={styles.matchBadge}>
                      <Text maxFontSizeMultiplier={1.4} style={styles.matchText}>⚡ Match found -- check arrest records</Text>
                    </View>
                  )}
                </View>
                <TouchableOpacity
          accessibilityRole="button" style={styles.removeBtn} onPress={() => removeWatch(w.id)}
                >
                  <Text maxFontSizeMultiplier={1.4} style={styles.removeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))
          )}

          {/* Add form */}
          {watches.length < MAX_WATCHES && (
            showForm ? (
              <View style={styles.addForm}>
                <Text maxFontSizeMultiplier={1.4} style={styles.addFormTitle}>Add Monitor</Text>
                <TextInput
                  style={styles.formInput}
                  accessibilityLabel="Full name to monitor" placeholder="Full name (e.g. John Smith)"
                  placeholderTextColor={COLORS.textSecond}
                  value={name}
                  onChangeText={setName}
                  autoFocus
                  returnKeyType="next"
          blurOnSubmit
        />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    style={[styles.formInput, { flex: 1 }]}
                    accessibilityLabel="County (optional)" placeholder="County (optional)"
                    placeholderTextColor={COLORS.textSecond}
                    value={county}
                    onChangeText={setCounty}
          returnKeyType="next"
          blurOnSubmit
        />
                  <TextInput
                    style={[styles.formInput, { width: 70 }]}
                    placeholder="State"
                    placeholderTextColor={COLORS.textSecond}
                    value={state}
                    onChangeText={v => setState(v.toUpperCase().slice(0, 2))}
                    autoCapitalize="characters"
                    maxLength={2}
                  />
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    accessibilityRole="button" activeOpacity={0.6}
                    style={[styles.addBtn, { flex: 1 }]}
                    onPress={addWatch}
                    disabled={adding}
                  >
                    {adding
                      ? <ActivityIndicator color={colors.bgCard} size="small" />
                      : <Text maxFontSizeMultiplier={1.4} style={styles.addBtnText}>Start Monitoring</Text>
                    }
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    style={styles.cancelFormBtn}
                    onPress={() => { setShowForm(false); setName(''); setCounty(''); }}
                  >
                    <Text maxFontSizeMultiplier={1.4} style={styles.cancelFormText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity accessibilityRole="button" style={styles.addTrigger} onPress={() => setShowForm(true)}
              >
                <Text maxFontSizeMultiplier={1.4} style={styles.addTriggerText}>+ Add a Name to Monitor</Text>
              </TouchableOpacity>
            )
          )}

          {/* Explanation */}
          <View style={styles.infoCard}>
            <Text maxFontSizeMultiplier={1.4} style={styles.infoTitle}>How it works</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.infoText}>
              Every night at 3am, we scan arrest records across the US for any name on your list.
              If we find a match, you get an instant push notification with the booking details.{'\n\n'}
              Monitors run for as long as your Pro subscription is active.
            </Text>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
      )}
    </View>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen:  { flex: 1, backgroundColor: COLORS.bg },
  scroll:  { padding: 16 },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Upsell
  upsellCard:        { flex: 1, padding: 28, alignItems: 'center', justifyContent: 'center' },
  upsellIcon:        { fontSize: 48, marginBottom: 16 },
  upsellTitle:       { fontSize: 22, ...FONTS.heavy, color: COLORS.navy, marginBottom: 10, textAlign: 'center' },
  upsellBody:        { fontSize: 15, color: COLORS.textSecond, textAlign: 'center', lineHeight: 22, marginBottom: 20 },
  upsellFeatures:    { width: '100%', gap: 8, marginBottom: 24 },
  upsellFeatureRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  upsellCheck:       { color: COLORS.legal, fontSize: 16, lineHeight: 24, fontFamily: 'Inter_900Black', fontWeight: '900', width: 18 },
  upsellFeatureText: { fontSize: 14, lineHeight: 21, color: COLORS.textPrimary, flex: 1 },
  upsellBtn:         { backgroundColor: COLORS.navy, borderRadius: RADIUS.lg, paddingVertical: 15, paddingHorizontal: 24, width: '100%', alignItems: 'center', ...SHADOW.md },
  upsellBtnText:     { color: COLORS.bgCard, fontSize: 15, lineHeight: 22, ...FONTS.heavy },
  upsellSkip:        { marginTop: 14 },
  upsellSkipText:    { color: COLORS.textMuted, fontSize: 12 },

  // Status
  statusBar:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  statusBadge:  { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.legal, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 20 },
  statusDot:    { color: COLORS.legal, fontSize: 11 },
  statusText:   { fontSize: 12, ...FONTS.heavy, color: COLORS.legal },
  statusCount:  { fontSize: 12, color: COLORS.textMuted, ...FONTS.semi },

  // Empty
  emptyCard:  { backgroundColor: COLORS.bgCard, borderRadius: RADIUS.xl, padding: 32, alignItems: 'center', marginBottom: 12, ...SHADOW.sm },
  emptyIcon:  { fontSize: 36, marginBottom: 10 },
  emptyTitle: { fontSize: 16, lineHeight: 24, ...FONTS.heavy, color: COLORS.navy, marginBottom: 6 },
  emptySub:   { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', lineHeight: 18 },

  // Watch cards
  watchCard:    { backgroundColor: COLORS.bgCard, borderRadius: RADIUS.lg, padding: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center', ...SHADOW.sm, borderLeftWidth: 3, borderLeftColor: COLORS.navy },
  watchName:    { fontSize: 15, lineHeight: 22, ...FONTS.heavy, color: COLORS.textPrimary, marginBottom: 2 },
  watchLocation:{ fontSize: 12, color: COLORS.textMuted },
  watchStatus:  { fontSize: 11, color: COLORS.steel, marginTop: 2 },
  matchBadge:   { backgroundColor: '#FFA726', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 10, marginTop: 6, borderWidth: 1, borderColor: '#F9A825' },
  matchText:    { fontSize: 12, color: '#FFA726', ...FONTS.bold },
  removeBtn:    { width: 30, height: 30, borderRadius: 16, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  removeBtnText:{ fontSize: 12, lineHeight: 20, color: COLORS.textMuted, fontFamily: 'Inter_700Bold', fontWeight: '700' },

  // Add form
  addForm:       { backgroundColor: COLORS.bgCard, borderRadius: RADIUS.xl, padding: 16, marginBottom: 12, ...SHADOW.sm },
  addFormTitle:  { fontSize: 15, lineHeight: 22, ...FONTS.heavy, color: COLORS.navy, marginBottom: 12 },
  formInput:     { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, lineHeight: 22, color: COLORS.textPrimary, backgroundColor: COLORS.bg, marginBottom: 8 },
  addBtn:        { backgroundColor: COLORS.navy, borderRadius: RADIUS.md, paddingVertical: 13, alignItems: 'center' },
  addBtnText:    { color: COLORS.bgCard, ...FONTS.heavy, fontSize: 14,
    lineHeight: 21},
  cancelFormBtn: { paddingHorizontal: 16, paddingVertical: 13, alignItems: 'center', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  cancelFormText:{ color: COLORS.textMuted, fontSize: 12, lineHeight: 20, ...FONTS.semi },
  addTrigger:    { backgroundColor: COLORS.bgCard, borderRadius: RADIUS.lg, paddingVertical: 15, alignItems: 'center', marginBottom: 12, borderWidth: 1.5, borderColor: COLORS.navy, borderStyle: 'dashed' },
  addTriggerText:{ color: COLORS.navy, fontSize: 14, lineHeight: 21, ...FONTS.heavy },

  // Info
  infoCard:  { backgroundColor: COLORS.bg, borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  infoTitle: { fontSize: 12, lineHeight: 20, ...FONTS.heavy, color: COLORS.navy, marginBottom: 6 },
  infoText:  { fontSize: 12, color: COLORS.textMuted, lineHeight: 17 }});
