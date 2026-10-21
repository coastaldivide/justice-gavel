import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../components/ToastProvider';
import { AppIcon, IconLabel, ICONS } from '../components/AppIcon';
/**
 * CaseTimelineScreen -- Chronological view of a case's events
 *
 * Shows a timeline of everything that has happened in a case:
 * arrest, bail being set, arraignment, hearings, motions, notes.
 * Users can add their own events. Events are stored in case_events.
 *
 * Navigated to from CaseScreen with params: { caseId, caseTitle }
 */
import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, RefreshControl, Platform, ActivityIndicator, KeyboardAvoidingView, LayoutAnimation, InteractionManager } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { api, apiErrorMessage } from '../services/api';
import { scheduleReminder, localReminderInstant, formatReminderTime } from '../services/reminders';
import {  useTheme, RADIUS, SHADOW, TYPE, FONTS, COLORS } from '../constants/theme';
import type { ScreenProps } from '../types/navigation';
import { hapticImpact, hapticNotification } from '../utils/webCompat';
import { cacheTimeline, getCachedTimeline } from '../services/offlineCache';
import { useFocusEffect } from '@react-navigation/native';
import { formatDate } from '../utils/dateUtils';
import { getToken } from '../utils/secureStorage';
import { SignInNeeded } from '../components/SignInNeeded';
import { t, perLang, useLang, locale } from '../i18n';

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

const EVENT_TYPE_LABELS = perLang((): Record<string, string> => ({
  arrest:          t('whn_dui_1_title'),
  bail_set:        t('x_case_timeline_bail_set'),
  arraignment:     t('whn_dui_3_title'),
  hearing:         t('x_case_timeline_hearing'),
  motion_filed:    t('x_case_timeline_motion_filed'),
  continuance:     t('x_motion_type_badge_continuance'),
  verdict:         t('x_case_timeline_verdict'),
  sentencing:      t('hearing_sentencing'),
  appeal:          t('x_case_timeline_appeal'),
  attorney_added:  t('x_case_timeline_attorney_added'),
  document_added:  t('x_case_timeline_document_added'),
  note:            t('note'),
  other:           t('x_case_timeline_event'),
  status_change:   t('x_case_timeline_status_change'),
}));

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

/** An event date is a calendar day: shown as that day in every time zone (never shifted by UTC). */
export function formatEventDate(dateStr: string | null): string {
  if (!dateStr) return '';
  return formatDate(String(dateStr).slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatAmount(cents: number | null): string {
  if (!cents) return '';
  return ' · ' + (cents / 100).toLocaleString(locale(), { style: 'currency', currency: 'USD' });
}



function CaseTimelineScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { confirm } = useConfirm();
  const { showToast } = useToast();

  // Schedule push reminder for a timeline event
  const scheduleEventReminder = async (event: CaseEvent) => {
    const dateStr = event.event_date || event.created_at;
    if (!dateStr) { return; }
    // Event dates are calendar days: remind at 9:00 local the day before.
    const remind = localReminderInstant(String(dateStr).slice(0, 10), 1, 9, 0);
    if (!remind || remind <= new Date()) {
      showToast(t('x_case_timeline_this_event_too_close'));
      return;
    }
    try {
      await scheduleReminder({
        title: t('x_case_timeline_tomorrow', { title: event.title }),
        body:  event.location ? t('x_case_timeline_at', { location: event.location }) : t('x_case_timeline_check_case_details'),
        deliverAt: remind,
        caseId,
      });
      showToast(t('x_case_timeline_reminder_set', { value: formatReminderTime(remind.toISOString()) }), 'info');
    } catch (e: any) {
      showToast(apiErrorMessage(e, t('x_case_timeline_could_not_set_reminder')), 'error');
    }
  };

  const { caseId, caseTitle } = (route?.params ?? {}) as {
    caseId: number; caseTitle?: string;
  };

  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    const task = InteractionManager.runAfterInteractions(() => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    });
    return () => { mountedRef.current = false; task.cancel(); };
  }, []);

  const { colors } = useTheme();
  const [fetchError, setFetchError] = useState<string | null>(null);
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
  const [signedOut, setSignedOut] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const loadEvents = useCallback(async () => {
    if (!caseId) return;
    if (!(await getToken().catch(() => null))) {
      if (mountedRef.current) { setSignedOut(true); setLoading(false); }
      return;
    }
    if (mountedRef.current) setSignedOut(false);
    try {
      const res = await api.get(`/cases/${caseId}/events`);
      if (mountedRef.current) {
        const evts = res.data?.events || [];
        setEvents(evts);
        setFetchError(null);
        cacheTimeline(caseId, evts).catch(() => {});
      }
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 403 || status === 404) { if (mountedRef.current) { setUnavailable(true); setEvents([]); setFetchError(null); } return; }
      if (mountedRef.current) {
        const cached = await getCachedTimeline(caseId).catch(() => null);
        if (cached?.data?.length) {
          setEvents(cached.data as any);
          setFetchError(t('x_case_timeline_offline_saved'));
        } else {
          setFetchError(apiErrorMessage(e, t('x_case_timeline_could_not_load')));
        }
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [caseId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadEvents();
    setRefreshing(false);
  }, [loadEvents]);

  const handleAdd = async () => {
    if (!newTitle.trim()) {
      setFormError(t('x_case_timeline_enter_title_this_event'));
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
    } catch (e) {
      setFormError(apiErrorMessage(e, t('x_case_timeline_could_not_save_event')));
    } finally {
      setSaving(false);
    }
  };

  // Optimistically remove an event; restore the list from the server on failure.
  const removeEvent = async (eventId: number) => {
    setEvents(prev => prev.filter(e => e.id !== eventId));
    try {
      await api.delete(`/cases/${caseId}/events/${eventId}`);
    } catch (e: any) {
      showToast(apiErrorMessage(e, t('x_case_timeline_could_not_remove_event')), 'error');
      loadEvents();
    }
  };

  const s = styles();

  const renderItem = ({ item, index }: { item: CaseEvent; index: number }) => {
    const color = EVENT_COLORS[item.event_type] || EVENT_COLORS.textMuted;
    const icon  = EVENT_ICONS[item.event_type]  || '•';
    const label = EVENT_TYPE_LABELS()[item.event_type] || t('x_case_timeline_event');
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
              confirm(item.title.slice(0, 40), t('x_case_timeline_set_reminder_remove_this'),
                { confirmLabel: t('x_case_timeline_remove_event'), cancelLabel: t('x_case_timeline_set_reminder'), destructive: true }).then(ok => {
                  if (ok) removeEvent(item.id); else scheduleEventReminder(item);
                });
            }}
          accessibilityLabel={t('x_case_timeline_long_press_remove', { label, title: item.title })}
          accessibilityHint={item.id < 0 ? t('x_case_timeline_auto_recorded_status_change') : t('x_case_timeline_long_press_options')}
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
            <IconLabel icon={ICONS.location} textStyle={[s.eventMeta, { color: colors.textMuted }]} maxFontSizeMultiplier={1.4}>{item.location}</IconLabel>
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
      {signedOut ? <SignInNeeded navigation={navigation} testID="timeline-sign-in" body={t('sin_case_body')} onSignedIn={loadEvents} />
        : unavailable ? (
          <View testID="timeline-unavailable" style={s.unavailable}>
            <IconLabel icon={ICONS.lock} textStyle={s.unavailableIcon} maxFontSizeMultiplier={1.4}></IconLabel>
            <Text maxFontSizeMultiplier={1.4} style={[s.unavailableTitle, { color: colors.textPrimary }]}>{t('case_unavailable_title')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[s.unavailableBody, { color: colors.textSecond }]}>{t('case_unavailable_body')}</Text>
          </View>
        ) : (<>
      {loading && !events.length && (
        <View style={{ flex:1, justifyContent:'center', alignItems:'center' }}>
          <ActivityIndicator size="large" color={colors.navy} />
          <Text maxFontSizeMultiplier={1.4} style={{ marginTop:12, fontSize:13,
            lineHeight:19, color:colors.textMuted }}>
            {t('x_case_timeline_loading_timeline')}
          </Text>
        </View>
      )}

          {!!fetchError && (
            <View style={{ backgroundColor: colors.errorBg, padding: 12, margin: 8, borderRadius: 8 }}>
              <Text maxFontSizeMultiplier={1.2} style={{ color: colors.emergency, fontSize: 13 }}>
                {fetchError}
              </Text>
            </View>
          )}
      <FlashList
          keyboardShouldPersistTaps="handled"
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
              {t('x_case_timeline_timeline', { value: caseTitle || t('cd_case') })}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[s.headerSub, { color: colors.textMuted }]}>
              {t(events.length === 1 ? 'x_case_timeline_event_long_press_any_one' : 'x_case_timeline_event_long_press_any_other', { length: events.length })}
            </Text>
          </View>
        }
        ListEmptyComponent={
          !loading && !fetchError ? (
            <View style={s.empty}>
              <AppIcon name="document-text-outline" size={20} color={COLORS.navy} />
              <Text maxFontSizeMultiplier={1.4} style={[s.emptyTitle, { color: colors.textPrimary }]}>
                {t('x_case_timeline_no_events_yet')}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={[s.emptySub, { color: colors.textMuted }]}>
                {t('x_case_timeline_tap_add_event_start')}
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
        accessibilityLabel={t('x_case_timeline_add_event')} onPress={() => setShowAdd(true)}
        activeOpacity={0.85}
      >
        <Text maxFontSizeMultiplier={1.4} style={s.fabText}>{t('x_case_timeline_add_event')}</Text>
      </TouchableOpacity>
      </>)}

      {/* Add event modal */}
      <Modal accessibilityViewIsModal={true} visible={showAdd} animationType="slide" transparent presentationStyle="overFullScreen"
        onRequestClose={() => setShowAdd(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { backgroundColor: colors.bgCard }]}>
            <Text maxFontSizeMultiplier={1.4} style={[s.modalTitle, { color: colors.textPrimary }]}>
              {t('x_case_timeline_add_event_2')}
            </Text>

            {/* Event type pills */}
            <View style={s.typePills}>
              {['arrest','bail_set','arraignment','hearing','motion_filed',
                'continuance','verdict','note','other'].map(tItem => (
                <TouchableOpacity
          accessibilityRole="button" key={tItem}
                  onPress={() => setNewType(tItem)}
                  style={[s.typePillBtn, {
                    backgroundColor: newType===tItem ? (EVENT_COLORS[tItem]||colors.navy) : colors.bgSubtle,
                    borderColor:     newType===tItem ? (EVENT_COLORS[tItem]||colors.navy) : colors.border,
                  }]}
                >
                  <Text maxFontSizeMultiplier={1.4} style={{
                    fontSize:11, lineHeight:18, fontWeight:'700',
                    color: newType===tItem ? colors.bgCard : colors.textMuted,
                  }}>
                    {EVENT_ICONS[tItem]} {EVENT_TYPE_LABELS()[tItem]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={[s.input, { backgroundColor:colors.inputBg, borderColor:colors.inputBorder,
                color:colors.inputText }]}
              placeholder={t('x_case_timeline_event_title_required')}
              placeholderTextColor={colors.placeholder}
              value={newTitle}
              onChangeText={setNewTitle}
              maxLength={200}
              returnKeyType="next"
              blurOnSubmit={false}
              accessibilityLabel={t('x_case_timeline_event_title')}
            />
            <TextInput
              style={[s.input, { backgroundColor:colors.inputBg, borderColor:colors.inputBorder,
                color:colors.inputText }]}
              placeholder={t('x_case_timeline_date_e_g_2026')}
              placeholderTextColor={colors.placeholder}
              value={newDate}
              onChangeText={setNewDate}
              keyboardType="numbers-and-punctuation"
              maxLength={20}
              returnKeyType="next"
              blurOnSubmit={false}
              accessibilityLabel={t('x_case_timeline_event_date')}
            />
            <TextInput
              style={[s.input, { backgroundColor:colors.inputBg, borderColor:colors.inputBorder,
                color:colors.inputText }]}
              placeholder={t('x_case_timeline_location_court_name_optional')}
              placeholderTextColor={colors.placeholder}
              value={newLocation}
              onChangeText={setNewLocation}
              maxLength={200}
              returnKeyType="next"
              blurOnSubmit={false}
              accessibilityLabel={t('x_case_timeline_event_location')}
            />
            <TextInput
              style={[s.input, s.descInput, { backgroundColor:colors.inputBg,
                borderColor:colors.inputBorder, color:colors.inputText }]}
              placeholder={t('x_case_timeline_notes_description_optional')}
              placeholderTextColor={colors.placeholder}
              value={newDesc}
              onChangeText={setNewDesc}
              multiline
              numberOfLines={3}
              maxLength={1000}
              accessibilityLabel={t('x_case_timeline_event_notes')}
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
                  {t('case_cancel')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                style={[s.saveBtn, { backgroundColor: saving ? colors.bgSubtle : colors.navy }]}
                onPress={handleAdd}
                disabled={saving}
                accessibilityLabel={t('x_case_timeline_save_event')}
                activeOpacity={0.85}
              >
                <Text maxFontSizeMultiplier={1.4} style={[s.saveBtnText,
                  { color: saving ? colors.textMuted : colors.bgCard }]}>
                  {saving ? t('x_attorney_dashboard_saving') : t('x_case_timeline_save_event_2')}
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

const styles = () => StyleSheet.create({
  screen:       { flex:1 },
  unavailable:  { alignItems:'center', padding:32, gap:10 },
  unavailableIcon: { fontSize:36 },
  unavailableTitle: { fontSize:18, fontWeight:'800', textAlign:'center' },
  unavailableBody: { fontSize:15, lineHeight:22, textAlign:'center' },
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
export default React.memo(CaseTimelineScreen);