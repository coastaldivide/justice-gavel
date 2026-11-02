/**
 * FormMapSuggestions — AI field-mapping suggestions for an agency's blank surety PDF (AI step 4;
 * staff only: shown inside BondFormsScreen when it works on a "set up my forms" request).
 *
 * "Suggest fields with AI" → POST {base}/forms/:id/map-suggestions: for each fillable text field,
 * the suggested case-file value, a confidence and the reason (the printed label the AI used).
 * Staff accept a field (as suggested, or after choosing another value) or reject it —
 * POST …/map-suggestions/:sid/decide. Only accepted fields reach the form's field map (the
 * existing form-fill path). A PDF without fillable fields says so. Signature lines are never
 * suggested and nothing is ever drawn.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, View } from 'react-native';
import { api, apiErrorMessage } from '../../services/api';
import { useToast } from '../ToastProvider';
import { useTheme } from '../../constants/theme';
import { t } from '../../i18n';
import { Btn, Card, Line, Pill } from './ui';
import { type BondForm, DATA_KEYS, dataKeyLabelKey } from '../../services/bondDesk';

export interface MapSuggestionItem { field: string; data_key: string | null; confidence: 'high' | 'medium' | 'low'; reason: string; page: number | null }
export interface MapSuggestion {
  id: number; form_id: number; status: 'open' | 'done'; no_fields: boolean; suggestions: MapSuggestionItem[];
  decisions: Record<string, { action: 'accept' | 'reject'; data_key: string | null; edited?: boolean }>; truncated?: boolean;
}

const TONE = { high: 'ok', medium: 'warn', low: 'danger' } as const;

export function FormMapSuggestions({ base, form, onForm }: { base: string; form: BondForm; onForm: (f: BondForm) => void }) {
  const { colors } = useTheme();
  const { showToast } = useToast();
  const [sug, setSug] = useState<MapSuggestion | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [choosing, setChoosing] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoaded(false); setSug(null); setError('');
    api.get<{ suggestion: MapSuggestion | null }>(`${base}/forms/${form.id}/map-suggestions`)
      .then(r => { if (live) setSug(r.data?.suggestion || null); })
      .catch(() => {})
      .finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [base, form.id]);

  const suggest = async () => {
    setBusy('suggest'); setError('');
    try {
      const r = await api.post<{ suggestion: MapSuggestion }>(`${base}/forms/${form.id}/map-suggestions`, {}, { timeout: 150_000 });
      setSug(r.data.suggestion);
    } catch (e) { setError(apiErrorMessage(e, t('bdk_ai_failed'))); }
    finally { setBusy(null); }
  };

  const decide = useCallback(async (field: string, action: 'accept' | 'reject', dataKey?: string) => {
    if (!sug) return;
    setBusy(field);
    try {
      const r = await api.post<{ suggestion: MapSuggestion; form: BondForm }>(`${base}/forms/${form.id}/map-suggestions/${sug.id}/decide`,
        { field, action, ...(dataKey ? { data_key: dataKey } : {}) });
      setSug(r.data.suggestion);
      // The server already wrote the accepted field into the form's field map; keep any unsaved
      // edits on screen and add this one field.
      const key = r.data.suggestion.decisions?.[field]?.data_key;
      if (action === 'accept' && key) onForm({ ...form, field_map: { ...form.field_map, [field]: key } });
    } catch (e) { showToast(apiErrorMessage(e, t('bdk_save_failed')), 'error'); }
    finally { setBusy(null); }
  }, [base, form, onForm, showToast, sug]);

  const decided = sug ? Object.keys(sug.decisions || {}).length : 0;
  return (
    <Card title={t('bdk_ai_title')} testID="form-ai">
      <Line muted>{t('bdk_ai_help')}</Line>
      {!loaded && <ActivityIndicator color={colors.textBrand} />}
      {!!error && <Line tone="danger" testID="form-ai-error">{error}</Line>}
      {loaded && <Btn kind={sug ? 'ghost' : 'primary'} label={sug ? t('bdk_ai_suggest_again') : t('bdk_ai_suggest')} onPress={suggest} busy={busy === 'suggest'} testID="form-ai-suggest" />}
      {sug?.no_fields && <Line tone="warn" testID="form-ai-no-fields">{t('bdk_ai_no_fields')}</Line>}
      {sug && !sug.no_fields && (
        <>
          <Line muted testID="form-ai-summary">{t('bdk_ai_summary', { done: decided, total: sug.suggestions.length })}</Line>
          {sug.truncated && <Line muted>{t('bdk_ai_truncated')}</Line>}
          {sug.suggestions.map(s => {
            const d = sug.decisions?.[s.field];
            return (
              <View key={s.field} testID={`form-ai-item-${s.field}`} style={{ borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 8, gap: 4 }}>
                <Line strong>{s.field}</Line>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  <Pill text={t(`bdk_ai_conf_${s.confidence}`)} tone={TONE[s.confidence]} />
                  {s.page != null && <Pill text={t('bdk_ai_page', { n: s.page })} />}
                </View>
                <Line>{s.data_key ? t('bdk_ai_suggested', { key: t(dataKeyLabelKey(s.data_key)) }) : t('bdk_ai_suggest_none')}</Line>
                {!!s.reason && <Line muted>{t('bdk_ai_reason', { reason: s.reason })}</Line>}
                {d ? (
                  <Line tone={d.action === 'accept' ? 'ok' : 'warn'} testID={`form-ai-decided-${s.field}`}>
                    {d.action === 'accept' && d.data_key ? t('bdk_ai_accepted', { key: t(dataKeyLabelKey(d.data_key)) }) : t('bdk_ai_rejected')}
                  </Line>
                ) : (
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    {!!s.data_key && <Btn label={t('bdk_ai_accept')} onPress={() => decide(s.field, 'accept')} busy={busy === s.field} testID={`form-ai-accept-${s.field}`} />}
                    <Btn kind="ghost" label={t('bdk_ai_use_other')} onPress={() => setChoosing(s.field)} testID={`form-ai-other-${s.field}`} />
                    <Btn kind="ghost" label={t('bdk_ai_reject')} onPress={() => decide(s.field, 'reject')} testID={`form-ai-reject-${s.field}`} />
                  </View>
                )}
              </View>
            );
          })}
          <Line muted>{t('bdk_ai_signature_note')}</Line>
        </>
      )}
      <Modal visible={!!choosing} animationType="slide" onRequestClose={() => setChoosing(null)}>
        <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }} testID="form-ai-picker">
          <Card title={t('bdk_fill_field_with', { field: choosing || '' })}>
            {DATA_KEYS.map(k => (
              <Btn key={k} kind="ghost" label={t(dataKeyLabelKey(k))} testID={`form-ai-key-${k}`}
                onPress={() => { const f = choosing; setChoosing(null); if (f) decide(f, 'accept', k); }} />
            ))}
            <Btn kind="ghost" label={t('cancel')} onPress={() => setChoosing(null)} />
          </Card>
        </ScrollView>
      </Modal>
    </Card>
  );
}
