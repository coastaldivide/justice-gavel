/**
 * ChatScreen — the AI legal guide (signed-in accounts).
 *
 * One question at a time (services/chatStream.ts): on web the answer streams
 * in as it is written; on native it arrives from the job queue. While an
 * answer is coming the send button is a Stop button. If the connection drops
 * or the AI is busy, the part that arrived stays on screen with "Try again" —
 * the retry re-uses the question's id, so the server replays a finished
 * answer instead of asking twice, and the question is never shown twice.
 * Messages that mention self-harm or domestic violence (any of the four app
 * languages) get the crisis lines first (utils/crisisDetect.ts), then the
 * answer. Answers are drawn with MarkdownText (text only, never HTML). The
 * conversation is kept on the server per session and reloads on open.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ExpoCrypto from 'expo-crypto';
import * as Clipboard from 'expo-clipboard';
import { AIDisclaimer } from '../components/AIDisclaimer';
import { MarkdownText } from '../components/MarkdownText';
import { SignInNeeded, useHasSession } from '../components/SignInNeeded';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../hooks/useConfirm';
import { AppIcon, IconLabel, ICONS } from '../components/AppIcon';
import { track } from '../services/analytics';
import type { ScreenProps } from '../types/navigation';
import { unwrapList, api } from '../services/api';
import { notifyDisclaimerRequired } from '../services/legalGate';
import { askChat, ChatError, chatErrorText, type RightsRef } from '../services/chatStream';
import { isOnline } from '../services/offlineCache';
import { detectCrisis } from '../utils/crisisDetect';
import { t, useLang, perLang, locale } from '../i18n';
import { getUserState } from '../utils/userState';
import { useTheme, COLORS } from '../constants/theme';
import { hapticImpact, RNShare } from '../utils/webCompat';

// ── Message shape ──────────────────────────────────────────────────────────────
type MsgStatus = 'streaming' | 'complete' | 'stopped' | 'error';
interface Message {
  id:                  string;
  role:                'user' | 'assistant';
  text:                string;
  status?:             MsgStatus;
  /** assistant answers: the question and its id, for "Try again" */
  question?:           string;
  clientMessageId?:    string;
  errorText?:          string;
  crisis?:             'crisis' | 'dv';
  suggestLawyerSearch?: boolean;
  intent?:             string;
  rightsRefs?:         RightsRef[];
  showUpgrade?:        boolean;
}

// ── Cryptographically secure id / session token ──────────────────────────────
// expo-crypto works on Hermes and on web; Math.random only if the native
// module is unavailable (tests).
function randomId(): string {
  try {
    const bytes = ExpoCrypto.getRandomBytes(8);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

async function getSessionId(): Promise<string> {
  try {
    let id = await AsyncStorage.getItem('chat_session_id');
    if (!id) {
      id = randomId();
      await AsyncStorage.setItem('chat_session_id', id).catch(() => {}); // non-fatal if storage full
    }
    return id;
  } catch {
    return randomId(); // storage unavailable: this visit only
  }
}

async function hasValidConsent(): Promise<boolean> {
  try { return (await AsyncStorage.getItem('chat_consent_accepted')) === '1'; } catch { return false; }
}
async function recordConsent(): Promise<void> {
  try { await AsyncStorage.setItem('chat_consent_accepted', '1'); } catch { /* shown again next time */ }
}

const CRISIS_CALLS: Record<'crisis' | 'dv', { label: () => string; url: string }> = {
  crisis: { label: () => t('chat_crisis_call_988'), url: 'tel:988' },
  dv:     { label: () => t('chat_crisis_call_dv'),  url: 'tel:18007997233' },
};

// ── Message bubble ─────────────────────────────────────────────────────────────
interface BubbleProps {
  msg:          Message;
  isDefender:   boolean;
  busy:         boolean;
  onFindLawyer: () => void;
  onUpgrade:    () => void;
  onOpenRights: () => void;
  onOpenCrisis: () => void;
  onRetry:      (m: Message) => void;
}

function Bubble({ msg, isDefender, busy, onFindLawyer, onUpgrade, onOpenRights, onOpenCrisis, onRetry }: BubbleProps) {
  useLang();
  const { showToast } = useToast();
  const isUser = msg.role === 'user';
  const copy = () => {
    Clipboard.setStringAsync(msg.text || '').then(() => showToast(t('x_ch_copied_clipboard'), 'success')).catch(() => {});
  };
  const call = (url: string) => Linking.openURL(url).catch(() => showToast(t('x_crisis_resources_please_dial_manually', { number: url.replace('tel:', '') }), 'warning'));

  return (
    <View style={[styles.bubbleWrap, isUser && styles.bubbleWrapUser]}>
      {!isUser && (
        <View style={styles.avatarDot}>
          <Text maxFontSizeMultiplier={1.4} style={styles.avatarText}>{isDefender ? '⚖️' : 'JG'}</Text>
        </View>
      )}
      {isUser ? (
        <Pressable accessibilityRole="text" accessibilityHint={t('chat_copy_hint')} onLongPress={copy} delayLongPress={400}
          testID="chat-msg-user" style={[styles.bubble, styles.bubbleUser]}>
          <Text maxFontSizeMultiplier={1.4} selectable style={[styles.bubbleText, styles.bubbleTextUser]}>{msg.text}</Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="text"
          accessibilityHint={t('chat_copy_hint')}
          onLongPress={copy}
          delayLongPress={400}
          testID={msg.crisis ? 'chat-crisis-card' : 'chat-msg-assistant'}
          style={[styles.bubble, styles.bubbleAssistant, msg.crisis && styles.bubbleCrisis]}
        >
          {msg.status === 'streaming' && !msg.text
            ? <View style={styles.typingInline}><ActivityIndicator size="small" color={COLORS.navy} /><Text maxFontSizeMultiplier={1.4} style={styles.typingText}>{t('chat_thinking')}</Text></View>
            : <MarkdownText text={msg.text} style={styles.bubbleText} testID="chat-answer-text" />}

          {msg.crisis && (
            <View style={styles.crisisActions}>
              <TouchableOpacity accessibilityRole="button" testID="chat-crisis-call" style={styles.crisisBtn} onPress={() => call(CRISIS_CALLS[msg.crisis as 'crisis' | 'dv'].url)}>
                <IconLabel icon={ICONS.phone} textStyle={styles.crisisBtnText} maxFontSizeMultiplier={1.3}>{CRISIS_CALLS[msg.crisis].label()}</IconLabel>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" testID="chat-crisis-all" style={styles.crisisBtnAlt} onPress={onOpenCrisis}>
                <Text maxFontSizeMultiplier={1.3} style={styles.crisisBtnAltText}>{t('chat_crisis_all_lines')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {msg.status === 'stopped' && (
            <Text maxFontSizeMultiplier={1.3} testID="chat-stopped" style={styles.statusNote}>{t('chat_stopped')}</Text>
          )}
          {msg.status === 'error' && (
            <View testID="chat-error">
              <IconLabel icon={ICONS.statusWarn} textStyle={styles.errorNote} maxFontSizeMultiplier={1.3}>{msg.errorText}</IconLabel>
              {!!msg.question && (
                <TouchableOpacity accessibilityRole="button" testID="chat-retry" disabled={busy}
                  style={[styles.retryBtn, busy && { opacity: 0.5 }]} onPress={() => onRetry(msg)}>
                  <Text maxFontSizeMultiplier={1.3} style={styles.retryBtnText}>↻ {t('chat_retry')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {!!msg.rightsRefs?.length && (
            <View testID="chat-rights-refs" style={styles.rightsRefs}>
              {msg.rightsRefs.map(r => (
                <TouchableOpacity key={r.key} accessibilityRole="link" accessibilityLabel={t('x_ch_from_rights_card', { heading: r.heading })}
                  style={styles.rightsRef} onPress={onOpenRights}>
                  <IconLabel icon={ICONS.clipboard} textStyle={styles.rightsRefText} maxFontSizeMultiplier={1.4}>{t('x_ch_from_rights_card_2', { value: r.heading.replace(/^\d+\.\s*/, '') })}</IconLabel>
                  <Text maxFontSizeMultiplier={1.4} style={styles.rightsRefSource}>{t('x_ch_source', { source: r.source })}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {msg.suggestLawyerSearch && (
            <TouchableOpacity accessibilityRole="button" style={styles.lawyerCta} onPress={onFindLawyer}>
              <IconLabel icon={ICONS.location} textStyle={styles.lawyerCtaText} maxFontSizeMultiplier={1.4}>{t('chat_find_lawyer')}</IconLabel>
            </TouchableOpacity>
          )}
          {msg.showUpgrade && (
            <TouchableOpacity accessibilityRole="button" style={styles.upgradeCta} onPress={onUpgrade}>
              <IconLabel icon={ICONS.diamond} textStyle={styles.upgradeCtaText} maxFontSizeMultiplier={1.4}>{t('chat_upgrade_cta')}</IconLabel>
            </TouchableOpacity>
          )}
        </Pressable>
      )}
    </View>
  );
}

// ── Quick-start prompt categories ─────────────────────────────────────────────
// T1-G: colors.* replaced with hex literals (module scope — no hook access here)
const PROMPT_CATEGORIES = perLang(() => [
  {
    category: t('chat_cat_emergency'),
    color: COLORS.emergency,          // was COLORS.emergencyDark
    prompts: [
      { label: t('chat_prompt_just_arrested'), text: t('x_ch_i_was_just_arrested') },
      { label: t('chat_prompt_know_rights'),   text: t('x_ch_what_my_rights_during') },
      { label: t('chat_prompt_dui'),           text: t('x_ch_i_was_charged_with') },
      { label: t('chat_prompt_need_lawyer'),   text: t('x_ch_i_need_criminal_defense') },
    ],
  },
  {
    category: t('chat_cat_drug_criminal'),
    color: COLORS.blue,          // was COLORS.blue
    prompts: [
      { label: t('chat_prompt_drug'),         text: t('x_ch_i_was_charged_with_2') },
      { label: t('chat_prompt_assault'),      text: t('x_ch_i_have_assault_charge') },
      { label: t('chat_prompt_expungement'),  text: t('x_ch_can_i_get_my') },
      { label: t('chat_prompt_probation'),    text: t('x_ch_i_may_have_violated') },
    ],
  },
  {
    category: t('chat_cat_family'),
    color: COLORS.blue,
    prompts: [
      { label: t('chat_prompt_divorce'),     text: t('x_ch_i_want_file_divorce') },
      { label: t('chat_prompt_custody'),     text: t('x_ch_how_does_child_custody') },
      { label: t('chat_prompt_restraining'), text: t('x_ch_how_do_i_get') },
      { label: t('chat_prompt_tenant'),      text: t('x_ch_my_landlord_trying_evict') },
    ],
  },
  {
    category: t('chat_cat_work'),
    color: COLORS.navy,          // was COLORS.legalDark
    prompts: [
      { label: t('chat_prompt_wrongful'),    text: t('x_ch_i_think_i_was') },
      { label: t('chat_prompt_wage'),        text: t('x_ch_my_employer_not_paying') },
      { label: t('chat_prompt_bankruptcy'),  text: t('x_ch_what_my_options_if') },
      { label: t('chat_prompt_claims'),      text: t('x_ch_how_do_i_file') },
    ],
  },
  {
    category: t('chat_cat_immigration'),
    color: COLORS.emergency,          // was COLORS.warnDark
    prompts: [
      { label: t('chat_prompt_ice'),   text: t('x_ch_family_member_was_detained'), intent: 'ice_detention' },
      { label: t('chat_prompt_asylum'),text: t('x_ch_how_do_i_apply') },
      { label: t('chat_prompt_visa'),  text: t('x_ch_my_visa_expiring_what') },
      { label: t('chat_prompt_daca'),  text: t('x_ch_what_my_rights_as') },
    ],
  },
]);

const QUICK_PROMPTS = perLang(() => PROMPT_CATEGORIES()[0].prompts);

// ── Offline AI response cache ──────────────────────────────────────────────────
const OFFLINE_QA = perLang((): { q: string[]; a: string }[] => [
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'miranda', 'miranda rights', 'what are my rights'],
    a: t('x_ch_have_right_remain_silent') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'bail', 'how does bail work', 'what is bail'],
    a: t('x_ch_bail_money_paid_court') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'arraignment', 'what happens at arraignment'],
    a: t('x_ch_arraignment_first_formal_court') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'attorney', 'public defender', 'do i get a lawyer', 'can i afford a lawyer'],
    a: t('x_ch_have_constitutional_right_attorney') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'phone call', 'right to a phone call'],
    a: t('x_ch_have_right_make_phone') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'search', 'can police search me', 'illegal search'],
    a: t('x_ch_police_can_search_without') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'right to remain silent', '5th amendment', 'self incrimination'],
    a: t('x_ch_fifth_amendment_protects_from') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'expungement', 'clear my record', 'seal my record'],
    a: t('x_ch_expungement_seals_destroys_criminal') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'dui', 'dwi', 'drunk driving'],
    a: t('x_ch_dui_dwi_arrest_triggers') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'domestic violence', 'domestic battery'],
    a: t('x_ch_domestic_violence_charges_often') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'drug possession', 'possession', 'controlled substance'],
    a: t('x_ch_drug_possession_charges_vary') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'felony', 'what is a felony'],
    a: t('x_ch_felony_serious_crime_typically') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'misdemeanor', 'what is a misdemeanor'],
    a: t('x_ch_misdemeanor_lesser_criminal_offense') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'probable cause', 'what is probable cause'],
    a: t('x_ch_probable_cause_legal_standard') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'plea deal', 'plea bargain', 'should i take a plea'],
    a: t('x_ch_plea_bargain_agreement_plead') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'jury trial', 'right to jury trial'],
    a: t('x_ch_have_constitutional_right_jury') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'discovery', 'what is discovery'],
    a: t('x_ch_discovery_process_through_which') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'speedy trial', 'how long can they hold me'],
    a: t('x_ch_sixth_amendment_guarantees_right') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'bond', 'bondsman', 'bail bondsman'],
    a: t('x_ch_bail_bondsman_posts_full') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'suppress', 'motion to suppress', 'throw out evidence'],
    a: t('x_ch_motion_suppress_asks_court') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'immigration', 'deportation', 'ice', 'non-citizen'],
    a: t('x_ch_criminal_conviction_even_misdemeanor') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'juvenile', 'minor', 'under 18', 'teen'],
    a: t('x_ch_juvenile_court_separate_from') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'parole', 'probation', 'what is parole'],
    a: t('x_ch_probation_supervision_instead_additi') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'court date', 'miss court', 'missed hearing'],
    a: t('x_ch_missing_court_date_results') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'what do i do', 'arrested', 'just arrested', 'i was arrested'],
    a: t('x_ch_do_these_things_order') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'dui', 'dwi', 'drunk driving', 'drinking and driving', 'i was drinking'],
    a: t('x_ch_after_dui_arrest_do') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'just arrested', 'i was arrested', 'what do i do', 'help me', 'arrested'],
    a: t('x_ch_right_now_only_3') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'domestic violence', 'dv', 'hit my partner', 'my partner hit me', 'domestic'],
    a: t('x_ch_domestic_violence_situations_if') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'drug', 'drugs', 'possession', 'weed', 'marijuana', 'cocaine', 'meth'],
    a: t('x_ch_drug_possession_charge_1') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'i cant afford', 'no money', 'broke', 'poor', 'free help'],
    a: t('x_ch_have_free_options_1') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'scared', 'nervous', 'freaking out', 'panic', 'help', 'please help'],
    a: t('x_ch_take_breath_can_get') },
  { q: [ // i18n-exempt: English match keywords (localized ones: x_ch_offline_kw_N)
    'probation', 'violated probation', 'probation violation', 'missed check in'],
    a: t('x_ch_if_violated_probation_1') },
]);

// T1-H/I: hooks removed from function body; function closes cleanly with return null
function getOfflineAnswer(query: string): string | null {
  const q = query.toLowerCase().trim();
  for (const [i, entry] of OFFLINE_QA().entries()) {
    // English keywords always match; x_ch_offline_kw_N adds the same keywords in the app language
    const local = t(`x_ch_offline_kw_${i + 1}`).split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    if ([...entry.q, ...local].some(keyword => q.includes(keyword))) {
      return t('x_ch_offline_response_cached_answer', { a: entry.a });
    }
  }
  return null;
}

// ── ChatScreen ─────────────────────────────────────────────────────────────────
/** Streamed text is pushed to the screen at most this often (long answers stay smooth). */
const FLUSH_MS = 60;

function ChatScreen({ navigation, route }: ScreenProps) {
  useLang();
  const { confirm } = useConfirm();
  const { colors } = useTheme();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const { hasSession, recheck } = useHasSession();

  const {
    mode         = 'consumer',
    caseContext  = null,
    caseTitle    = null,
    initialQuery = null,
  } = (route?.params ?? {}) as {
    mode?: string; caseContext?: string | null;
    caseTitle?: string | null; initialQuery?: string | null;
  };
  const isDefender = mode === 'defender';
  const caseId = (route?.params as Record<string, unknown>)?.caseId as string | null ?? null;

  const [messages,       setMessages]       = useState<Message[]>([]);
  const [input,          setInput]          = useState('');
  const [busy,           setBusy]           = useState(false);
  const [sessionId,      setSessionId]      = useState('');
  const [showDisclaimer, setShowDisclaimer] = useState(true);
  const [refreshing,     setRefreshing]     = useState(false);

  const mountedRef   = useRef(true);
  const listRef      = useRef<FlashListRef<Message>>(null);
  const userStateRef = useRef<{ code: string; name: string } | null>(null);
  const abortRef     = useRef<AbortController | null>(null);

  useEffect(() => () => { mountedRef.current = false; abortRef.current?.abort(); }, []);
  useEffect(() => { getUserState().then(s => { userStateRef.current = s; }).catch(() => {}); }, []);
  useEffect(() => { if (initialQuery) setInput(initialQuery); }, [initialQuery]);
  useEffect(() => { hasValidConsent().then(ok => { if (ok) setShowDisclaimer(false); }).catch(() => {}); }, []);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);

  const update = useCallback((id: string, patch: Partial<Message> | ((m: Message) => Partial<Message>)) => {
    if (!mountedRef.current) return;
    setMessages(prev => prev.map(m => (m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m)));
  }, []);

  /**
   * The saved conversation. On first load (keepLocal) anything the person
   * already sent while it was loading stays after it instead of being wiped.
   */
  const loadHistory = useCallback(async (sid: string, keepLocal = false) => {
    try {
      const res = await api.get(`/chat/history/${sid}`);
      const rows = unwrapList<Record<string, unknown>>(res.data, 'messages', 'history');
      const msgs: Message[] = rows.map(h => ({
        id:     randomId(),
        role:   h.role === 'assistant' ? 'assistant' : 'user',
        text:   String(h.content ?? ''),
        status: h.status === 'stopped' ? 'stopped' : 'complete',
      }));
      if (mountedRef.current) setMessages(prev => (keepLocal ? [...msgs, ...prev] : msgs));
    } catch (e) { __DEV__ && console.warn((e as Error)?.message); }
  }, []);

  // Signed in: this device's session and its saved conversation.
  useEffect(() => {
    if (!hasSession) return;
    getSessionId().then(id => { setSessionId(id); loadHistory(id, true); });
  }, [hasSession, loadHistory]);

  const onRefresh = useCallback(async () => {
    if (!sessionId || busy) return;
    setRefreshing(true);
    await loadHistory(sessionId).catch(() => {});
    setRefreshing(false);
  }, [sessionId, busy, loadHistory]);

  const exportConversation = useCallback(async () => {
    if (!messages.length) return;
    try {
      const header = [
        t('x_ch_justice_gavel_ai_conversation'),
        '================================',
        t('x_ch_export_exported', { date: new Date().toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric' }) }),
        caseTitle ? t('x_ch_export_case', { title: caseTitle }) : '',
        '',
      ].filter(Boolean).join('\n');
      const body = messages.filter(m => m.text).map(m => {
        const sender = m.role === 'assistant' ? t('x_ch_justice_gavel_ai') : t('x_ch_export_you');
        return `[${sender}]\n${m.text}`;
      }).join('\n\n---\n\n');
      const footer = [
        '', '================================',
        t('x_ch_important_this_conversation_general'),
        t('x_ch_it_not_legal_advice'),
        t('x_ch_specific_situation'), '',
        'Justice Gavel · justicegavel.app',
      ].join('\n');
      await RNShare.share({ message: header + '\n\n' + body + '\n\n' + footer, title: t('x_ch_ai_legal_conversation') });
    } catch { /* share cancelled */ }
  }, [messages, caseTitle]);

  const clearChat = useCallback(() => {
    confirm(t('x_ch_clear_conversation'), t('x_ch_delete_all_messages_this'), { confirmLabel: t('x_ch_clear'), destructive: true })
      .then(async ok => {
        if (!ok) return;
        abortRef.current?.abort();
        const sid = sessionId || await getSessionId();
        try { await api.delete(`/chat/history/${sid}`); } catch (e) { __DEV__ && console.warn((e as Error)?.message); }
        const newId = randomId();
        await AsyncStorage.setItem('chat_session_id', newId).catch(() => {});
        setSessionId(newId);
        setMessages([]);
      });
  }, [sessionId, confirm]);

  /** Ask the AI for the answer that goes into assistant bubble `answerId`. */
  const runAnswer = useCallback(async (answerId: string, question: string, clientMessageId: string) => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    let pending = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      if (!pending) return;
      const chunk = pending; pending = '';
      update(answerId, m => ({ text: m.text + chunk }));
    };
    try {
      if (!(await isOnline())) {
        const offline = getOfflineAnswer(question);
        update(answerId, { text: offline || t('x_ch_re_offline_connect_internet'), status: 'complete' });
        return;
      }
      const sid = sessionId || await getSessionId();
      const answer = await askChat({
        message: question, sessionId: sid, clientMessageId, mode,
        caseContext, caseId, caseTitle,
        user_state: userStateRef.current?.code || null,
        user_state_name: userStateRef.current?.name || null,
      }, {
        signal: ctrl.signal,
        onToken: (tok) => { pending += tok; if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS); },
      });
      if (flushTimer) clearTimeout(flushTimer);
      pending = '';
      update(answerId, {
        text: answer.text, status: 'complete', errorText: undefined,
        intent: answer.intent, suggestLawyerSearch: answer.suggestLawyerSearch, rightsRefs: answer.rightsRefs,
      });
    } catch (e) {
      if (flushTimer) clearTimeout(flushTimer);
      flush();
      const err = e instanceof ChatError ? e : new ChatError('ai_failed', chatErrorText('ai_failed'));
      if (err.code === 'stopped') {
        update(answerId, m => (m.text ? { status: 'stopped' } : { status: 'stopped', text: '' }));
      } else if (err.code === 'chat_limit_reached') {
        update(answerId, { text: chatErrorText(err.code), status: 'complete', showUpgrade: true, question: undefined });
      } else if (err.code === 'disclaimer_required') {
        notifyDisclaimerRequired();
        update(answerId, { text: chatErrorText(err.code), status: 'complete', question: undefined });
      } else if (err.status === 401) {
        recheck();
        update(answerId, { text: '', status: 'error', errorText: t('chat_signin_body'), question: undefined });
      } else {
        // Keep what arrived; offer the same question again (same id → no duplicate).
        update(answerId, m => ({ text: m.text || err.partial, status: 'error', errorText: err.message || chatErrorText(err.code) }));
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      if (mountedRef.current) setBusy(false);
      scrollToBottom();
    }
  }, [sessionId, mode, caseContext, caseId, caseTitle, update, recheck, scrollToBottom]);

  const send = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    hapticImpact().catch(() => {});
    setInput('');
    if (!messages.length) track('first_ai_message', {}).catch(() => {});

    const userMsg: Message = { id: randomId(), role: 'user', text };
    const added: Message[] = [userMsg];
    // Self-harm / domestic violence: the crisis lines first, always (also offline).
    const crisis = detectCrisis(text);
    if (crisis) {
      added.push({ id: randomId(), role: 'assistant', crisis, status: 'complete',
        text: crisis === 'crisis' ? t('x_ch_i_hear_please_reach') : t('x_ch_safety_most_important_thing') });
    }
    if (text.length < 3) {
      added.push({ id: randomId(), role: 'assistant', status: 'complete', text: t('x_ch_i_want_help_can') });
      setMessages(prev => [...prev, ...added]);
      scrollToBottom();
      return;
    }
    const clientMessageId = randomId();
    const answer: Message = { id: randomId(), role: 'assistant', text: '', status: 'streaming', question: text, clientMessageId };
    setMessages(prev => [...prev, ...added, answer]);
    scrollToBottom();
    await runAnswer(answer.id, text, clientMessageId);
  }, [busy, messages.length, runAnswer, scrollToBottom]);

  const retry = useCallback((m: Message) => {
    if (busy || !m.question || !m.clientMessageId) return;
    update(m.id, { text: '', status: 'streaming', errorText: undefined });
    runAnswer(m.id, m.question, m.clientMessageId);
  }, [busy, update, runAnswer]);

  const stop = useCallback(() => { abortRef.current?.abort(); }, []);

  const onFindLawyer = () => navigation.navigate('Match');
  const onUpgrade    = () => navigation.navigate('MoreTab', { screen: 'ConsumerSubscription' });
  const onOpenRights = () => navigation.navigate('MoreTab', { screen: 'RightsCard' });
  const onOpenCrisis = () => navigation.navigate('MoreTab', { screen: 'CrisisResources' });

  const header = (
    <View style={styles.header}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text maxFontSizeMultiplier={1.4} style={styles.headerTitle}>{t('x_ch_legal_help')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.headerSub}>{t('x_ch_ai_powered_rights_guide')}</Text>
      </View>
      {messages.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity accessibilityRole="button" onPress={exportConversation} style={styles.clearBtn}
            testID="chat-export-button" accessibilityLabel={t('x_ch_share_conversation')}>
            <Text maxFontSizeMultiplier={1.4} style={styles.clearBtnText}>{t('share')}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={clearChat} style={styles.clearBtn}
            testID="chat-clear-button" accessibilityLabel={t('x_ch_clear')}>
            <Text maxFontSizeMultiplier={1.4} style={styles.clearBtnText}>{t('x_ch_clear')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  if (hasSession === false) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.bg }]} testID="chat-screen">
        {header}
        <SignInNeeded navigation={navigation} title={t('chat_signin_title')} body={t('chat_signin_body')} onSignedIn={recheck} testID="chat-sign-in" />
        <TouchableOpacity accessibilityRole="button" testID="chat-guest-crisis" style={styles.guestCrisis} onPress={onOpenCrisis}>
          <Text maxFontSizeMultiplier={1.3} style={styles.guestCrisisText}>{t('chat_guest_crisis')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isEmpty = messages.length === 0;
  const canSend = !!input.trim() && !busy;

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
      testID="chat-screen"
    >
      {header}

      {showDisclaimer && (
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.6}
          testID="chat-disclaimer"
          onPress={() => { setShowDisclaimer(false); recordConsent(); }}
          style={[styles.disclaimerCard, { backgroundColor: colors.bgCard, borderLeftColor: colors.gold }]}>
          <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={[styles.disclaimerTitle, { color: colors.goldText }]} maxFontSizeMultiplier={1.4}>{t('x_ch_ai_legal_information_not')}</IconLabel>
          <Text maxFontSizeMultiplier={1.4} style={[styles.disclaimerBody, { color: colors.textSecond }]}>{t('x_ch_i_am_ai_guide')}</Text>
        </TouchableOpacity>
      )}

      {isEmpty ? (
        <View style={styles.emptyState}>
          <AppIcon name="scale-outline" size={20} color={COLORS.navy} />
          <Text maxFontSizeMultiplier={1.4} style={styles.emptyTitle}>{t('ja_s1')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.emptySub}>{t('x_ch_ask_anything_about_legal')}</Text>
          <View style={styles.quickPrompts}>
            {QUICK_PROMPTS().map(p => (
              <TouchableOpacity accessibilityRole="button" key={p.label} style={styles.quickChip}
                accessibilityLabel={p.label} onPress={() => send(p.text)}>
                <Text maxFontSizeMultiplier={1.4} style={styles.quickChipText}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : (
        <FlashList<Message>
          ref={listRef}
          keyboardShouldPersistTaps="handled"
          data={messages}
          keyExtractor={m => m.id}
          onRefresh={onRefresh}
          refreshing={refreshing}
          renderItem={({ item }) => (
            <Bubble msg={item} isDefender={isDefender} busy={busy}
              onFindLawyer={onFindLawyer} onUpgrade={onUpgrade} onOpenRights={onOpenRights}
              onOpenCrisis={onOpenCrisis} onRetry={retry} />
          )}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={scrollToBottom}
        />
      )}

      <View style={styles.inputBar}>
        <TouchableOpacity accessibilityRole="button" style={styles.iconBtn}
          onPress={() => navigation.navigate('MoreTab', { screen: 'VoiceNote' })}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel={t('x_nav_voice_note')}
          accessibilityHint={t('x_ch_opens_voice_recorder_transcribe')}>
          <IconLabel icon={ICONS.record} textStyle={{ fontSize: 20 }} maxFontSizeMultiplier={1.4}></IconLabel>
        </TouchableOpacity>

        <TextInput
          testID="chat-input"
          style={styles.textInput}
          placeholder={t('x_ch_ask_anything_what_should')}
          placeholderTextColor={colors.textMuted}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={2000}
          returnKeyType="send"
          onSubmitEditing={() => send(input)}
          accessibilityLabel={t('x_ch_ask_anything_what_should')}
        />

        <TouchableOpacity accessibilityRole="button" style={styles.iconBtn}
          onPress={() => navigation.navigate('MoreTab', { screen: 'Translator' })}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel={t('x_ch_open_interpreter')}
          accessibilityHint={t('x_ch_opens_real_time_translation')}>
          <IconLabel icon={ICONS.globe} textStyle={{ fontSize: 20 }} maxFontSizeMultiplier={1.4}></IconLabel>
        </TouchableOpacity>

        {busy ? (
          <TouchableOpacity accessibilityRole="button" testID="chat-stop" style={[styles.sendBtn, styles.stopBtn]}
            onPress={stop} accessibilityLabel={t('chat_stop')}>
            <Text maxFontSizeMultiplier={1.4} style={styles.sendBtnText}>■</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity accessibilityRole="button" testID="chat-send"
            style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
            onPress={() => send(input)} disabled={!canSend} accessibilityLabel={t('chat_send')}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.sendBtnText, !canSend && styles.sendBtnTextDisabled]}>↑</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text maxFontSizeMultiplier={1.4} style={styles.disclaimer}>{t('x_ch_not_legal_advice_emergencies')}</Text>
      <AIDisclaimer variant="banner" />
    </KeyboardAvoidingView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
// T2-B: COLORS constant is defined at module scope above; all refs resolve correctly
const makeStyles = (colors: any) => StyleSheet.create({
  screen:           { flex: 1, backgroundColor: 'transparent' },
  header:           { backgroundColor: COLORS.navy, padding: 16, paddingTop: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle:      { fontSize: 20, fontFamily: 'Inter_900Black', fontWeight: '900', color: COLORS.bgCard },
  headerSub:        { fontSize: 12, color: COLORS.bgSubtle, marginTop: 1 },
  clearBtn:         { paddingHorizontal: 12, paddingVertical: 10, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8 },
  clearBtnText:     { color: COLORS.bgCard, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  messageList:      { padding: 12, paddingBottom: 4 },
  emptyState:       { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyIcon:        { fontSize: 48, marginBottom: 12 },
  emptyTitle:       { fontSize: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.textBrand, marginBottom: 8 },
  emptySub:         { fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  promptCatRow:     { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.bgSubtle, marginBottom: 8 },
  promptCatBtn:     { paddingHorizontal: 10, paddingVertical: 8, marginRight: 2, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  promptCatText:    { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.textMuted, letterSpacing: 0.3 },
  quickPrompts:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  quickChip:        { backgroundColor: COLORS.bgSubtle, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: COLORS.bgSubtle },
  quickChipText:    { fontSize: 14, lineHeight: 20, color: COLORS.navy, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  iconBtn:          { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.bgSubtle, alignItems: 'center', justifyContent: 'center', marginHorizontal: 2 },
  bubbleWrap:       { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 12 },
  bubbleWrapUser:   { justifyContent: 'flex-end' },
  avatarDot:        { width: 30, height: 30, borderRadius: 16, backgroundColor: COLORS.navy, alignItems: 'center', justifyContent: 'center', marginRight: 8, marginBottom: 2, borderWidth: 1.5, borderColor: 'rgba(133,183,235,0.4)' },
  avatarText:       { color: COLORS.white, fontSize: 11, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 0.5 },
  bubble:           { maxWidth: '78%', borderRadius: 20, padding: 12 },
  bubbleAssistant:  { backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4, elevation: 1, shadowColor: COLORS.bg, shadowOpacity: 0.05, shadowRadius: 3 },
  bubbleUser:       { backgroundColor: COLORS.navy, borderBottomRightRadius: 4 },
  bubbleText:       { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
  bubbleTextUser:   { color: COLORS.bgCard },
  rightsRefs:       { marginTop: 10, gap: 6 },
  rightsRef:        { backgroundColor: colors.infoBg, borderRadius: 8, padding: 10, minHeight: 44 },
  rightsRefText:    { fontSize: 13, lineHeight: 19, color: colors.textPrimary, fontWeight: '700' },
  rightsRefSource:  { fontSize: 11, lineHeight: 15, color: colors.textSecond, marginTop: 2 },
  lawyerCta:        { marginTop: 10, backgroundColor: colors.legal, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: colors.legal },
  lawyerCtaText:    { fontSize: 12, lineHeight: 20, color: colors.bg, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  upgradeCta:       { marginTop: 10, backgroundColor: COLORS.bgSubtle, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: COLORS.bgSubtle },
  upgradeCtaText:   { fontSize: 12, lineHeight: 20, color: COLORS.navy, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  typingInline:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typingText:       { fontSize: 12, lineHeight: 20, color: colors.textMuted },
  bubbleCrisis:     { borderColor: colors.emergency, borderWidth: 2 },
  crisisActions:    { marginTop: 10, gap: 8 },
  crisisBtn:        { backgroundColor: colors.emergencyDark, borderRadius: 10, minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  crisisBtnText:    { color: COLORS.white, fontSize: 14, fontWeight: '800' },
  crisisBtnAlt:     { borderWidth: 1, borderColor: colors.border, borderRadius: 10, minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  crisisBtnAltText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  statusNote:       { marginTop: 6, fontSize: 12, lineHeight: 18, color: colors.textMuted, fontStyle: 'italic' },
  errorNote:        { marginTop: 8, fontSize: 13, lineHeight: 19, color: colors.textPrimary },
  retryBtn:         { marginTop: 8, alignSelf: 'flex-start', borderRadius: 10, borderWidth: 1, borderColor: colors.navy, minHeight: 44, paddingHorizontal: 14, justifyContent: 'center' },
  retryBtnText:     { color: colors.textBrand, fontSize: 14, fontWeight: '700' },
  stopBtn:          { backgroundColor: colors.emergencyDark },
  disclaimerCard:   { borderRadius: 8, padding: 12, margin: 12, borderLeftWidth: 3 },
  disclaimerTitle:  { fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 12, marginBottom: 4 },
  disclaimerBody:   { fontSize: 11, lineHeight: 16 },
  guestCrisis:      { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  guestCrisisText:  { color: colors.textBrand, fontSize: 14, fontWeight: '700', textDecorationLine: 'underline', textAlign: 'center' },
  inputBar:         { flexDirection: 'row', alignItems: 'flex-end', padding: 10, paddingBottom: Platform.OS === 'ios' ? 10 : 10, backgroundColor: COLORS.bgCard, borderTopWidth: 1, borderTopColor: colors.border, gap: 8 },
  textInput:        { flex: 1, backgroundColor: COLORS.bg, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, lineHeight: 21, color: colors.bgCard, maxHeight: 100, borderWidth: 1, borderColor: colors.border },
  sendBtn:          { width: 52, height: 52, borderRadius: 20, backgroundColor: COLORS.navy, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled:  { backgroundColor: colors.bgSubtle },
  sendBtnText:      { color: colors.textOnNavy, fontSize: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', lineHeight: 22 },
  sendBtnTextDisabled: { color: colors.textMuted },
  disclaimer:       { textAlign: 'center', fontSize: 11, color: colors.textMuted, paddingVertical: 10, backgroundColor: colors.bgCard },
  defenderBanner:    { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.12)' },
  defenderBannerText:{ color: COLORS.bgCard, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  defenderBannerSub: { color: 'rgba(255,255,255,0.65)', fontSize: 11, marginTop: 2 },
  defenderPrompts:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 },
  defenderChip:      { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5 },
  defenderChipText:  { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
});

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);
export default React.memo(ChatScreen);