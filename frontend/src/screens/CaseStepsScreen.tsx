/**
 * CaseStepsScreen — "Your case, step by step: from arrest to clearing your record"
 * (docs/COURT_GUIDE.md; constants/caseSteps.ts).
 *
 * Nine stages, one card each: a plain explanation with its official sources and the date checked,
 * a short checklist the person ticks, and buttons to the parts of the app that help at that stage
 * (only screens the consumer app shows — constants/features.ts; custody alerts only when on).
 *
 *   - The person picks the stage they are in ("I'm at this stage"). Nothing guesses it.
 *   - Signed in: progress is saved per case on the account (/api/case-steps/:caseId, owner only);
 *     the case's court dates tick "My first court date is saved" and "I know my next court date".
 *     The owner can let family who already follow the case see the stage name (never the list).
 *   - Guest (or no case yet): progress is saved on this phone; court dates saved on the phone
 *     tick the same two items.
 *   - Clearing your record: what the app's sourced record-clearing data says for the person's
 *     state (GET /api/expungement/check — only verdicts that name a citation), else "check with
 *     legal aid".
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { api, unwrapList } from '../services/api';
import { getToken } from '../utils/secureStorage';
import { getUserState, stateName as localStateName } from '../utils/userState';
import { useToast } from '../components/ToastProvider';
import { makeStyles } from './CourtDatesScreen';
import { IconLabel, ICONS } from '../components/AppIcon';
import { UnreviewedNotice } from '../components/LegalSource';
import GuideSourceList from '../components/GuideSourceList';
import { useAccountRole } from '../navigation/CoreOnlyGate';
import { isScreenEnabled } from '../constants/features';
import { ACTION_TARGETS, AUTO_ITEMS, CASE_STAGES, itemId, type StageDef, type StageId, type StepAction } from '../constants/caseSteps';
import { loadCaseSteps, loadGuestSteps, saveCaseSteps, saveGuestSteps, type StepsProgress } from '../services/caseSteps';

interface CaseRow { id: number; title: string; state?: string | null }
type RecordRow = { key: 'dismissed' | 'misdemeanor' | 'felony'; result: string; waitYears: number | null; citation: string | null };

const EMPTY: StepsProgress = { stage: null, checked: {}, auto: {}, share_stage: false };
const REC_QUERIES: { key: RecordRow['key']; q: string }[] = [
  { key: 'dismissed', q: 'status=Dismissed' },
  { key: 'misdemeanor', q: 'status=Convicted&type=misdemeanor' },
  { key: 'felony', q: 'status=Convicted&type=felony' },
];
const VERDICT_KEY: Record<string, string> = { eligible: 'cst_rec_eligible', conditional: 'cst_rec_conditional', not_eligible: 'cst_rec_not' };

/** What the app's sourced record-clearing data says for `state` (only cited verdicts). */
function RecordClearing({ state, styles, onOpen }: { state: string; styles: any; onOpen: () => void }) {
  const { colors } = useTheme();
  useLang();
  const [rows, setRows] = useState<RecordRow[] | null>(null);
  useEffect(() => {
    let live = true;
    if (!state) { setRows(null); return; }
    Promise.all(REC_QUERIES.map(({ key, q }) => api.get(`/expungement/check?state=${encodeURIComponent(state)}&${q}`)
      .then(r => ({ key, result: String(r.data?.eligibility?.result || 'unknown'), waitYears: r.data?.eligibility?.waitYears ?? null, citation: r.data?.eligibility?.citation || null }))
      .catch(() => ({ key, result: 'unknown', waitYears: null, citation: null }))))
      .then(list => { if (live) setRows(list); });
    return () => { live = false; };
  }, [state]);
  const name = state ? localStateName(state) : '';
  const sourced = (rows || []).filter(r => VERDICT_KEY[r.result] && r.citation);
  return (
    <View style={[styles.box, { marginTop: 8 }]} testID="steps-record-state">
      {!state ? (
        <Text maxFontSizeMultiplier={1.5} style={styles.boxText}>{t('cst_rec_pick_state')}</Text>
      ) : rows === null ? (
        <ActivityIndicator color={colors.textBrand} accessibilityLabel={t('loading')} />
      ) : (
        <>
          <Text maxFontSizeMultiplier={1.4} style={styles.boxStrong}>{t('cst_rec_state', { state: name })}</Text>
          {sourced.length === 0 ? (
            <Text maxFontSizeMultiplier={1.5} style={styles.boxText} testID="steps-record-none">{t('cst_rec_none', { state: name })}</Text>
          ) : rows.map(r => (
            <View key={r.key} style={{ marginTop: 8 }} testID={`steps-record-${r.key}`}>
              <Text maxFontSizeMultiplier={1.5} style={[styles.boxText, { fontWeight: '800' }]}>
                {t(`cst_rec_${r.key}`)}: {VERDICT_KEY[r.result] && r.citation ? t(VERDICT_KEY[r.result]) : t('cst_rec_unchecked')}
              </Text>
              {VERDICT_KEY[r.result] && r.citation && r.waitYears != null && r.result !== 'not_eligible' && (
                <Text maxFontSizeMultiplier={1.5} style={styles.boxText}>{t('cst_rec_wait', { years: String(r.waitYears) })}</Text>
              )}
              {VERDICT_KEY[r.result] && r.citation && <Text maxFontSizeMultiplier={1.4} style={styles.source}>{t('cst_rec_source', { citation: r.citation })}</Text>}
            </View>
          ))}
          {sourced.length > 0 && <Text maxFontSizeMultiplier={1.4} style={[styles.source, { marginTop: 8 }]}>{t('cst_rec_note')}</Text>}
        </>
      )}
      <TouchableOpacity accessibilityRole="button" testID="steps-record-open" style={styles.secondaryBtn} onPress={onOpen}>
        <IconLabel center icon={ICONS.clean} color={colors.textPrimary} textStyle={styles.secondaryBtnText} maxFontSizeMultiplier={1.3}>{t('cst_act_expungement')}</IconLabel>
      </TouchableOpacity>
    </View>
  );
}

function CaseStepsScreen({ navigation, route }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { showToast } = useToast();
  const role = useAccountRole();
  const wantCase = Number((route?.params as { caseId?: number | string } | undefined)?.caseId);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const [phase, setPhase] = useState<'loading' | 'ok' | 'error'>('loading');
  const [signedIn, setSignedIn] = useState(false);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [caseId, setCaseId] = useState<number | null>(null);
  const [p, setP] = useState<StepsProgress>(EMPTY);
  const [open, setOpen] = useState<StageId | null>(null);
  const [custodyOn, setCustodyOn] = useState(false);
  const [homeState, setHomeState] = useState('');
  const [busy, setBusy] = useState(false);

  const guest = !signedIn || caseId == null;

  const loadProgress = useCallback(async (id: number | null) => {
    setPhase('loading');
    try {
      const next = id == null ? await loadGuestSteps() : await loadCaseSteps(id);
      if (!mounted.current) return;
      setP(next); setOpen(o => o ?? next.stage ?? 'arrest'); setPhase('ok');
    } catch {
      if (mounted.current) setPhase('error');
    }
  }, []);

  useEffect(() => {
    (async () => {
      const st = await getUserState().catch(() => null);
      if (mounted.current) setHomeState(st?.code || '');
      const tok = await getToken().catch(() => null);
      if (!tok) { if (mounted.current) setSignedIn(false); await loadProgress(null); return; }
      if (mounted.current) setSignedIn(true);
      api.get<{ enabled: boolean }>('/custody/status').then(r => { if (mounted.current) setCustodyOn(r.data?.enabled === true); }).catch(() => {});
      let list: CaseRow[] = [];
      try { list = unwrapList<CaseRow>((await api.get('/cases')).data, 'cases').filter(c => Number.isSafeInteger(Number(c.id))); }
      catch { if (mounted.current) setPhase('error'); return; }
      if (!mounted.current) return;
      setCases(list);
      const pick = list.find(c => Number(c.id) === wantCase) || list[0] || null;
      setCaseId(pick ? Number(pick.id) : null);
      await loadProgress(pick ? Number(pick.id) : null);
    })();
  }, [loadProgress, wantCase]);

  const pickCase = (id: number) => { if (id === caseId) return; setCaseId(id); setOpen(null); loadProgress(id); };

  /** Save a change (optimistic; put back on failure). */
  const save = async (next: StepsProgress, patch: { stage?: StageId | null; checked?: Record<string, boolean>; share_stage?: boolean }) => {
    const before = p;
    setP(next);
    try {
      if (guest) await saveGuestSteps({ stage: next.stage, checked: next.checked });
      else {
        setBusy(true);
        const saved = await saveCaseSteps(caseId as number, patch);
        if (mounted.current) setP(saved);
      }
    } catch {
      if (mounted.current) { setP(before); showToast(t('cst_save_failed'), 'error'); }
    } finally { if (mounted.current) setBusy(false); }
  };

  const toggle = (id: string) => {
    if (AUTO_ITEMS.includes(id)) return;
    const on = !p.checked[id];
    const checked = { ...p.checked };
    if (on) checked[id] = true; else delete checked[id];
    save({ ...p, checked }, { checked: { [id]: on } });
  };
  const setStage = (s: StageId) => {
    const stage = p.stage === s ? null : s;
    save({ ...p, stage }, { stage });
    if (stage) showToast(t('cst_saved'), 'success');
  };
  const setShare = () => save({ ...p, share_stage: !p.share_stage }, { share_stage: !p.share_stage });

  const currentCase = cases.find(c => Number(c.id) === caseId) || null;
  const recordState = String(currentCase?.state || p.state || homeState || '').toUpperCase();

  const go = (a: StepAction) => {
    const target = ACTION_TARGETS[a];
    const nav = navigation as any;
    if (target.tab) { nav.navigate(target.screen); return; }
    const params: Record<string, unknown> = { ...(target.params || {}) };
    if ((a === 'add_court_date' || a === 'court_dates') && caseId != null) params.caseId = caseId;
    if (a === 'expungement' && recordState) params.state = recordState;
    nav.navigate(target.screen, Object.keys(params).length ? params : undefined);
  };
  const shown = useCallback((a: StepAction) => {
    const target = ACTION_TARGETS[a];
    if (target.flag === 'custody' && !custodyOn) return false;
    return target.tab || isScreenEnabled(target.screen, role || '');
  }, [custodyOn, role]);

  const isDone = (s: StageDef, i: string) => !!(p.checked[itemId(s.id, i)] || p.auto[itemId(s.id, i)]);
  const total = CASE_STAGES.length;
  const hereIndex = useMemo(() => CASE_STAGES.findIndex(s => s.id === p.stage), [p.stage]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scroll} testID="case-steps-screen">
      <Text maxFontSizeMultiplier={1.3} style={styles.title} accessibilityRole="header">{t('cst_title')}</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.rowTitle}>{t('cst_subtitle')}</Text>
      <Text maxFontSizeMultiplier={1.5} style={styles.muted}>{t('cst_intro')}</Text>
      <UnreviewedNotice inset={false} text={t('cst_label')} testID="case-steps-label" />

      {signedIn && cases.length > 1 && (
        <View testID="steps-case-picker">
          <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('cst_pick_case')}</Text>
          <View style={styles.chipsWrap}>
            {cases.map(c => (
              <TouchableOpacity key={c.id} accessibilityRole="radio" accessibilityState={{ selected: Number(c.id) === caseId }} testID={`steps-case-${c.id}`}
                style={[styles.chip, Number(c.id) === caseId && styles.chipOn]} onPress={() => pickCase(Number(c.id))}>
                <Text maxFontSizeMultiplier={1.3} style={[styles.chipText, Number(c.id) === caseId && styles.chipTextOn]} numberOfLines={2}>{c.title}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
      {signedIn && cases.length === 1 && currentCase && <Text maxFontSizeMultiplier={1.4} style={styles.label} testID="steps-case-title">{currentCase.title}</Text>}
      {!signedIn && phase !== 'loading' && (
        <IconLabel icon={ICONS.mobile} color={colors.textSecond} textStyle={styles.muted} testID="steps-guest">{t('cst_guest')}</IconLabel>
      )}
      {signedIn && phase !== 'loading' && cases.length === 0 && (
        <View style={styles.box} testID="steps-no-cases">
          <Text maxFontSizeMultiplier={1.5} style={styles.boxText}>{t('cst_no_cases')}</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={() => (navigation as any).navigate('Cases')}>
            <IconLabel center icon={ICONS.add} color={colors.textPrimary} textStyle={styles.secondaryBtnText} maxFontSizeMultiplier={1.3}>{t('cst_add_case')}</IconLabel>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'loading' && <ActivityIndicator style={{ marginTop: 24 }} color={colors.textBrand} accessibilityLabel={t('loading')} />}
      {phase === 'error' && (
        <View style={styles.box} testID="steps-load-error">
          <Text maxFontSizeMultiplier={1.5} style={styles.boxText}>{t('cst_load_failed')}</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={() => loadProgress(signedIn ? caseId : null)}>
            <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{t('cst_try_again')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'ok' && (
        <>
          <View style={[styles.offline, { backgroundColor: colors.infoBg, marginTop: 10 }]} testID="steps-where">
            <IconLabel icon={ICONS.pin} color={colors.textPrimary} textStyle={styles.boxStrong}>
              {hereIndex >= 0 ? `${t('cst_here')}: ${t(`cst_${CASE_STAGES[hereIndex].id}_title`)}` : t('cst_not_set')}
            </IconLabel>
          </View>

          {CASE_STAGES.map((s, i) => {
            const here = p.stage === s.id;
            const expanded = open === s.id;
            const done = s.items.filter(it => isDone(s, it)).length;
            const title = t(`cst_${s.id}_title`);
            return (
              <View key={s.id} testID={`steps-stage-${s.id}`}
                style={[styles.box, here && { borderColor: colors.legalDark, borderWidth: 2 }]}>
                <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded }} testID={`steps-stage-${s.id}-toggle`}
                  accessibilityLabel={`${t('cst_stage_a11y', { n: i + 1, title })}${here ? t('cst_here_a11y') : ''}. ${t('cst_done_count', { done, total: s.items.length })}. ${expanded ? t('cst_hide') : t('cst_show')}`}
                  style={{ minHeight: 48 }} onPress={() => setOpen(expanded ? null : s.id)}>
                  <Text maxFontSizeMultiplier={1.3} style={styles.rowSub}>{t('cst_step_n', { n: i + 1, total })}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.boxTitle, { flex: 1 }]}>{title}</Text>
                    <IconLabel icon={expanded ? ICONS.chevronUp : ICONS.chevronDown} color={colors.textSecond} textStyle={styles.rowSub}>
                      {t('cst_done_count', { done, total: s.items.length })}
                    </IconLabel>
                  </View>
                  {here && (
                    <View style={[styles.chip, styles.chipOn, { alignSelf: 'flex-start', minHeight: 32, marginTop: 2 }]} testID={`steps-here-${s.id}`}>
                      <Text maxFontSizeMultiplier={1.3} style={[styles.chipText, styles.chipTextOn]}>{t('cst_here')}</Text>
                    </View>
                  )}
                </TouchableOpacity>

                {expanded && (
                  <View testID={`steps-stage-${s.id}-body`}>
                    <Text maxFontSizeMultiplier={1.5} style={[styles.boxText, { marginTop: 6 }]}>{t(`cst_${s.id}_body`)}</Text>
                    <GuideSourceList ids={s.sources} styles={styles} testID={`steps-${s.id}-sources`} />

                    <View style={{ marginTop: 10 }}>
                      {s.items.map(it => {
                        const id = itemId(s.id, it);
                        const auto = AUTO_ITEMS.includes(id);
                        const on = isDone(s, it);
                        return (
                          <TouchableOpacity key={id} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: auto || busy }}
                            disabled={auto} testID={`steps-item-${s.id}-${it}`} style={{ minHeight: 44, justifyContent: 'center', marginTop: 4 }}
                            onPress={() => toggle(id)}>
                            <IconLabel icon={on ? ICONS.checkbox : ICONS.checkboxEmpty} color={colors.textPrimary} textStyle={styles.boxText}>{t(`cst_${s.id}_${it}`)}</IconLabel>
                            {auto && <Text maxFontSizeMultiplier={1.4} style={[styles.source, { marginStart: 26 }]} testID={`steps-auto-${s.id}-${it}`}>{t('cst_auto')}</Text>}
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <TouchableOpacity accessibilityRole="radio" accessibilityState={{ selected: here }} testID={`steps-set-${s.id}`}
                      style={[styles.secondaryBtn, here && { borderColor: colors.legalDark }]} onPress={() => setStage(s.id)}>
                      <IconLabel center icon={here ? ICONS.radioOn : ICONS.radioOff} color={colors.textPrimary} textStyle={styles.secondaryBtnText} maxFontSizeMultiplier={1.3}>{t('cst_set_here')}</IconLabel>
                    </TouchableOpacity>

                    {s.id === 'record' && <RecordClearing state={recordState} styles={styles} onOpen={() => go('expungement')} />}

                    {s.actions.filter(a => shown(a) && !(s.id === 'record' && a === 'expungement')).length > 0 && (
                      <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('cst_helps')}</Text>
                    )}
                    {s.actions.filter(a => shown(a) && !(s.id === 'record' && a === 'expungement')).map(a => (
                      <TouchableOpacity key={a} accessibilityRole="button" testID={`steps-action-${s.id}-${a}`} style={styles.secondaryBtn} onPress={() => go(a)}>
                        <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{t(ACTION_TARGETS[a].label)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            );
          })}

          {!guest && (
            <View style={styles.box} testID="steps-share">
              <TouchableOpacity accessibilityRole="switch" accessibilityState={{ checked: p.share_stage }} testID="steps-share-toggle"
                style={{ minHeight: 48, justifyContent: 'center' }} onPress={setShare}>
                <IconLabel icon={p.share_stage ? ICONS.checkbox : ICONS.checkboxEmpty} color={colors.textPrimary} textStyle={styles.boxStrong}>{t('cst_share')}</IconLabel>
              </TouchableOpacity>
              <Text maxFontSizeMultiplier={1.4} style={styles.source}>{t('cst_share_note')}</Text>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

export default React.memo(CaseStepsScreen);
