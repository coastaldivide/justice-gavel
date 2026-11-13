/**
 * ConversationMemory.tsx — "What the assistant remembers about this chat" (AI step 5).
 *
 * When a chat (or a research session) gets long, the server replaces its older turns with a short
 * recap of what the person told us (backend services/conversationMemory.js). This button opens
 * that recap: case stage, places, dates, what they said, what they asked — and "Forget this",
 * which deletes it and stops new recaps for this conversation.
 *   chat:     GET|DELETE /api/chat/memory/:sessionId
 *   research: GET|DELETE /api/research/session/:id/memory
 */
import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { api, apiErrorMessage } from '../services/api';
import { useTheme } from '../constants/theme';
import { useToast } from './ToastProvider';
import { useConfirm } from '../hooks/useConfirm';
import { t } from '../i18n';

export type Recap = {
  case_stage: string;
  places: string[];
  dates: { what: string; date: string }[];
  facts: string[];
  asked: string[];
};
export type MemoryView = {
  enabled: boolean;
  remembered: boolean;
  forgotten: boolean;
  recap: Recap | null;
  covered_turns: number;
  updated_at: string | null;
};

export const memoryPath = (kind: 'chat' | 'research', id: string | number) =>
  kind === 'chat' ? `/chat/memory/${encodeURIComponent(String(id))}` : `/research/session/${encodeURIComponent(String(id))}/memory`;

export default function ConversationMemory({ kind, conversationId, testID = 'memory' }: { kind: 'chat' | 'research'; conversationId: string | number | null; testID?: string }) {
  const { colors } = useTheme();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<MemoryView | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (conversationId == null || conversationId === '') return;
    setLoading(true); setFailed(false);
    try {
      const r = await api.get<MemoryView>(memoryPath(kind, conversationId));
      setView(r.data);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [kind, conversationId]);

  const onOpen = () => { setOpen(true); load(); };

  const forget = async () => {
    if (conversationId == null || conversationId === '') return;
    const ok = await confirm(t('mem_delete_title'), t('mem_delete_body'), { confirmLabel: t('mem_delete'), destructive: true });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.delete<MemoryView>(memoryPath(kind, conversationId));
      setView(r.data && typeof r.data === 'object' && 'forgotten' in r.data ? r.data : { enabled: true, remembered: false, forgotten: true, recap: null, covered_turns: 0, updated_at: null });
      showToast(t('mem_deleted'), 'success');
    } catch (e) {
      showToast(apiErrorMessage(e, t('mem_load_failed')), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (conversationId == null || conversationId === '') return null;
  const recap = view?.recap;
  const section = (title: string, items: string[], id: string) => (items.length ? (
    <View style={styles.section} testID={`${testID}-${id}`}>
      <Text maxFontSizeMultiplier={1.4} style={[styles.sectionTitle, { color: colors.textPrimary }]}>{title}</Text>
      {items.map((x, i) => <Text key={i} maxFontSizeMultiplier={1.4} style={[styles.item, { color: colors.textPrimary }]}>• {x}</Text>)}
    </View>
  ) : null);

  return (
    <>
      <TouchableOpacity accessibilityRole="button" testID={`${testID}-open`} onPress={onOpen} style={[styles.openBtn, { borderColor: colors.border }]}
        accessibilityLabel={t('mem_open')}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.openText, { color: colors.textPrimary }]}>{t('mem_open')}</Text>
      </TouchableOpacity>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: colors.bg }} testID={`${testID}-modal`}>
          <View style={[styles.bar, { borderBottomColor: colors.border }]}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.title, { color: colors.textPrimary }]} numberOfLines={2}>{t('mem_title')}</Text>
            <TouchableOpacity accessibilityRole="button" testID={`${testID}-close`} onPress={() => setOpen(false)} style={styles.closeBtn}>
              <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textPrimary }}>{t('close')}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.intro, { color: colors.textMuted }]}>{t('mem_intro')}</Text>
            {loading && <ActivityIndicator testID={`${testID}-loading`} />}
            {!loading && failed && (
              <TouchableOpacity accessibilityRole="button" testID={`${testID}-failed`} onPress={load}>
                <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textPrimary }}>{t('mem_load_failed')}</Text>
              </TouchableOpacity>
            )}
            {!loading && !failed && view && (
              view.forgotten ? <Text maxFontSizeMultiplier={1.4} testID={`${testID}-forgotten`} style={{ color: colors.textPrimary }}>{t('mem_forgotten')}</Text>
                : !view.enabled ? <Text maxFontSizeMultiplier={1.4} testID={`${testID}-off`} style={{ color: colors.textPrimary }}>{t('mem_off')}</Text>
                  : !recap ? <Text maxFontSizeMultiplier={1.4} testID={`${testID}-empty`} style={{ color: colors.textPrimary }}>{t('mem_empty')}</Text>
                    : (
                      <View testID={`${testID}-recap`}>
                        {view.covered_turns > 0 && <Text maxFontSizeMultiplier={1.4} style={[styles.covers, { color: colors.textMuted }]}>{t('mem_covers', { n: view.covered_turns })}</Text>}
                        {section(t('mem_case_stage'), recap.case_stage ? [recap.case_stage] : [], 'stage')}
                        {section(t('mem_places'), recap.places || [], 'places')}
                        {section(t('mem_dates'), (recap.dates || []).map((d) => `${d.what} — ${d.date}`), 'dates')}
                        {section(t('mem_facts'), recap.facts || [], 'facts')}
                        {section(t('mem_asked'), recap.asked || [], 'asked')}
                      </View>
                    )
            )}
            {!loading && !failed && view && !view.forgotten && (
              <TouchableOpacity accessibilityRole="button" testID={`${testID}-forget`} disabled={busy} onPress={forget}
                style={[styles.forgetBtn, { borderColor: colors.border }, busy && { opacity: 0.6 }]}>
                <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textPrimary, fontWeight: '600' }}>{t('mem_delete')}</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  openBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minHeight: 44, justifyContent: 'center' },
  openText: { fontSize: 14 },
  bar: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  title: { flex: 1, fontSize: 16, fontWeight: '700' },
  closeBtn: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  intro: { fontSize: 14, marginBottom: 12, lineHeight: 20 },
  covers: { fontSize: 12, marginBottom: 8 },
  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  item: { fontSize: 14, lineHeight: 20 },
  forgetBtn: { marginTop: 16, borderWidth: 1, borderRadius: 8, padding: 12, alignItems: 'center', minHeight: 44 },
});
