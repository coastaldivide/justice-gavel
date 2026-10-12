import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../components/ToastProvider';
import { AppIcon } from '../components/AppIcon';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, KeyboardAvoidingView, Platform, RefreshControl, LayoutAnimation } from 'react-native';
import type { ScreenProps } from '../types/navigation';
/**
 * ArrestMonitorScreen -- Pro tier feature
 * Lets users watch for arrest records on up to 5 names/counties.
 * When the nightly scraper finds a match, they get a push notification.
 * Accessible from: HomeScreen tile "My Plan" → upsell, or direct nav from Pro plan
 */
import React, { useState, useEffect, useCallback } from 'react';
import { unwrapList, api, apiErrorMessage } from '../services/api';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';

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

function ArrestMonitorScreen({ navigation }: ScreenProps): React.JSX.Element {
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);



  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);

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
      setWatches(unwrapList(res.data, 'monitors'));
    } catch (e: any) { __DEV__ && console.warn(e?.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Pull-to-refresh: one reload (the old handler called load() twice).
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  const addWatch = async () => {
    if (!name.trim()) { showToast('Enter the full name to start monitoring.', 'error'); return; }
    if (watches.length >= MAX_WATCHES) {
      showToast(`Pro plan supports up to ${MAX_WATCHES} active monitors.`, 'warning');
      return;
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
      showToast(apiErrorMessage(e, 'Could not add monitor.'), 'info');
    }
    setAdding(false);
  };

  const removeWatch = (id: number) => {
confirm('Stop Monitoring?',"We'll stop alerts for this person. You can re-add any time.",
      { confirmLabel:'Remove', destructive:true }).then(async ok=>{ if(!ok) return;
      await api.delete(`/arrests/monitors/${id}`).catch((e) => { __DEV__ && console.warn(e?.message); });
        setWatches(prev => prev.filter(w => w.id !== id));
    })
  };

  // ── Not Pro -- upsell wall ────────────────────────────────────────────────
  if (!loading && !isPro) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.bg }]}
        testID="arrest-monitor-screen">
        <View style={styles.upsellCard}>
          <AppIcon name="notifications-outline" size={20} color={COLORS.navy} />
          <Text maxFontSizeMultiplier={1.4} style={styles.upsellTitle}>Arrest Monitoring</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.upsellBody}>
            Get a push alert when a name you watch appears in the public arrest
            records we ingest.{'\n\n'}
            Monitor up to 5 names. Coverage depends on the public booking feeds
            connected for your area.
          </Text>
          <View style={styles.upsellFeatures}>
            {[
              'Nightly check of ingested arrest records',
              'Push notification on a new match',
              'Up to 5 names monitored',
              'Covers connected public booking feeds',
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
          accessibilityHint="Double-tap to activate"
            style={styles.upsellBtn}
            onPress={() => navigation.navigate('MoreTab', { screen: 'ConsumerSubscription' })}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.upsellBtnText}>Upgrade to Legal Pro -- $14.99/mo</Text>
          </TouchableOpacity>
          <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint="Double-tap to activate"
          style={styles.upsellSkip}
          accessibilityLabel="Maybe later"
          onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('HomeTab')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
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
                Add a name below -- we'll alert you when it appears in the arrest records we ingest.
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
          accessibilityRole="button"
          accessibilityHint="Double-tap to activate" style={styles.removeBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} onPress={() => removeWatch(w.id)}
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
        maxLength={200}
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
          accessibilityLabel="State"
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
                    accessibilityRole="button"
          accessibilityHint="Double-tap to activate" activeOpacity={0.6}
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
                    accessibilityLabel="Cancel"
          accessibilityHint="Cancels and returns to previous screen" onPress={() => { setShowForm(false); setName(''); setCounty(''); }}
                  >
                    <Text maxFontSizeMultiplier={1.4} style={styles.cancelFormText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity accessibilityRole="button"
          accessibilityHint="Double-tap to activate" style={styles.addTrigger} accessibilityLabel="+ Add a Name to Monitor" onPress={() => setShowForm(true)}
              >
                <Text maxFontSizeMultiplier={1.4} style={styles.addTriggerText}>+ Add a Name to Monitor</Text>
              </TouchableOpacity>
            )
          )}

          {/* Explanation */}
          <View style={styles.infoCard}>
            <Text maxFontSizeMultiplier={1.4} style={styles.infoTitle}>How it works</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.infoText}>
              Every night we check the names on your list against the public arrest
              records in our database. On a new match you get a push notification
              with the booking details.{'\n\n'}
              Coverage depends on the public booking feeds connected for your area --
              a monitor can only match records from those feeds. Monitors run for as
              long as your Pro subscription is active.
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
  upsellTitle:       { fontSize: 22, ...FONTS.heavy, color: colors.textBrand, marginBottom: 10, textAlign: 'center' },
  upsellBody:        { fontSize: 15, color: colors.textMuted, textAlign: 'center', lineHeight: 22, marginBottom: 20 },
  upsellFeatures:    { width: '100%', gap: 8, marginBottom: 24 },
  upsellFeatureRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  upsellCheck:       { color: colors.legal, fontSize: 16, lineHeight: 24, fontFamily: 'Inter_900Black', fontWeight: '900', width: 18 },
  upsellFeatureText: { fontSize: 14, lineHeight: 21, color: colors.textBrand, flex: 1 },
  upsellBtn:         { backgroundColor: COLORS.navy, borderRadius: RADIUS.lg, paddingVertical: 15, paddingHorizontal: 24, width: '100%', alignItems: 'center', ...SHADOW.md },
  upsellBtnText:     { color: COLORS.bgCard, fontSize: 15, lineHeight: 22, ...FONTS.heavy },
  upsellSkip:        { marginTop: 14 },
  upsellSkipText:    { color: colors.textMuted, fontSize: 12 },

  // Status
  statusBar:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  statusBadge:  { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.legalBg, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 20 },
  statusDot:    { color: colors.legal, fontSize: 11 },
  statusText:   { fontSize: 12, ...FONTS.heavy, color: colors.legal },
  statusCount:  { fontSize: 12, color: colors.textMuted, ...FONTS.semi },

  // Empty
  emptyCard:  { backgroundColor: COLORS.bgCard, borderRadius: RADIUS.xl, padding: 32, alignItems: 'center', marginBottom: 12, ...SHADOW.sm },
  emptyIcon:  { fontSize: 36, marginBottom: 10 },
  emptyTitle: { fontSize: 16, lineHeight: 24, ...FONTS.heavy, color: COLORS.navy, marginBottom: 6 },
  emptySub:   { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', lineHeight: 18 },

  // Watch cards
  watchCard:    { backgroundColor: COLORS.bgCard, borderRadius: RADIUS.lg, padding: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center', ...SHADOW.sm, borderLeftWidth: 3, borderLeftColor: COLORS.navy },
  watchName:    { fontSize: 15, lineHeight: 22, ...FONTS.heavy, color: COLORS.textPrimary, marginBottom: 2 },
  watchLocation:{ fontSize: 12, color: COLORS.textMuted },
  watchStatus:  { fontSize: 11, color: COLORS.info, marginTop: 2 },
  matchBadge:   { backgroundColor: COLORS.infoBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 10, marginTop: 6, borderWidth: 1, borderColor: COLORS.steelMid },
  matchText:    { fontSize: 12, color: COLORS.info, ...FONTS.bold },
  removeBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
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
export default React.memo(ArrestMonitorScreen);