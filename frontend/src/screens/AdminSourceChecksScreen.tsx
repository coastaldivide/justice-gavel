/**
 * AdminSourceChecksScreen — Admin → Source checks (AI step 3, docs/AI_PLATFORM.md §9–§10).
 * Admin role only; the server checks the role on every call (routes/admin/sourceChecks.js,
 * routes/admin/aiBatches.js) and audits every decision.
 *
 *   Overview      rows per dataset: shown, re-checked automatically, need a person
 *   Run now       start a source re-check (one batch; at most SOURCE_CHECK_MAX_ROWS rows)
 *   Queue         each item: the row, the stored text, the verdict, the quote (found on the page or
 *                 not), what changed, links to the stored / checked / proposed page; approve / edit /
 *                 withhold (edit: corrected text for database rows; a correction for a developer for
 *                 rows in code — the row is hidden until it is applied)
 *   Withheld      rows withheld after a check (and corrections waiting) — restore
 *   Batch tools   evaluation run, "translate new keys" (review file download), recent batches
 * Nothing on this screen publishes a row by itself: only an admin's approve / edit does.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { fetchFile } from '../services/fileDownload';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../hooks/useConfirm';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { makeStyles } from './CourtDatesScreen';

type Status = 'pending' | 'approved' | 'edited' | 'withheld';
type Review = {
  id: number; dataset: string; row_key: string; kind: 'recheck' | 'proposal'; label: string | null; state: string | null;
  source_url: string | null; old_text: string; verdict: string; quote: string | null; quote_verified: boolean; reason: string | null;
  what_changed: string | null; fetched_url: string | null; proposed_source_url: string | null; status: string; created_at: string;
  editable: { kind: 'fields'; fields: string[] } | { kind: 'correction' } | null;
};
type DatasetRow = { dataset: string; rows: number; shown: number; recheck: number; propose: number; not_official: number; no_url: number };
type Batch = { id: number; kind: string; status: string; item_count: number; cost_usd: number; eval_mean?: number | null; eval_questions?: number | null };
type Withheld = { dataset: string; row_key: string; withheld_reason: string | null; correction: string | null };

const STATUSES: Status[] = ['pending', 'approved', 'edited', 'withheld'];
const REASONS = new Set(['quote_not_on_page', 'pdf_not_verifiable', 'source_page_not_fetched', 'fetched_page_not_allowed']);
const VERDICTS = new Set(['still_matches', 'changed', 'page_gone', 'cant_tell', 'source_found']);
const DATASETS = new Set(['expungement', 'juvenile', 'recording', 'court_rules', 'transit', 'guide', 'tn_report', 'rights_card', 'deadlines',
  'bail_schedules', 'dui_laws', 'drug_penalties', 'statute_of_limitations', 'victim_compensation', 'specialty_courts', 'rights_cards']);
const KINDS = new Set(['source_check', 'eval_answer', 'eval_grade', 'translate_keys']);
const BATCH_STATUSES = new Set(['creating', 'in_progress', 'canceling', 'ended', 'processing', 'processed', 'failed']);
const dsName = (d: string) => (DATASETS.has(d) ? t(`asc_ds_${d}`) : d);
const FIELDS = new Set(['bail_note', 'notes', 'covers', 'eligibility', 'source_url', 'text']);
const fieldName = (f: string) => (FIELDS.has(f) ? t(`asc_field_${f}`) : f);

function AdminSourceChecksScreen(_props: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const st = makeStyles(colors);
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [tab, setTab] = useState<Status>('pending');
  const [datasets, setDatasets] = useState<DatasetRow[] | null>(null);
  const [rows, setRows] = useState<Review[] | null>(null);
  const [withheld, setWithheld] = useState<Withheld[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState<Record<number, Record<string, string>>>({});

  const load = useCallback(async (which: Status) => {
    setErr('');
    try {
      const [ov, list, wh, bl] = await Promise.all([
        api.get<{ datasets: DatasetRow[] }>('/admin/source-checks'),
        api.get<{ rows: Review[] }>('/admin/source-checks/reviews', { params: { status: which, limit: 100 } }),
        api.get<{ rows: Withheld[] }>('/admin/source-checks/withheld'),
        api.get<{ batches: Batch[] }>('/admin/ai-batches', { params: { limit: 20 } }),
      ]);
      setDatasets(ov.data.datasets || []); setRows(list.data.rows || []); setWithheld(wh.data.rows || []); setBatches(bl.data.batches || []);
    } catch (e) { setErr(apiErrorMessage(e, t('asc_load_failed'))); setRows([]); }
  }, []);
  useEffect(() => { load(tab); }, [tab, load]);

  const post = async (key: string, path: string, body: object, okText: string, failText: string) => {
    setBusy(key);
    try { const r = await api.post(path, body); showToast(okText, 'success'); await load(tab); return r.data; }
    catch (e) { showToast(apiErrorMessage(e, failText), 'error'); return null; }
    finally { setBusy(null); }
  };

  const runNow = async () => {
    setBusy('run');
    try {
      const r = await api.post<{ batch: { id: number } | null }>('/admin/source-checks/run', {});
      showToast(r.data.batch ? t('asc_run_started') : t('asc_run_nothing'), r.data.batch ? 'success' : 'info');
      await load(tab);
    } catch (e) { showToast(apiErrorMessage(e, t('asc_run_failed')), 'error'); }
    finally { setBusy(null); }
  };

  const decide = async (r: Review, action: 'approve' | 'withhold' | 'edit') => {
    const note = (notes[r.id] || '').trim() || undefined;
    if (action !== 'edit') {
      const ok = await confirm(t('asc_confirm_title'), t(action === 'approve' ? 'asc_confirm_approve' : 'asc_confirm_withhold'), { confirmLabel: t(action === 'approve' ? 'asc_approve' : 'asc_withhold') });
      if (!ok) return;
      await post(`r${r.id}`, `/admin/source-checks/reviews/${r.id}`, { action, note }, t('asc_done'), t('asc_failed'));
      return;
    }
    const e = editing[r.id] || {};
    const body = r.editable?.kind === 'fields'
      ? { action, note, fields: Object.fromEntries(Object.entries(e).filter(([k, v]) => k !== 'source_url' && v.trim())), ...(e.source_url?.trim() ? { source_url: e.source_url.trim() } : {}) }
      : { action, note, text: (e.text || '').trim() };
    const done = await post(`r${r.id}`, `/admin/source-checks/reviews/${r.id}`, body, t('asc_done'), t('asc_failed'));
    if (done) setEditing((x) => { const y = { ...x }; delete y[r.id]; return y; });
  };

  const startBatch = async (key: string, path: string, body: object) => {
    setBusy(key);
    try {
      const r = await api.post<{ batch: unknown }>(path, body);
      showToast(r.data.batch ? t('abt_started') : t('abt_nothing'), r.data.batch ? 'success' : 'info');
      await load(tab);
    } catch (e) { showToast(apiErrorMessage(e, t('abt_failed')), 'error'); }
    finally { setBusy(null); }
  };

  const open = (url: string | null) => { if (url) Linking.openURL(url).catch(() => {}); };
  const reasonText = (r: Review) => (r.reason && REASONS.has(r.reason) ? t(`asc_reason_${r.reason}`) : t('asc_reason_generic'));

  return (
    <ScrollView style={st.screen} contentContainerStyle={st.scroll} testID="admin-source-checks-screen" keyboardShouldPersistTaps="handled">
      <Text maxFontSizeMultiplier={1.3} style={st.title} accessibilityRole="header">{t('asc_title')}</Text>
      <Text maxFontSizeMultiplier={1.4} style={st.muted}>{t('asc_intro')}</Text>
      <TouchableOpacity accessibilityRole="button" testID="asc-run" style={[st.primaryBtn, busy === 'run' && { opacity: 0.5 }]} disabled={busy !== null} onPress={runNow}>
        <Text maxFontSizeMultiplier={1.3} style={st.primaryBtnText}>{t('asc_run')}</Text>
      </TouchableOpacity>
      {!!err && <Text maxFontSizeMultiplier={1.4} style={st.error} testID="asc-error">{err}</Text>}

      <Text maxFontSizeMultiplier={1.4} style={st.group} accessibilityRole="header">{t('asc_overview')}</Text>
      {datasets === null && <ActivityIndicator color={colors.textBrand} accessibilityLabel={t('loading')} />}
      {(datasets || []).map((d) => (
        <View key={d.dataset} style={st.row} testID={`asc-ds-${d.dataset}`}>
          <Text maxFontSizeMultiplier={1.4} style={st.rowTitle}>{dsName(d.dataset)}</Text>
          <Text maxFontSizeMultiplier={1.4} style={st.rowSub}>{t('asc_ds_line', { rows: d.rows, shown: d.shown, recheck: d.recheck, manual: d.propose + d.not_official + d.no_url })}</Text>
        </View>
      ))}

      <View style={[st.chipsWrap, { marginTop: 16 }]} accessibilityRole="tablist">
        {STATUSES.map((x) => (
          <TouchableOpacity key={x} accessibilityRole="tab" accessibilityState={{ selected: tab === x }} testID={`asc-tab-${x}`} style={[st.chip, tab === x && st.chipOn]} onPress={() => setTab(x)}>
            <Text maxFontSizeMultiplier={1.3} style={[st.chipText, tab === x && st.chipTextOn]}>{t(`asc_tab_${x}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {rows?.length === 0 && !err && <Text maxFontSizeMultiplier={1.4} style={st.muted} testID="asc-empty">{t('asc_empty')}</Text>}
      {(rows || []).map((r) => (
        <View key={r.id} style={st.box} testID="asc-review">
          <Text maxFontSizeMultiplier={1.4} style={st.boxTitle}>{r.label || `${dsName(r.dataset)} ${r.row_key}`}</Text>
          <Text maxFontSizeMultiplier={1.4} style={st.rowSub}>
            {dsName(r.dataset)} · {t(r.kind === 'proposal' ? 'asc_kind_proposal' : 'asc_kind_recheck')} · {VERDICTS.has(r.verdict) ? t(`asc_verdict_${r.verdict}`) : r.verdict}
          </Text>
          {r.status === 'pending' && r.verdict !== 'changed' && r.verdict !== 'page_gone' && r.kind === 'recheck' && (
            <Text maxFontSizeMultiplier={1.4} style={st.muted} testID="asc-reason">{reasonText(r)}</Text>
          )}
          <Text maxFontSizeMultiplier={1.4} style={st.label}>{t('asc_stored')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={st.boxText} testID="asc-old-text">{r.old_text}</Text>
          {!!r.quote && (
            <>
              <Text maxFontSizeMultiplier={1.4} style={st.label}>{t('asc_quote')} {t(r.quote_verified ? 'asc_quote_ok' : 'asc_quote_unverified')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={st.boxText} testID="asc-quote">“{r.quote}”</Text>
            </>
          )}
          {!!r.what_changed && (
            <>
              <Text maxFontSizeMultiplier={1.4} style={st.label}>{t('asc_changed')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={st.boxText}>{r.what_changed}</Text>
            </>
          )}
          {!!r.source_url && <TouchableOpacity accessibilityRole="link" style={{ minHeight: 40, justifyContent: 'center' }} onPress={() => open(r.source_url)}><Text maxFontSizeMultiplier={1.3} style={st.link}>{t('asc_open_source')}</Text></TouchableOpacity>}
          {!!r.fetched_url && r.fetched_url !== r.source_url && r.fetched_url !== r.proposed_source_url && <TouchableOpacity accessibilityRole="link" style={{ minHeight: 40, justifyContent: 'center' }} onPress={() => open(r.fetched_url)}><Text maxFontSizeMultiplier={1.3} style={st.link}>{t('asc_open_fetched')}</Text></TouchableOpacity>}
          {!!r.proposed_source_url && <TouchableOpacity accessibilityRole="link" testID="asc-proposed" style={{ minHeight: 40, justifyContent: 'center' }} onPress={() => open(r.proposed_source_url)}><Text maxFontSizeMultiplier={1.3} style={st.link}>{t('asc_open_proposed')}</Text></TouchableOpacity>}
          {r.status === 'pending' && (
            <>
              <TextInput accessibilityLabel={t('asc_note')} placeholder={t('asc_note')} placeholderTextColor={colors.textMuted} style={[st.inputFull, { marginTop: 10 }]}
                value={notes[r.id] || ''} onChangeText={(v) => setNotes((n) => ({ ...n, [r.id]: v }))} maxLength={500} />
              {editing[r.id] && r.editable && (
                <View testID="asc-edit-box">
                  <Text maxFontSizeMultiplier={1.4} style={st.muted}>{t(r.editable.kind === 'fields' ? 'asc_edit_hint_fields' : 'asc_edit_hint_code')}</Text>
                  {(r.editable.kind === 'fields' ? [...r.editable.fields, 'source_url'] : ['text']).map((f) => (
                    <TextInput key={f} accessibilityLabel={fieldName(f)} placeholder={fieldName(f)} placeholderTextColor={colors.textMuted} multiline={f !== 'source_url'}
                      style={[st.inputFull, { marginTop: 6, minHeight: f === 'source_url' ? 48 : 90 }]} testID={`asc-edit-${f}`}
                      value={editing[r.id][f] || ''} onChangeText={(v) => setEditing((x) => ({ ...x, [r.id]: { ...x[r.id], [f]: v } }))} maxLength={4000} />
                  ))}
                  <TouchableOpacity accessibilityRole="button" testID="asc-save-edit" style={st.primaryBtn} disabled={busy !== null} onPress={() => decide(r, 'edit')}>
                    <Text maxFontSizeMultiplier={1.3} style={st.primaryBtnText}>{t('asc_save_edit')}</Text>
                  </TouchableOpacity>
                </View>
              )}
              <View style={st.followRow}>
                <TouchableOpacity accessibilityRole="button" testID="asc-approve" style={[st.goBtn, { flex: 1 }, busy !== null && { opacity: 0.5 }]} disabled={busy !== null} onPress={() => decide(r, 'approve')}>
                  <Text maxFontSizeMultiplier={1.3} style={st.goBtnText}>{t('asc_approve')}</Text>
                </TouchableOpacity>
                {!!r.editable && !editing[r.id] && (
                  <TouchableOpacity accessibilityRole="button" testID="asc-edit" style={[st.secondaryBtn, { flex: 1, marginTop: 0 }]} disabled={busy !== null} onPress={() => setEditing((x) => ({ ...x, [r.id]: {} }))}>
                    <Text maxFontSizeMultiplier={1.3} style={st.secondaryBtnText}>{t('asc_edit')}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity accessibilityRole="button" testID="asc-withhold" style={[st.secondaryBtn, { flex: 1, marginTop: 0 }]} disabled={busy !== null} onPress={() => decide(r, 'withhold')}>
                  <Text maxFontSizeMultiplier={1.3} style={st.secondaryBtnText}>{t('asc_withhold')}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      ))}

      <Text maxFontSizeMultiplier={1.4} style={st.group} accessibilityRole="header">{t('asc_withheld_title')}</Text>
      {withheld.length === 0 && <Text maxFontSizeMultiplier={1.4} style={st.muted}>{t('asc_empty')}</Text>}
      {withheld.map((w) => (
        <View key={`${w.dataset}:${w.row_key}`} style={st.row} testID="asc-withheld-row">
          <Text maxFontSizeMultiplier={1.4} style={st.rowTitle}>{dsName(w.dataset)} · {w.row_key}</Text>
          {!!w.correction && <Text maxFontSizeMultiplier={1.4} style={st.rowSub}>{t('asc_correction', { text: w.correction })}</Text>}
          <TouchableOpacity accessibilityRole="button" testID="asc-restore" style={st.secondaryBtn} disabled={busy !== null}
            onPress={() => post(`w${w.dataset}${w.row_key}`, '/admin/source-checks/rows/restore', { dataset: w.dataset, key: w.row_key }, t('asc_done'), t('asc_failed'))}>
            <Text maxFontSizeMultiplier={1.3} style={st.secondaryBtnText}>{t('asc_restore')}</Text>
          </TouchableOpacity>
        </View>
      ))}

      <Text maxFontSizeMultiplier={1.4} style={st.group} accessibilityRole="header">{t('abt_title')}</Text>
      <Text maxFontSizeMultiplier={1.4} style={st.muted}>{t('abt_intro')}</Text>
      <TouchableOpacity accessibilityRole="button" testID="abt-eval" style={st.secondaryBtn} disabled={busy !== null} onPress={() => startBatch('eval', '/admin/ai-batches/eval', { limit: 10 })}>
        <Text maxFontSizeMultiplier={1.3} style={st.secondaryBtnText}>{t('abt_eval')}</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" testID="abt-translate" style={st.secondaryBtn} disabled={busy !== null} onPress={() => startBatch('tr', '/admin/ai-batches/translate', {})}>
        <Text maxFontSizeMultiplier={1.3} style={st.secondaryBtnText}>{t('abt_translate')}</Text>
      </TouchableOpacity>
      <Text maxFontSizeMultiplier={1.4} style={st.source}>{t('abt_translate_hint')}</Text>
      <TouchableOpacity accessibilityRole="button" testID="abt-poll" style={st.secondaryBtn} disabled={busy !== null} onPress={() => startBatch('poll', '/admin/ai-batches/poll', {})}>
        <Text maxFontSizeMultiplier={1.3} style={st.secondaryBtnText}>{t('abt_poll')}</Text>
      </TouchableOpacity>
      {batches.map((b) => (
        <View key={b.id} style={st.row} testID="abt-batch">
          <Text maxFontSizeMultiplier={1.4} style={st.rowTitle}>
            {t('abt_batch_line', { kind: KINDS.has(b.kind) ? t(`abt_kind_${b.kind}`) : b.kind, status: BATCH_STATUSES.has(b.status) ? t(`abt_st_${b.status}`) : b.status, items: b.item_count, cost: Number(b.cost_usd || 0).toFixed(4) })}
          </Text>
          {b.kind === 'eval_answer' && b.eval_mean != null && (
            <Text maxFontSizeMultiplier={1.4} style={st.rowSub} testID="abt-eval-score">{t('abt_eval_score', { score: b.eval_mean, n: b.eval_questions ?? 0 })}</Text>
          )}
          {b.kind === 'translate_keys' && b.status === 'processed' && (
            <TouchableOpacity accessibilityRole="button" testID="abt-download" style={{ minHeight: 40, justifyContent: 'center' }}
              onPress={() => fetchFile(`/admin/ai-batches/${b.id}/translation-draft`, `translation-draft-${b.id}.json`, 'application/json').catch((e) => showToast(apiErrorMessage(e, t('abt_failed')), 'error'))}>
              <Text maxFontSizeMultiplier={1.3} style={st.link}>{t('abt_download')}</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

export default React.memo(AdminSourceChecksScreen);
