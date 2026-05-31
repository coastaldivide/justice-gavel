import { CaseStatusBadge } from '../components/CaseStatusBadge';
/**
 * CaseTimelineScreen -- Chronological view of a case's events
 *
 * Shows a timeline of everything that has happened in a case:
 * arrest, bail being set, arraignment, hearings, motions, notes.
 * Users can add their own events. Events are stored in case_events.
 *
 * Navigated to from CaseScreen with params: { caseId, caseTitle }
 */
import React, { useState, useCallback, useRef } from 'react';
import { Alert, View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Modal, RefreshControl, Platform, ActivityIndicator, KeyboardAvoidingView} from 'react-native';
import { api } from '../services/api';
import {  useTheme, RADIUS, SHADOW, TYPE, FONTS, COLORS } from '../constants/theme';
import type { ScreenProps } from '../types/navigation';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
import { cacheTimeline, getCachedTimeline } from '../services/offlineCache';
import { useFocusEffect } from '@react-navigation/native';
import SkeletonLoader from '../components/SkeletonLoader';

const EVENT_ICONS: Record<string, string> = {
  arrest:          '🔒',
  bail_set:        '💰',
  arraignment:     '⚖️',
  hearing:         '🏛️',
  motion_filed:    '📄',
  continuance:     '📅',
  verdict:         '⚡',
  sentencing:      '📋',
  appeal:          '🔁',
  attorney_added:  '👔',
  document_added:  '📎',
  note:            '📝',
  other:           '•',
  status_change:   '🔄',
};

const EVENT_COLORS: Record<string, string> = {
  arrest:         COLORS.emergencyDark,
  bail_set:       COLORS.warnDark,
  arraignment:    COLORS.blue,
  hearing:        COLORS.blue,
  motion_filed:   COLORS.navy,
  continuance:    COLORS.warn,
  verdict:        COLORS.legalDark,
  sentencing:     COLORS.emergencyDark,
  appeal:         COLORS.blue,
  attorney_added: COLORS.legalDark,
  document_added: COLORS.warnDark,
  note:           COLORS.textMuted,
  other:          COLORS.textMuted,
  status_change:  COLORS.blue,
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  arrest:          'Arrest',
  bail_set:        'Bail Set',
  arraignment:     'Arraignment',
  hearing:         'Hearing',
  motion_filed:    'Motion Filed',
  continuance:     'Continuance',
  verdict:         'Verdict',
  sentencing:      'Sentencing',
  appeal:          'Appeal',
  attorney_added:  'Attorney Added',
  document_added:  'Document Added',
  note:            'Note',
  other:           'Event',
  status_change:   'Status Change',
};

interface CaseEvent {
  id: number;
  event_type: string;
  title: string;
  description: string | null;
  event_date: string | null;
  amount_cents: number | null;
  location: string | null;
  created_at: string;
}

function formatEventDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

function formatAmount(cents: number | null): string {
  if (!cents) return '';
  return ' · $' + (cents / 100).toLocaleString();
}


const EmptyState = ({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) => (
  <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 32 }}>
    <Text style={{ fontSize: 48, marginBottom: 16 }}>{icon}</Text>
    <Text style={{ fontSize: 18, fontWeight: '700', color: '#042C53', textAlign: 'center', marginBottom: 8 }}>{title}</Text>
    <Text style={{ fontSize: 14, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20 }}>{subtitle}</Text>
  </View>
);

export default function CaseTimelineScreen({ navigation, route }: ScreenProps): React.JSX.Element {

  // Schedule push reminder for a timeline event
  const scheduleEventReminder = async (event: CaseEvent) => {
    const dateStr = event.event_date || event.created_at;
    if (!dateStr) { return; }
    const eventDate = new Date(dateStr);
    const remind = new Date(eventDate);
    remind.setDate(remind.getDate() - 1); // 1 day before
    if (remind <= new Date()) {
      Alert.alert('Too soon', 'This event is too close to set a reminder.');
      return;
    }
    try {
      await api.post('/push/reminders', {
        title: '📋 Tomorrow: ' + event.title,
        body:  event.location ? `At ${event.location}` : 'Check your case details.',
        scheduled_for: remind.toISOString(),
        notification_type: 'court_reminder',
      });
      Alert.alert('Reminder set ✓', "You'll get a notification the day before.");
    } catch {
      Alert.alert('Could not set reminder', 'Make sure notifications are enabled.');
    }
  };

  const { caseId, caseTitle } = (route?.params ?? {}) as {
    caseId: number; caseTitle?: string;
  };

  const mountedRef = React.useRef(true);
  React.useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const { colors } = useTheme();
  const [_fetchError, _setFetchError] = useState<string|null>(null);
  const [events, setEvents]       = useState<CaseEvent[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd]     = useState(false);
  const [saving, setSaving]       = useState(false);

  // Add event form state
  const [newTitle, setNewTitle]   = useState('');
  const [newType, setNewType]     = useState('note');
  const [newDate, setNewDate]     = useState('');
  const [newDesc, setNewDesc]     = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [formError, setFormError] = useState('');

  const loadEvents = useCallback(async () => {
    if (!caseId) return;
    try {
      const res = await api.get(`/cases/${caseId}/events`);
      if (mountedRef.current) {
        const evts = res.data?.events || [];
        setEvents(evts);
        cacheTimeline(caseId, evts).catch(() => {});
      }
    } catch {
      if (mountedRef.current) {
        const cached = await getCachedTimeline(caseId).catch(() => null);
        if (cached?.data?.length) {
          setEvents(cached.data as any);
        } else {
          setEvents([]);
        }
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [caseId]);

  React.useEffect(() => { loadEvents(); }, [loadEvents]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadEvents();
    setRefreshing(false);
  }, [loadEvents]);

  const handleAdd = async () => {
    if (!newTitle.trim()) {
      setFormError('Enter a title for this event.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await hapticImpact();
      await api.post(`/cases/${caseId}/events`, {
        event_type:  newType,
        title:       newTitle.trim(),
        description: newDesc.trim() || null,
        event_date:  newDate.trim() || null,
        location:    newLocation.trim() || null,
      });
      await hapticNotification();
      setShowAdd(false);
      setNewTitle(''); setNewType('note'); setNewDate('');
      setNewDesc(''); setNewLocation('');
      await loadEvents();
    } catch {
      setFormError('Could not save event. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (eventId: number) => {
    Alert.alert(
      'Remove Event',
      'This will permanently remove this event from your timeline.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              setEvents(prev => prev.filter(e => e.id !== eventId));
              await api.delete(`/cases/${caseId}/events/${eventId}`);
            } catch (e: any) {
              // Rollback: re-fetch events to restore the deleted item
              setEvents(prev => prev);
              Alert.alert('Could not remove event', e?.response?.data?.error || 'Try again.');
            }
          },
        },
      ]
    );
  };

  const s = styles(colors as any);

  const renderItem = ({ item, index }: { item: CaseEvent; index: number }) => {
    const color = EVENT_COLORS[item.event_type] || EVENT_COLORS.textMuted;
    const icon  = EVENT_ICONS[item.event_type]  || '•';
    const label = EVENT_TYPE_LABELS[item.event_type] || 'Event';
    const isLast = index === events.length - 1;

    return (
      <View style={s.eventRow}
        testID="case-timeline-screen">
        {/* Timeline line */}
        <View style={s.timelineCol}>
          <View style={[s.dot, { backgroundColor: color }]}>
            <Text maxFontSizeMultiplier={1.4} style={s.dotIcon}>{icon}</Text>
          </View>
          {!isLast && <View style={[s.line, { backgroundColor: colors.border }]} />}
        </View>

        {/* Content */}
        <TouchableOpacity
          accessibilityRole="button"
          style={[s.eventCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
          onLongPress={() => {
              if (item.id < 0) return; // auto-generated -- not deletable
              Alert.alert(
                item.title.slice(0, 40),
                'What would you like to do?',
                [
                  { text: '🔔 Set Reminder', onPress: () => scheduleEventReminder(item) },
                  { text: '🗑️ Remove Event', style: 'destructive', onPress: () => handleDelete(item.id) },
                  { text: 'Cancel', style: 'cancel' },
                ]
              );
            }}
          accessibilityLabel={`${label}: ${item.title}. Long press to remove.`}
          accessibilityHint={item.id < 0 ? "Auto-recorded status change" : "Long press for options"}
          activeOpacity={0.85}
        >
          <View style={s.eventHeader}>
            <View style={[s.typePill, { backgroundColor: color + '18', borderColor: color + '40' }]}>
              <Text maxFontSizeMultiplier={1.4} style={[s.typeText, { color }]}>{label}</Text>
            </View>
            {(item.event_date || item.created_at) && (
              <Text maxFontSizeMultiplier={1.4} style={[s.dateText, { color: colors.textMuted }]}>
                {formatEventDate(item.event_date || item.created_at)}
              </Text>
            )}
          </View>
          <Text maxFontSizeMultiplier={1.4} style={[s.eventTitle, { color: colors.textPrimary }]}>
            {item.title}
            {formatAmount(item.amount_cents)}
          </Text>
          {!!item.location && (
            <Text maxFontSizeMultiplier={1.4} style={[s.eventMeta, { color: colors.textMuted }]}>
              📍 {item.location}
            </Text>
          )}
          {!!item.description && (
            <Text maxFontSizeMultiplier={1.4} style={[s.eventDesc, { color: colors.textSecond }]}
              numberOfLines={3}>
              {item.description}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    );
  };


  // Refresh data whenever user navigates back to this screen
  useFocusEffect(
    useCallback(() => {
      loadEvents();
    }, [loadEvents])
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}>
    <View style={[s.screen, { backgroundColor: colors.bg }]}>
      {loading && !events.length && (
        <View style={{ flex:1, justifyContent:'center', alignItems:'center' }}>
          <ActivityIndicator size="large" color={colors.navy} />
          <Text maxFontSizeMultiplier={1.4} style={{ marginTop:12, fontSize:13,
            lineHeight:19, color:colors.textMuted }}>
            Loading timeline…
          </Text>
        </View>
      )}

          {_fetchError && (
            <View style={{ backgroundColor: colors.errorBg, padding: 12, margin: 8, borderRadius: 8 }}>
              <Text maxFontSizeMultiplier={1.2} style={{ color: colors.emergency, fontSize: 13 }}>
                {_fetchError}
              </Text>
            </View>
          )}
      <FlatList
          keyboardShouldPersistTaps="handled"
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews={true}
        data={events}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh}
            tintColor={colors.navy} />
        }
        ListHeaderComponent={
          <View style={s.header}>
            <Text maxFontSizeMultiplier={1.4} style={[s.headerTitle, { color: colors.textPrimary }]}>
              {caseTitle || 'Case'} Timeline
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[s.headerSub, { color: colors.textMuted }]}>
              {events.length} event{events.length !== 1 ? 's' : ''} · Long press any event to remove
            </Text>
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <View style={s.empty}>
              <Text maxFontSizeMultiplier={1.4} style={[s.emptyIcon]}>📋</Text>
              <Text maxFontSizeMultiplier={1.4} style={[s.emptyTitle, { color: colors.textPrimary }]}>
                No events yet
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={[s.emptySub, { color: colors.textMuted }]}>
                Tap + Add Event to start your case timeline.{'\n'}
                Track arrests, bail, hearings, and more.
              </Text>
            </View>
          ) : null
        }
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
      />

      {/* Add event FAB */}
      <TouchableOpacity
        accessibilityRole="button"
        style={[s.fab, { backgroundColor: colors.navy }]}
        accessibilityLabel="+ Add Event" onPress={() => setShowAdd(true)}
        activeOpacity={0.85}
      >
        <Text maxFontSizeMultiplier={1.4} style={s.fabText}>+ Add Event</Text>
      </TouchableOpacity>

      {/* Add event modal */}
      <Modal accessibilityViewIsModal={true} visible={showAdd} animationType="slide" transparent presentationStyle="overFullScreen"
        onRequestClose={() => setShowAdd(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { backgroundColor: colors.bgCard }]}>
            <Text maxFontSizeMultiplier={1.4} style={[s.modalTitle, { color: colors.textPrimary }]}>
              Add Event
            </Text>

            {/* Event type pills */}
            <View style={s.typePills}>
              {['arrest','bail_set','arraignment','hearing','motion_filed',
                'continuance','verdict','note','other'].map(t => (
                <TouchableOpacity
          accessibilityRole="button" key={t}
                  onPress={() => setNewType(t)}
                  style={[s.typePillBtn, {
                    backgroundColor: newType===t ? (EVENT_COLORS[t]||colors.navy) : colors.bgSubtle,
                    borderColor:     newType===t ? (EVENT_COLORS[t]||colors.navy) : colors.border,
                  }]}
                >
                  <Text maxFontSizeMultiplier={1.4} style={{
                    fontSize:11, lineHeight:18, fontWeight:'700',
                    color: newType===t ? colors.bgCard : colors.textMuted,
                  }}>
                    {EVENT_ICONS[t]} {EVENT_TYPE_LABELS[t]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={[s.input, { backgroundColor:colors.inputBg, borderColor:colors.inputBorder,
                color:colors.inputText }]}
              placeholder="Event title (required)"
              placeholderTextColor={colors.placeholder}
              value={newTitle}
              onChangeText={setNewTitle}
              maxLength={200}
              returnKeyType="next"
              blurOnSubmit={false}
              accessibilityLabel="Event title"
            />
            <TextInput
              style={[s.input, { backgroundColor:colors.inputBg, borderColor:colors.inputBorder,
                color:colors.inputText }]}
              placeholder="Date (e.g. 2026-05-14) -- optional"
              placeholderTextColor={colors.placeholder}
              value={newDate}
              onChangeText={setNewDate}
              keyboardType="numbers-and-punctuation"
              maxLength={20}
              returnKeyType="next"
              blurOnSubmit={false}
              accessibilityLabel="Event date"
            />
            <TextInput
              style={[s.input, { backgroundColor:colors.inputBg, borderColor:colors.inputBorder,
                color:colors.inputText }]}
              placeholder="Location or court name -- optional"
              placeholderTextColor={colors.placeholder}
              value={newLocation}
              onChangeText={setNewLocation}
              maxLength={200}
              returnKeyType="next"
              blurOnSubmit={false}
              accessibilityLabel="Event location"
            />
            <TextInput
              style={[s.input, s.descInput, { backgroundColor:colors.inputBg,
                borderColor:colors.inputBorder, color:colors.inputText }]}
              placeholder="Notes or description -- optional"
              placeholderTextColor={colors.placeholder}
              value={newDesc}
              onChangeText={setNewDesc}
              multiline
              numberOfLines={3}
              maxLength={1000}
              accessibilityLabel="Event notes"
            />

            {!!formError && (
              <Text maxFontSizeMultiplier={1.4} style={[s.errorText, { color: colors.emergency }]}>
                {formError}
              </Text>
            )}
            <View style={s.modalButtons}>
              <TouchableOpacity
                accessibilityRole="button" style={[s.cancelBtn, { borderColor: colors.border }]}
                onPress={() => { setShowAdd(false); setFormError(''); }}>
                <Text maxFontSizeMultiplier={1.4} style={[s.cancelBtnText, { color: colors.textMuted }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                style={[s.saveBtn, { backgroundColor: saving ? colors.bgSubtle : colors.navy }]}
                onPress={handleAdd}
                disabled={saving}
                accessibilityLabel="Save event"
                activeOpacity={0.85}
              >
                <Text maxFontSizeMultiplier={1.4} style={[s.saveBtnText,
                  { color: saving ? colors.textMuted : colors.bgCard }]}>
                  {saving ? 'Saving…' : 'Save Event'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = (C: Record<string, string>) => StyleSheet.create({
  screen:       { flex:1 },
  list:         { padding:16, paddingBottom:100 },
  header:       { marginBottom:20 },
  headerTitle:  { fontSize:TYPE['2xl'], lineHeight:34, ...FONTS.black },
  headerSub:    { fontSize:TYPE.sm, lineHeight:18, marginTop:4 },

  eventRow:     { flexDirection:'row', gap:12, marginBottom:4 },
  timelineCol:  { alignItems:'center', width:40 },
  dot:          { width:36, height:36, borderRadius:18, alignItems:'center',
                  justifyContent:'center', flexShrink:0 },
  dotIcon:      { fontSize:16 },
  line:         { width:2, flex:1, marginTop:4, borderRadius:1 },

  eventCard:    { flex:1, borderRadius:RADIUS.md, borderWidth:1, padding:12, marginBottom:8 },
  eventHeader:  { flexDirection:'row', justifyContent:'space-between', alignItems:'center',
                  marginBottom:6, gap:8, flexWrap:'wrap' },
  typePill:     { borderRadius:RADIUS.pill, borderWidth:1, paddingHorizontal:8, paddingVertical:2 },
  typeText:     { fontSize:TYPE.xs, lineHeight:16, ...FONTS.bold },
  dateText:     { fontSize:TYPE.xs, lineHeight:16 },
  eventTitle:   { fontSize:TYPE.base, lineHeight:21, ...FONTS.semiBold, marginBottom:4 },
  eventMeta:    { fontSize:TYPE.xs, lineHeight:16, marginBottom:4 },
  eventDesc:    { fontSize:TYPE.sm, lineHeight:18, marginTop:2 },

  empty:        { alignItems:'center', paddingTop:60, paddingHorizontal:32 },
  emptyIcon:    { fontSize:48, marginBottom:16 },
  emptyTitle:   { fontSize:TYPE.lg, lineHeight:27, ...FONTS.semiBold, marginBottom:8 },
  emptySub:     { fontSize:TYPE.base, lineHeight:21, textAlign:'center' },

  fab:          { position:'absolute', bottom: Platform.OS==='ios'?32:20,
                  right:20, borderRadius:28, paddingHorizontal:20, paddingVertical:14,
                  flexDirection:'row', alignItems:'center', gap:6, ...SHADOW.md },
  fabText:      { fontSize:TYPE.base, lineHeight:21, color:COLORS.bgCard, ...FONTS.bold },

  modalOverlay: { flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'flex-end' },
  modalSheet:   { borderTopLeftRadius:20, borderTopRightRadius:20, padding:20,
                  paddingBottom: Platform.OS==='ios'?36:20 },
  modalTitle:   { fontSize:TYPE.xl, lineHeight:33, ...FONTS.bold, marginBottom:16 },
  typePills:    { flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:16 },
  typePillBtn:  { borderRadius:RADIUS.pill, borderWidth:1, paddingHorizontal:10, paddingVertical:5 },
  input:        { borderWidth:1, borderRadius:RADIUS.md, paddingHorizontal:14, paddingVertical:11,
                  fontSize:TYPE.base, lineHeight:21, marginBottom:10 },
  descInput:    { height:80, textAlignVertical:'top' },
  errorText:    { fontSize:TYPE.sm, lineHeight:18, marginBottom:8, marginTop:-4 },
  modalButtons: { flexDirection:'row', gap:12, marginTop:4 },
  cancelBtn:    { flex:1, borderWidth:1, borderRadius:RADIUS.md, paddingVertical:14,
                  alignItems:'center' },
  cancelBtnText:{ fontSize:TYPE.base, lineHeight:21, ...FONTS.semiBold },
  saveBtn:      { flex:2, borderRadius:RADIUS.md, paddingVertical:14, alignItems:'center' },
  saveBtnText:  { fontSize:TYPE.base, lineHeight:21, ...FONTS.bold },
});
