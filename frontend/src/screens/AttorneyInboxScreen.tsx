/**
 * AttorneyInboxScreen — Unified attorney command center
 *
 * One screen that combines everything an attorney needs to see when they
 * open the app:
 *   • Today's consultations + hearings (time-sensitive)
 *   • Pending case assignments (needs acceptance)
 *   • Unread messages from clients (respond here)
 *   • Recent cases with unread badge counts
 *
 * Design principle: zero-friction. Attorney sees what needs action
 * and can act from this screen — mark read, accept assignment, open
 * case, join video call — without navigating anywhere else.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, StyleSheet, Alert, Linking,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme, COLORS, RADIUS } from '../constants/theme';
import { api } from '../services/api';
import { useToast } from '../components/ToastProvider';

// ── Types ─────────────────────────────────────────────────────────────────────
interface InboxSummary {
  unread_messages: number;
  today_events: number;
  pending_assignments: number;
  urgent_count: number;
}

interface Consultation {
  id: number;
  date_slot: string;
  time_slot: string;
  duration_min: number;
  status: string;
  meeting_link: string;
  notes: string;
  client_name: string;
  client_email: string;
  case_id: number | null;
  case_title: string | null;
  case_state: string | null;
}

interface UnreadMessage {
  id: number;
  case_id: number;
  body: string;
  sent_at: string;
  message_type: string;
  client_name: string;
  case_title: string;
  case_state: string;
  case_status: string;
}

interface Hearing {
  case_id: number;
  title: string;
  next_court_date: string;
  state: string;
  status: string;
  client_name: string;
  client_email: string;
  next_event: string | null;
}

interface PendingAssignment {
  assignment_id: number;
  assigned_at: string;
  referral_notes: string;
  case_id: number;
  title: string;
  state: string;
  status: string;
  next_court_date: string | null;
  client_name: string;
  client_email: string;
}

interface RecentCase {
  case_id: number;
  title: string;
  state: string;
  status: string;
  updated_at: string;
  next_court_date: string | null;
  client_name: string;
  unread_count: number;
}

interface InboxData {
  summary: InboxSummary;
  upcoming_consultations: Consultation[];
  unread_messages: UnreadMessage[];
  today_hearings: Hearing[];
  pending_assignments: PendingAssignment[];
  recent_cases: RecentCase[];
  fetched_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
  } catch { return iso; }
}

function fmtTime(t: string) {
  return t; // Already formatted e.g. "9:00 AM"
}

function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60)   return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)    return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AttorneyInboxScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const { showToast } = useToast();
  const styles = makeStyles(colors);

  const [data, setData]           = useState<InboxData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [accepting, setAccepting] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else           setLoading(true);
    try {
      const resp = await api.get('/attorney/inbox');
      setData(resp.data);
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Could not load inbox', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Poll every 60 seconds so unread count stays fresh
    pollRef.current = setInterval(() => load(), 60_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  const markRead = useCallback(async (caseId: number) => {
    try {
      await api.post(`/attorney/inbox/mark-read/${caseId}`);
      // Optimistically update the UI
      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          unread_messages: prev.unread_messages.filter(m => m.case_id !== caseId),
          recent_cases: prev.recent_cases.map(c =>
            c.case_id === caseId ? { ...c, unread_count: 0 } : c
          ),
          summary: {
            ...prev.summary,
            unread_messages: Math.max(0, prev.summary.unread_messages -
              prev.unread_messages.filter(m => m.case_id === caseId).length),
          },
        };
      });
    } catch { /* non-fatal */ }
  }, []);

  const acceptAssignment = useCallback(async (assignmentId: number) => {
    setAccepting(assignmentId);
    try {
      await api.post(`/attorney/inbox/accept/${assignmentId}`);
      showToast('Case accepted — client has been notified', 'success');
      // Remove from pending list
      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          pending_assignments: prev.pending_assignments.filter(
            a => a.assignment_id !== assignmentId
          ),
          summary: {
            ...prev.summary,
            pending_assignments: Math.max(0, prev.summary.pending_assignments - 1),
            urgent_count: Math.max(0, prev.summary.urgent_count - 1),
          },
        };
      });
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Could not accept assignment', 'error');
    } finally {
      setAccepting(null);
    }
  }, [showToast]);

  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.legal} />
        <Text style={{ color: colors.steel, marginTop: 12 }}>Loading inbox…</Text>
      </View>
    );
  }

  const summary = data?.summary;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: 48 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load(true)}
          tintColor={colors.legal} />
      }
    >
      {/* ── Summary badges ──────────────────────────────────────────────── */}
      <View style={styles.summaryRow}>
        <View style={[styles.badge, { backgroundColor: COLORS.navy }]}>
          <Text style={styles.badgeNum}>{summary?.unread_messages ?? 0}</Text>
          <Text style={styles.badgeLbl}>Unread</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: COLORS.danger }]}>
          <Text style={styles.badgeNum}>{summary?.today_events ?? 0}</Text>
          <Text style={styles.badgeLbl}>Today</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: '#F59E0B' }]}>
          <Text style={styles.badgeNum}>{summary?.pending_assignments ?? 0}</Text>
          <Text style={styles.badgeLbl}>Pending</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: COLORS.legal }]}>
          <Text style={styles.badgeNum}>{summary?.urgent_count ?? 0}</Text>
          <Text style={styles.badgeLbl}>Urgent</Text>
        </View>
      </View>

      {/* ── Pending assignments (needs action first) ─────────────────────── */}
      {(data?.pending_assignments?.length ?? 0) > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>⚠️  Pending Assignments</Text>
          {data!.pending_assignments.map(a => (
            <View key={a.assignment_id} style={[styles.card, styles.cardUrgent]}>
              <Text style={styles.cardTitle}>{a.title}</Text>
              <Text style={styles.cardMeta}>
                {a.client_name} · {a.state}
                {a.next_court_date ? ` · Hearing ${fmtDate(a.next_court_date)}` : ''}
              </Text>
              {!!a.referral_notes && (
                <Text style={styles.cardNotes} numberOfLines={2}>{a.referral_notes}</Text>
              )}
              <View style={styles.cardActions}>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={[styles.btn, styles.btnPrimary]}
                  onPress={() => acceptAssignment(a.assignment_id)}
                  disabled={accepting === a.assignment_id}
                >
                  {accepting === a.assignment_id
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.btnPrimaryText}>Accept Case</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={[styles.btn, styles.btnSecondary]}
                  onPress={() => navigation.navigate('AttorneyCase', { caseId: a.case_id })}
                >
                  <Text style={styles.btnSecondaryText}>View Details</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* ── Today's consultations + hearings ─────────────────────────────── */}
      {((data?.upcoming_consultations?.filter(
          c => c.date_slot === new Date().toISOString().slice(0,10)
        ).length ?? 0) + (data?.today_hearings?.length ?? 0)) > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>📅  Today</Text>
          {data!.today_hearings.map(h => (
            <View key={`h-${h.case_id}`} style={[styles.card, styles.cardToday]}>
              <Text style={styles.cardBadgeText}>🏛  HEARING</Text>
              <Text style={styles.cardTitle}>{h.title}</Text>
              <Text style={styles.cardMeta}>{h.client_name} · {h.state}</Text>
              {!!h.next_event && <Text style={styles.cardNotes}>{h.next_event}</Text>}
              <TouchableOpacity
                accessibilityRole="button"
                style={[styles.btn, styles.btnSecondary, { marginTop: 8 }]}
                onPress={() => navigation.navigate('Messages', { caseId: h.case_id })}
              >
                <Text style={styles.btnSecondaryText}>Open Case</Text>
              </TouchableOpacity>
            </View>
          ))}
          {data!.upcoming_consultations
            .filter(c => c.date_slot === new Date().toISOString().slice(0,10))
            .map(c => (
              <View key={`c-${c.id}`} style={[styles.card, styles.cardToday]}>
                <Text style={styles.cardBadgeText}>📹  CONSULTATION</Text>
                <Text style={styles.cardTitle}>{c.client_name}</Text>
                <Text style={styles.cardMeta}>
                  {fmtTime(c.time_slot)} · {c.duration_min} min
                  {c.case_title ? ` · ${c.case_title}` : ''}
                </Text>
                {!!c.notes && <Text style={styles.cardNotes} numberOfLines={2}>{c.notes}</Text>}
                <View style={styles.cardActions}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    style={[styles.btn, styles.btnPrimary]}
                    onPress={() => Linking.openURL(c.meeting_link)}
                  >
                    <Text style={styles.btnPrimaryText}>Join Video Call</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          }
        </View>
      )}

      {/* ── Unread messages ───────────────────────────────────────────────── */}
      {(data?.unread_messages?.length ?? 0) > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>💬  Unread Messages</Text>
          {data!.unread_messages.map(m => (
            <TouchableOpacity
              key={m.id}
              accessibilityRole="button"
              style={styles.card}
              onPress={() => {
                markRead(m.case_id);
                navigation.navigate('Messages', { caseId: m.case_id });
              }}
            >
              <View style={styles.cardRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{m.client_name}</Text>
                  <Text style={styles.cardMeta}>{m.case_title} · {fmtRelative(m.sent_at)}</Text>
                  <Text style={styles.cardNotes} numberOfLines={2}>{m.body}</Text>
                </View>
                <View style={styles.unreadDot} />
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Upcoming consultations (next 7 days) ─────────────────────────── */}
      {(data?.upcoming_consultations?.filter(
          c => c.date_slot !== new Date().toISOString().slice(0,10)
        ).length ?? 0) > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>🗓  Upcoming Consultations</Text>
          {data!.upcoming_consultations
            .filter(c => c.date_slot !== new Date().toISOString().slice(0,10))
            .map(c => (
              <View key={`uc-${c.id}`} style={styles.card}>
                <Text style={styles.cardTitle}>{c.client_name}</Text>
                <Text style={styles.cardMeta}>
                  {fmtDate(c.date_slot)} at {fmtTime(c.time_slot)} · {c.duration_min} min
                </Text>
                {!!c.case_title && <Text style={styles.cardMeta}>{c.case_title} · {c.case_state}</Text>}
              </View>
            ))
          }
        </View>
      )}

      {/* ── Recent cases ──────────────────────────────────────────────────── */}
      {(data?.recent_cases?.length ?? 0) > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>📁  Active Cases</Text>
          {data!.recent_cases.map(c => (
            <TouchableOpacity
              key={c.case_id}
              accessibilityRole="button"
              style={styles.card}
              onPress={() => navigation.navigate('Messages', { caseId: c.case_id })}
            >
              <View style={styles.cardRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{c.title}</Text>
                  <Text style={styles.cardMeta}>
                    {c.client_name} · {c.state} · {c.status}
                  </Text>
                  {c.next_court_date && (
                    <Text style={[styles.cardMeta, { color: '#F59E0B' }]}>
                      Next: {fmtDate(c.next_court_date)}
                    </Text>
                  )}
                </View>
                {c.unread_count > 0 && (
                  <View style={[styles.unreadBadge]}>
                    <Text style={styles.unreadBadgeText}>{c.unread_count}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {summary?.urgent_count === 0 &&
       (data?.recent_cases?.length ?? 0) === 0 && (
        <View style={styles.empty}>
          <Text style={{ fontSize: 40 }}>⚖️</Text>
          <Text style={styles.emptyTitle}>All caught up</Text>
          <Text style={styles.emptyBody}>
            No pending assignments, unread messages, or upcoming hearings.
          </Text>
        </View>
      )}

      <Text style={styles.fetchedAt}>
        Updated {data?.fetched_at ? fmtRelative(data.fetched_at) : '—'}
      </Text>
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const makeStyles = (colors: any) => StyleSheet.create({
  screen:      { flex: 1, backgroundColor: colors.bg },
  summaryRow:  { flexDirection: 'row', padding: 12, gap: 8 },
  badge:       { flex: 1, borderRadius: RADIUS.md, padding: 12, alignItems: 'center' },
  badgeNum:    { fontSize: 22, fontWeight: '800', color: '#fff' },
  badgeLbl:    { fontSize: 10, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  section:     { marginTop: 4 },
  sectionHeader: { fontSize: 13, fontWeight: '700', color: colors.steel,
                   paddingHorizontal: 16, paddingVertical: 8, letterSpacing: 0.5 },
  card:        { backgroundColor: colors.bgCard, marginHorizontal: 12,
                 marginBottom: 8, borderRadius: RADIUS.md, padding: 14 },
  cardUrgent:  { borderLeftWidth: 3, borderLeftColor: '#F59E0B' },
  cardToday:   { borderLeftWidth: 3, borderLeftColor: COLORS.legal },
  cardRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardTitle:   { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 2 },
  cardMeta:    { fontSize: 12, color: colors.steel, marginBottom: 2 },
  cardNotes:   { fontSize: 12, color: colors.steel, fontStyle: 'italic', marginTop: 4 },
  cardBadgeText: { fontSize: 10, fontWeight: '700', color: COLORS.legal,
                   letterSpacing: 0.8, marginBottom: 4 },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btn:         { flex: 1, paddingVertical: 9, borderRadius: RADIUS.sm, alignItems: 'center' },
  btnPrimary:  { backgroundColor: COLORS.navy },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  btnSecondary: { backgroundColor: colors.bgSubtle, borderWidth: 1, borderColor: colors.border },
  btnSecondaryText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  unreadDot:   { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.legal,
                 marginTop: 4, flexShrink: 0 },
  unreadBadge: { backgroundColor: COLORS.legal, borderRadius: 10,
                 minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center',
                 paddingHorizontal: 6, flexShrink: 0 },
  unreadBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  empty:       { flex: 1, alignItems: 'center', justifyContent: 'center',
                 paddingTop: 60, paddingHorizontal: 32 },
  emptyTitle:  { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 12 },
  emptyBody:   { fontSize: 13, color: colors.steel, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  fetchedAt:   { textAlign: 'center', fontSize: 10, color: colors.steel,
                 paddingTop: 12, paddingBottom: 4 },
});
