
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, Alert, FlatList, Linking, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, KeyboardAvoidingView} from 'react-native';
/**
 * BondsmanDashboardScreen -- Real-time lead feed for bail bondsmen
 *
 * Shows incoming arrest leads sorted by bail amount.
 * One-tap accept charges the bondsman's card and reveals full contact info.
 * Lead fee is tiered by bail amount ($25-$300).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
// eslint-disable-next-line @typescript-eslint/no-unused-vars, { useState, useEffect, useCallback } from 'react';

import { api } from '../services/api';
import { useAuthGate } from '../components/AuthGate';
import {  useTheme, COLORS } from '../constants/theme';
import { ScreenCapture, hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
import * as secureStorage from '../utils/secureStorage';

declare var _fetchError: any;
declare var confirmAccept: any; // hoisted from component scope
// ── Lead fee display helper ───────────────────────────────────────────────────
function leadFeeLabel(bailAmount: number): string {
  if (!bailAmount || bailAmount <= 0) return '$25';
  if (bailAmount < 5000)   return '$25';
  if (bailAmount < 25000)  return '$75';
  if (bailAmount < 100000) return '$150';
  return '$300';
}

function bailTier(bailAmount: number): { label: string; color: string; bg: string } {
  if (!bailAmount || bailAmount <= 0) return { label: 'Bail TBD', color: COLORS.textMuted, bg: COLORS.bg };
  if (bailAmount < 5000)   return { label: 'Low bail',    color: COLORS.legalDark, bg: COLORS.legalBg };
  if (bailAmount < 25000)  return { label: 'Mid bail',    color: COLORS.warnDark, bg: COLORS.warnBg };
  if (bailAmount < 100000) return { label: 'High bail',   color: COLORS.blue, bg: COLORS.bgSubtle };
  return { label: 'Premium',     color: COLORS.emergencyDark, bg: COLORS.emergencyBg };
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h ago`;
  return `${m}m ago`;
}

// ── Lead card ─────────────────────────────────────────────────────────────────
function LeadCard({ lead, onAccept }: { lead: Record<string,any>; onAccept: () => void }) {
  const [_fetchError, _setFetchError] = useState<string|null>(null);
  const [expanded, setExpanded] = useState(false);
  const tier = bailTier(lead.bail_amount);


  // Refresh data when user navigates back to this screen
  useFocusEffect(
    useCallback(() => {
      confirmAccept();
    }, [])
  );


  return (
    <TouchableOpacity
      accessibilityRole="button"
      style={[styles.card, lead.purchased && styles.cardPurchased]}
      onPress={() => setExpanded(e => !e)}
      activeOpacity={0.85}
    >
      {/* Top row */}
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.4} style={styles.leadName}>{lead.name}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.leadLocation}>
            {lead.county ? `${lead.county} County` : ''}{lead.state ? `, ${lead.state}` : ''}
          </Text>
        </View>
        <View style={styles.bailBlock}>
          <Text maxFontSizeMultiplier={1.4} style={styles.bailAmount}>
            {lead.bail_amount > 0 ? `$${lead.bail_amount.toLocaleString()}` : 'TBD'}
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.bailLabel}>bail</Text>
        </View>
      </View>

      {/* Tier + timing badges */}
      <View style={styles.badgeRow}>
        <View style={[styles.badge, { backgroundColor: tier.bg }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.badgeText, { color: tier.color }]}>{tier.label}</Text>
        </View>
        <View style={styles.badge}>
          <Text maxFontSizeMultiplier={1.4} style={styles.badgeText}>⏱ {timeAgo(lead.booking_date)}</Text>
        </View>
        {lead.purchased && (
          <View style={[styles.badge, styles.purchasedBadge]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.badgeText, { color: COLORS.legalDark }]}>✓ Purchased</Text>
          </View>
        )}
      </View>

      {/* Charges */}
      {lead.charges && (
        <Text maxFontSizeMultiplier={1.4} style={styles.charges} numberOfLines={expanded ? undefined : 1}>
          📋 {lead.charges}
        </Text>
      )}

      {/* Expanded: full details + accept */}
      {expanded && (
        <View style={styles.expandedSection}>
          {lead.jail_location && (
            <Text maxFontSizeMultiplier={1.4} style={styles.detailRow}>🏛 {lead.jail_location}</Text>
          )}
          {lead.case_number && (
            <Text maxFontSizeMultiplier={1.4} style={styles.detailRow}>📎 Case #{lead.case_number}</Text>
          )}
          {lead.court_date && (
            <Text maxFontSizeMultiplier={1.4} style={styles.detailRow}>📅 Court: {lead.court_date}</Text>
          )}

          {lead.purchased ? (
            // Already purchased -- full contact revealed
            <View style={styles.revealedBlock}>
              <Text maxFontSizeMultiplier={1.4} style={styles.revealedTitle}>✓ Contact Information Unlocked</Text>
              {lead.phone && (
                <TouchableOpacity onPress={() => Linking.openURL('tel:' + lead.phone).catch(() => {})}
                  accessibilityRole="button"
                >
                  <Text maxFontSizeMultiplier={1.4} style={styles.revealedPhone}>📞 {lead.phone}</Text>
                </TouchableOpacity>
              )}
              <Text maxFontSizeMultiplier={1.4} style={styles.revealedName}>{lead.name}</Text>
            </View>
          ) : (
            // Not purchased -- show accept button
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.acceptBtn}
              onPress={() => onAccept(lead)}
              activeOpacity={0.85}
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.acceptBtnText}>
                Accept Lead -- {leadFeeLabel(lead.bail_amount)}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.acceptBtnSub}>
                Reveals full name, contact info, case details
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      <Text maxFontSizeMultiplier={1.4} style={styles.expandHint}>
        {expanded ? '▲ Less' : `▼ Details  ·  Lead fee: ${leadFeeLabel(lead.bail_amount)}`}
      </Text>
    </TouchableOpacity>
  );
}

// ── Profile setup modal ───────────────────────────────────────────────────────
function ProfileModal({ visible, onClose, onSaved }: any) {
  const [company, setCompany] = useState('');
  const [license, setLicense]         = useState('');
  const [licenseState, setLicenseState] = useState('');
  const [counties, setCounties]         = useState('davidson, shelby');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!company.trim()) { Alert.alert('Required', 'Enter your company name.'); return; }
    setSaving(true);
    try {
      await api.post('/billing/bondsman/profile', {
        company_name: company,
        license_number: license,
        license_state: licenseState,
        counties: counties.split(',').map(c => c.trim().toLowerCase()).filter(Boolean),
        states: licenseState ? [licenseState.toUpperCase()] : []});
      onSaved();
    } catch (e: any) {
      Alert.alert('Connection issue', 'Check your internet and pull down to refresh.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet"
        onRequestClose={() => {}}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text maxFontSizeMultiplier={1.4} style={styles.modalTitle}>Set Up Your Profile</Text>
          <TouchableOpacity onPress={onClose}
            accessibilityRole="button">
            <Text maxFontSizeMultiplier={1.4} style={styles.modalClose}>✕</Text>
          </TouchableOpacity>
        </View>
              <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex:1 }}>
<ScrollView keyboardShouldPersistTaps='handled' style={styles.modalBody}>
          <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>Company Name *</Text>
          <TextInput
            style={styles.input}
            value={company}
            onChangeText={setCompany}
            placeholder="ABC Bail Bonds"
            placeholderTextColor={COLORS.textMuted}
          returnKeyType="next"
          blurOnSubmit
        />
          <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>License Number</Text>
          <TextInput
            style={styles.input}
            value={license}
            onChangeText={setLicense}
            placeholder="TN-12345"
            placeholderTextColor={COLORS.textMuted}
          returnKeyType="next"
          blurOnSubmit
        />
          <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>Counties you cover (comma separated)</Text>
          <TextInput
            style={styles.input}
            value={counties}
            onChangeText={setCounties}
            placeholder="davidson, shelby, knox"
            placeholderTextColor={COLORS.textMuted}
          returnKeyType="next"
          blurOnSubmit
        />
          <Text maxFontSizeMultiplier={1.4} style={styles.helpText}>
            You'll receive leads for arrests in these counties only.
          </Text>
          <TouchableOpacity activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel="Save Profile"
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={save}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator color={COLORS.bgCard} />
              : <Text maxFontSizeMultiplier={1.4} style={styles.saveBtnText}>Save Profile</Text>
            }
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ── Accept confirmation modal ─────────────────────────────────────────────────
function AcceptModal({ lead, visible, onClose, onConfirm, loading }: any) {
  if (!lead) return null;
  const tier = bailTier(lead.bail_amount);
  return (
    <Modal visible={visible} animationType="fade" transparent
        onRequestClose={() => {}}>
      <View style={styles.overlay}>
        <View style={styles.confirmCard}>
          <Text maxFontSizeMultiplier={1.4} style={styles.confirmTitle}>Accept This Lead?</Text>

          <View style={styles.confirmDetail}>
            <Text maxFontSizeMultiplier={1.4} style={styles.confirmName}>{lead.name}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.confirmCharges}>{lead.charges}</Text>
            <View style={styles.confirmRow}>
              <Text maxFontSizeMultiplier={1.4} style={styles.confirmLabel}>Bail amount</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.confirmValue}>
                {lead.bail_amount > 0 ? `$${lead.bail_amount.toLocaleString()}` : 'TBD'}
              </Text>
            </View>
            <View style={styles.confirmRow}>
              <Text maxFontSizeMultiplier={1.4} style={styles.confirmLabel}>County</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.confirmValue}>{lead.county}, {lead.state}</Text>
            </View>
            <View style={[styles.confirmRow, styles.feeRow]}>
              <Text maxFontSizeMultiplier={1.4} style={styles.feeLabel}>Lead fee charged now</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.feeAmount}>{leadFeeLabel(lead.bail_amount)}</Text>
            </View>
          </View>

          <Text maxFontSizeMultiplier={1.4} style={styles.confirmNote}>
            Your card on file will be charged {leadFeeLabel(lead.bail_amount)}.
            Full contact info revealed immediately.
          </Text>

          <View style={styles.confirmBtns}>
            <TouchableOpacity style={styles.confirmCancel} onPress={onClose}
              accessibilityRole="button"
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.confirmCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.6}
              accessibilityLabel="on Confirm"
              style={[styles.confirmAccept, loading && { opacity: 0.6 }]}
              onPress={onConfirm}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color={COLORS.bgCard} size="small" />
                : <Text maxFontSizeMultiplier={1.4} style={styles.confirmAcceptText}>Charge {leadFeeLabel(lead.bail_amount)}</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function BondsmanDashboardScreen({ navigation }: ScreenProps): React.JSX.Element {
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);

  // Prevent screenshots on this sensitive screen
  React.useEffect(() => {
    ScreenCapture.preventScreenCaptureAsync().catch(() => {});
    return () => { ScreenCapture.allowScreenCaptureAsync().catch(() => {}); };
  }, []);

  // Mounted guard
  const mountedRef = React.useRef(true);
  React.useEffect(() => { return () => { mountedRef.current = false; }; }, []);
  const [leads, setLeads]         = useState<any[]>([]);
  const [profile, setProfile]     = useState<any>(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [showProfile, setShowProfile] = useState(false);
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [accepting, setAccepting] = useState(false);
  const [filterHours, setFilterHours] = useState(48);
  const [badgeStatus, setBadgeStatus] = useState<any>(null);
  const [badgeLoading, setBadgeLoading] = useState(false);
  const [availToggle, setAvailToggle] = React.useState<'accepting'|'limited'|'closed'>('accepting');

  const loadProfile = useCallback(async () => {
    try {
      const res = await api.get('/billing/bondsman/profile');
      setProfile(res.data?.profile);
      return res.data?.profile;
    } catch { return null; }
  }, []);

  const loadLeads = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setStatusMsg('');
    try {
      const res = await api.get('/billing/leads', {
        params: { hours: filterHours, limit: 50 }
      });
      setLeads(res.data?.leads || []);
      if ((res.data?.leads || []).length === 0) {
        setStatusMsg('No new leads in the last ' + filterHours + ' hours.');
      }
    } catch (e: any) {
      setStatusMsg('Could not load leads. Pull down to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filterHours]);

  useEffect(() => {
    // Check auth on mount -- browsing users shown sign-in prompt
    secureStorage.getToken().then(token => {
      if (!token) {
        setLoading(false);
        // Will show AuthGateModal via requireAuth when they tap any action
      } else {
        loadProfile().then(p => { if (!p) setShowProfile(true); });
        loadLeads();
        api.get('/billing/bondsman/verified-badge/status')
          .then(r => setBadgeStatus(r.data || null))
          .catch((e) => { __DEV__ && console.warn(e?.message); });
      }
    });
  }, []);

  useEffect(() => { loadLeads(); }, [filterHours]);

  const handleAccept = (lead: Record<string,unknown>) => requireAuth(() => setSelectedLead(lead));

  const handleBadgeSubscribe = () => requireAuth(async () => {
    setBadgeLoading(true);
    try {
      const res = await api.post('/billing/bondsman/verified-badge/subscribe');
      setBadgeStatus({ active: true, verified_badge: true });
      Alert.alert('✅ Badge Activated!', res.data?.message);
    } catch (e: any) {
      Alert.alert('Connection issue', 'Check your internet and pull down to refresh.');
    } finally { setBadgeLoading(false); }
  });

  const handleBadgeCancel = () => {
    Alert.alert('Cancel Badge?', 'Your "Verified by Justice Gavel" badge will be removed from all listings.', [
      { text: 'Keep Badge', style: 'cancel' },
      { text: 'Cancel Badge', style: 'destructive', onPress: async () => {
        try {
          await api.post('/billing/bondsman/verified-badge/cancel');
          setBadgeStatus({ active: false, verified_badge: false });
          Alert.alert('Cancelled', 'Badge subscription cancelled.');
        } catch (e: any) {
          Alert.alert('Connection issue', 'Check your internet and pull down to refresh.');
        }
      }},
    ]);
  };

  const confirmAccept = async () => {
    if (!selectedLead) return;
    setAccepting(true);
    try {
      const res = await api.post(`/billing/leads/${selectedLead.id}/accept`, {});
      setSelectedLead(null);
      Alert.alert(
        '✅ Lead Accepted',
        `Charged ${res.data?.fee_charged}. Contact info revealed below.`,
        [{ text: 'OK' }]
      );
      loadLeads(true);
    } catch (e: any) {
      Alert.alert('Payment issue', 'Could not process payment. Check your card details and try again.');
    } finally {
      setAccepting(false);
    }
  };

  const totalLeads    = leads.length;
  const purchasedLeads = leads.filter(l => l.purchased).length;
  const highValueLeads = leads.filter(l => l.bail_amount >= 25000).length;

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.4} style={styles.heading}>Lead Dashboard</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.subheading}>
            {profile?.company_name || 'Bail Bondsman Portal'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Go to CheckInManager"
            style={styles.checkInMgrBtn}
            onPress={() => navigation.navigate('CheckInManager')}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.checkInMgrBtnText}>📋 Check-Ins</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.checkInMgrBtn, { backgroundColor: '#042C53' }]}
            onPress={() => {
              hapticImpact();
              navigation.navigate('RecoveryAgents');
            }}
            accessibilityRole="button"
            accessibilityLabel="Find recovery agents for skip apprehension"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.checkInMgrBtnText}>🔍 Recovery</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.profileBtn} onPress={() => setShowProfile(true)}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.profileBtnText}>⚙️</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Stats strip */}
      <View style={styles.statsStrip}>
        <View style={styles.statBlock}>
          <Text maxFontSizeMultiplier={1.4} style={styles.statNum}>{totalLeads}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.statLabel}>New leads</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBlock}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.statNum, { color: colors.emergencyDark }]}>{highValueLeads}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.statLabel}>High value</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBlock}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.statNum, { color: colors.legalDark }]}>{purchasedLeads}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.statLabel}>Purchased</Text>
        </View>
      </View>

      {/* Revenue + Performance stats */}
      <View style={{ flexDirection:'row', paddingHorizontal:12, paddingVertical:8, gap:8 }}>
        {[
          { label:'Accepted',   value: String(leads.filter((l: Record<string, unknown>) =>l.purchased).length),  color:colors.legalDark },
          { label:'Accept Rate', value: leads.length ? Math.round(leads.filter((l: Record<string, unknown>) =>l.purchased).length/leads.length*100)+'%' : '--', color:colors.blue },
          { label:'Avg Bail',   value: leads.length ? '$'+Math.round(leads.reduce((s: number, l: Record<string, unknown>)=>s+(l.bail_amount||0),0)/leads.length).toLocaleString() : '--', color:colors.warnDark },
          { label:'High Value', value: String(leads.filter((l: Record<string, unknown>) =>l.bail_amount>=25000).length), color:colors.navy },
        ].map((s,i) => (
          <View key={i} style={{ flex:1, backgroundColor:colors.bgCard, borderRadius:8,
            padding:8, alignItems:'center', borderWidth:1, borderColor:colors.border }}>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize:16, fontWeight:'800', color:s.color }}>{s.value}</Text>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize:10, color:colors.textMuted, marginTop:1, textAlign:'center' }}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Verified Badge Banner */}
      {badgeStatus !== null && (
        badgeStatus.active ? (
          <View style={styles.badgeBannerActive}>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={styles.badgeBannerTitle}>✓  Verified by Justice Gavel</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.badgeBannerSub}>Your listings show the verified badge · $48.99/month</Text>
            </View>
            <TouchableOpacity onPress={handleBadgeCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.badgeBannerCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            accessibilityLabel="Badge Subscribe"
            style={styles.badgeBannerPromo}
            onPress={handleBadgeSubscribe}
            disabled={badgeLoading}
            activeOpacity={0.85}
          >
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={styles.badgeBannerPromoTitle}>
                {badgeLoading ? 'Activating…' : '🏅  Get Verified by Justice Gavel'}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.badgeBannerPromoSub}>
                Show a trusted badge on your listings · Increases calls · $48.99/month
              </Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={styles.badgeBannerPromoArrow}>→</Text>
          </TouchableOpacity>
        )
      )}

      {/* Filter strip */}
      <View style={styles.filterStrip}>
        <Text maxFontSizeMultiplier={1.4} style={styles.filterLabel}>Show last:</Text>
        {[12, 24, 48, 72].map(h => (
          <TouchableOpacity
            accessibilityRole="button"
            key={h}
            style={[styles.filterChip, filterHours === h && styles.filterChipActive]}
            onPress={() => setFilterHours(h)}
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.filterChipText, filterHours === h && styles.filterChipTextActive]}>
              {h}h
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Lead list */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.warnDark} />
          <Text maxFontSizeMultiplier={1.4} style={styles.loadingText}>Loading leads...</Text>
        </View>
      ) : (
        <>
          {_fetchError && (
            <View style={{ backgroundColor: colors.errorBg, padding: 12, margin: 8, borderRadius: 8 }}>
              <Text maxFontSizeMultiplier={1.2} style={{ color: colors.emergency, fontSize: 13 }}>
                {_fetchError}
              </Text>
            </View>
          )}
        <FlatList
          getItemLayout={(_, index) => ({ length: 150, offset: 150 * index, index })}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
          data={leads}
          keyExtractor={i => String(i.id)}
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadLeads(true)} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text maxFontSizeMultiplier={1.4} style={styles.emptyIcon}>📋</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.emptyText}>{statusMsg || 'No leads right now.'}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.emptyHint}>Pull to refresh or change time filter above.</Text>
              {!statusMsg && (
                <View style={styles.howLeadsWork}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.howLeadsTitle}>How leads work</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.howLeadsItem}>• Leads appear when someone is arrested in your counties</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.howLeadsItem}>• Set your counties in ⚙️ Profile to receive relevant leads</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.howLeadsItem}>• Tap a lead → pay fee → get full contact info</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.howLeadsItem}>• New leads arrive within minutes of arrest booking</Text>
                </View>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <LeadCard lead={item} onAccept={handleAccept} />
          )}
        />
        </>
      )}

      {/* Modals */}
      <AuthGateModal />
      <ProfileModal
        visible={showProfile}
        onClose={() => setShowProfile(false)}
        onSaved={() => { setShowProfile(false); loadProfile(); }}
      />

      <AcceptModal
        lead={selectedLead}
        visible={!!selectedLead}
        onClose={() => setSelectedLead(null)}
        onConfirm={confirmAccept}
        loading={accepting}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },

  header: { backgroundColor: colors.emergency, paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 52 : 40, paddingBottom: 16, flexDirection: 'row', alignItems: 'flex-end' },
  heading: { fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', color: COLORS.bgCard },
  subheading: { fontSize: 12, lineHeight: 20, color: colors.emergency, marginTop: 2 },
  profileBtn: { padding: 8 },
  checkInMgrBtn: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  checkInMgrBtnText: { color: COLORS.bgCard, fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  profileBtnText: { fontSize: 22 },

  statsStrip: { backgroundColor: COLORS.bgCard, flexDirection: 'row', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: COLORS.bg, elevation: 1 },
  statBlock: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 28, fontFamily: 'Inter_900Black', fontWeight: '900', color: '#042C53' },
  statLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '600', marginTop: 2 },
  statDivider: { width: 1, backgroundColor: COLORS.bgSubtle, marginVertical: 4 },

  filterStrip: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.bgCard, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.bg, gap: 8 },
  filterLabel: { fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  filterChip: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5, borderColor: colors.surface, backgroundColor: COLORS.bgCard },
  filterChipActive: { borderColor: colors.emergency, backgroundColor: '#EF5350' },
  filterChipText: { fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  filterChipTextActive: { color: colors.emergency },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: Platform.OS === 'ios' ? 60 : 48 },
  loadingText: { marginTop: 12, color: colors.textMuted, fontSize: 14,
    lineHeight: 21},
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontSize: 15, lineHeight: 22, color: colors.textMuted, fontFamily: 'Inter_600SemiBold', fontWeight: '600', textAlign: 'center' },
  emptyHint: { fontSize: 12, color: colors.textMuted, marginTop: 8, textAlign: 'center' },

  card: { backgroundColor: COLORS.bgCard, borderRadius: 14, padding: 16, marginBottom: 10, elevation: 2, shadowColor: COLORS.bg, shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  cardPurchased: { borderWidth: 1.5, borderColor: colors.legal },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  leadName: { fontSize: 16, lineHeight: 24, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: '#042C53' },
  leadLocation: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  bailBlock: { alignItems: 'flex-end', marginLeft: 8 },
  bailAmount: { fontSize: 20, fontFamily: 'Inter_900Black', fontWeight: '900', color: colors.emergency },
  bailLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, backgroundColor: COLORS.bg },
  badgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', fontWeight: '600', color: colors.textMuted },
  purchasedBadge: { backgroundColor: colors.legal },
  charges: { fontSize: 12, color: colors.steel, marginBottom: 4, lineHeight: 16 },
  expandedSection: { marginTop: 10, borderTopWidth: 1, borderTopColor: COLORS.bg, paddingTop: 10 },
  detailRow: { fontSize: 12, color: colors.textMuted, marginBottom: 4, lineHeight: 18 },
  revealedBlock: { backgroundColor: colors.legal, borderRadius: 8, padding: 12, marginTop: 8 },
  revealedTitle: { fontSize: 12, lineHeight: 20, fontWeight: '700', color: colors.legal, marginBottom: 6 },
  revealedPhone: { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.legal, marginBottom: 4 },
  revealedName: { fontSize: 12, lineHeight: 20, color: colors.legal },
  acceptBtn: { backgroundColor: colors.emergency, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 10 },
  acceptBtnText: { color: COLORS.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 15,
    lineHeight: 22},
  acceptBtnSub: { color: colors.emergency, fontSize: 11, marginTop: 3 },
  expandHint: { fontSize: 12, color: colors.textMuted, textAlign: 'right', marginTop: 8 },

  badgeBannerActive: {
    backgroundColor: '#042C53', flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#042C53'},
  badgeBannerTitle:  { color: '#85B7EB', fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 12 },
  badgeBannerSub:    { color: colors.blue, fontSize: 11, marginTop: 1 },
  badgeBannerCancel: { color: '#EF5350', fontSize: 12, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  badgeBannerPromo: {
    backgroundColor: '#FFA726', flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#F9A825'},
  badgeBannerPromoTitle:  { color: '#FFA726', fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 12 },
  badgeBannerPromoSub:    { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  badgeBannerPromoArrow:  { fontSize: 18, color: '#FFA726', fontFamily: 'Inter_900Black', fontWeight: '900' },

  howLeadsWork: { backgroundColor: '#FFA726', borderRadius: 12, padding: 16, margin: 16, borderWidth: 1, borderColor: '#F9A825', alignSelf: 'stretch' },
  howLeadsTitle: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: '#FFA726', marginBottom: 8, textAlign: 'center' },
  howLeadsItem:  { fontSize: 12, color: colors.steel, lineHeight: 20 },
  // Profile modal
  modalContainer: { flex: 1, backgroundColor: COLORS.bg },
  modalHeader: { backgroundColor: colors.emergency, padding: 20, paddingTop: Platform.OS === 'ios' ? 52 : 40, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 20, fontFamily: 'Inter_900Black', fontWeight: '900', color: COLORS.bgCard },
  modalClose: { fontSize: 20, color: COLORS.bgCard, fontWeight: '600' },
  modalBody: { padding: 20 },
  fieldLabel: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.bgCard, marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: COLORS.bgCard, borderRadius: 8, borderWidth: 1.5, borderColor: colors.surface, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, lineHeight: 22, color: colors.bgCard },
  helpText: { fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 16 },
  saveBtn: { backgroundColor: colors.emergency, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 24 },
  saveBtnText: { color: COLORS.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 16,
    lineHeight: 24},

  // Accept confirm modal
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  confirmCard: { backgroundColor: COLORS.bgCard, borderRadius: 20, padding: 24, width: '100%', maxWidth: 400 },
  confirmTitle: { fontSize: 20, fontFamily: 'Inter_900Black', fontWeight: '900', color: '#042C53', marginBottom: 16, textAlign: 'center' },
  confirmDetail: { backgroundColor: COLORS.bg, borderRadius: 12, padding: 16, marginBottom: 14 },
  confirmName: { fontSize: 16, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.bgCard, marginBottom: 4 },
  confirmCharges: { fontSize: 12, color: colors.textMuted, marginBottom: 10, lineHeight: 16 },
  confirmRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  confirmLabel: { fontSize: 12, lineHeight: 20, color: colors.textMuted },
  confirmValue: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.bgCard },
  feeRow: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.bgSubtle },
  feeLabel: { fontSize: 14, lineHeight: 21, fontWeight: '700', color: colors.emergency },
  feeAmount: { fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', color: colors.emergency },
  confirmNote: { fontSize: 12, color: colors.textMuted, lineHeight: 17, marginBottom: 16, textAlign: 'center' },
  confirmBtns: { flexDirection: 'row', gap: 10 },
  confirmCancel: { flex: 1, paddingVertical: 16, borderRadius: 12, borderWidth: 1.5, borderColor: colors.surface, alignItems: 'center' },
  confirmCancelText: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.textMuted },
  confirmAccept: { flex: 1.5, paddingVertical: 16, borderRadius: 12, backgroundColor: colors.emergency, alignItems: 'center' },
  confirmAcceptText: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.bgCard },
  licenseBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.legal, borderRadius: 8, padding: 10,
    marginTop: 8, borderWidth: 1, borderColor: colors.legal},
  licenseBadgeIcon:   { fontSize: 20 },
  licenseBadgeLabel:  { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.legal, letterSpacing: 0.8, textTransform: 'uppercase' },
  licenseBadgeNum:    { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_900Black', fontWeight: '900', color: colors.legal },
  licenseVerifiedPill:{ marginLeft: 'auto', backgroundColor: colors.legal, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  licenseVerifiedText:{ fontSize: 11, color: COLORS.bgCard, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  licenseWarning: {
    backgroundColor: '#FFA726', borderRadius: 8, padding: 10,
    marginTop: 8, borderWidth: 1, borderColor: '#F9A825'},
  licenseWarningText: { fontSize: 12, color: '#FFA726', fontFamily: 'Inter_600SemiBold', fontWeight: '600' }});

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);
