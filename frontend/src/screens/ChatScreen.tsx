import { AIDisclaimer } from '../components/AIDisclaimer';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../hooks/useConfirm';
import { AppIcon } from '../components/AppIcon';
/**
 * ChatScreen — Full conversation UI wired to Claude backend
 *
 * Fixes applied (v5.4.0):
 *   T1-A  Removed useFocusEffect + clearChat() from Bubble sub-component
 *   T1-B  Added isDefender prop to Bubble
 *   T1-C  Removed stray '>' after conditional close on avatar row
 *   T1-D  Changed <View onLongPress> → <Pressable> (View ignores touch props)
        accessibilityRole="button" accessibilityLabel="Open chat options"
 *   T1-E  Fixed msg.reply/msg.content → msg.text in long-press handler
 *   T1-F  Added Alert to react-native imports
 *   T1-G  Replaced module-scope colors.* refs in PROMPT_CATEGORIES with hex literals
 *   T1-H  Removed misplaced hooks from inside getOfflineAnswer()
 *   T1-I  getOfflineAnswer now cleanly returns null at end
 *   T1-J  Repaired split ChatScreen function signature
 *   T1-K  Removed duplicate caseTitle declaration
 *   T1-L  Fixed listRef generic type; moved session load into useEffect
 *   T1-M  Removed inner sid re-declaration that shadowed the outer one
 *   T1-N  setSending(false) → setLoading(false)
 *   T1-O  Removed stray '>' after JSX Header comment
 *   T1-P  Fixed broken onPress split across lines in prompt chips
 *   T1-Q  Fixed renderItem and ListEmptyComponent props split mid-expression
 *   T1-R  Removed stray '>' after input-bar comments
 *   T1-S  Added missing closing bracket on send-button
 *   T2-A  Restored commented-out React hooks imports
 *   T2-B  Defined module-scope COLORS constant
 *   T2-C  Replaced undefined hasValidConsent() with AsyncStorage-based check
 *   T2-D  exportConversation catch binds error variable
 *   T2-E  Removed unused `sent` state; consolidated disclaimer to showDisclaimer
 *   T2-F  Removed unused offlineQAMap useMemo (getOfflineAnswer uses OFFLINE_QA directly)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  LayoutAnimation,
  InteractionManager,
} from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { track } from '../services/analytics';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ScreenProps } from '../types/navigation';
import { unwrapList, api, isAiUnavailable, isDisclaimerRequired, deviceTimeZone, API_BASE_URL } from '../services/api';
import { notifyDisclaimerRequired } from '../services/legalGate';

/**
 * An HTTP answer from /chat/stream that the /chat/ask fallback would answer
 * the same way (auth, daily limit, disclaimer, rate limit, AI off). Re-sending
 * the question would only double-count it, so the stream path surfaces these
 * directly (shaped like an axios error for the shared handler below).
 */
class StreamHttpError extends Error {
  response: { status: number; data: Record<string, unknown> };
  constructor(status: number, data: Record<string, unknown>) {
    super(String(data?.message || data?.error || `HTTP ${status}`));
    this.response = { status, data };
  }
}
const TERMINAL_STREAM_STATUSES = new Set([400, 401, 402, 403, 429, 451, 503]);
import { pollJob }        from '../services/jobPoller';
import { isOnline }       from '../services/offlineCache';
import { t, useLang, perLang, locale }              from '../i18n';
import { getUserState }   from '../utils/userState';
import { getToken }       from '../utils/secureStorage';
import * as ExpoCrypto from 'expo-crypto';
import * as Clipboard from 'expo-clipboard';
import {  useTheme, COLORS }       from '../constants/theme';
import { hapticImpact, RNShare } from '../utils/webCompat';

// ── Static colour palette used in module-scope constants and StyleSheet ────────
// (useTheme() is hook-only; these mirror the dark-navy design system values)

// ── Message shape ──────────────────────────────────────────────────────────────
/** A rights-card section the answer is grounded in (server: rightsRefsFor). */
interface RightsRef { key: string; heading: string; source: string; last_reviewed: string | null }
interface Message {
  id:                  string;
  role:                'user' | 'assistant';
  text:                string;
  suggestLawyerSearch?: boolean;
  intent?:             string;
  rightsRefs?:         RightsRef[];
  showUpgrade?:        boolean;
}

// ── Cryptographically secure id / session token ──────────────────────────────
// expo-crypto works on Hermes (where global crypto.getRandomValues may be
// missing) and on web. Falls back to Math.random if the native module is
// unavailable (e.g. tests).
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
    // AsyncStorage unavailable — use in-memory session ID (resets on restart)
    return randomId();
  }
}

// ── hasValidConsent — AsyncStorage-based consent check ────────────────────────
// Returns true if the user has previously accepted the AI disclaimer.
async function hasValidConsent(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem('chat_consent_accepted');
    return v === '1';
  } catch { return false; }
}

async function recordConsent(): Promise<void> {
  try { await AsyncStorage.setItem('chat_consent_accepted', '1'); } catch {}
}

// ── Message bubble ─────────────────────────────────────────────────────────────
// T1-A: useFocusEffect removed — it does not belong in a pure display component
// T1-B: isDefender passed as prop (was out-of-scope reference to parent variable)
// T1-C: removed stray '>' after conditional close
// T1-D: <View onLongPress> → <Pressable> (View silently ignores touch props)
// T1-E: long-press handler uses msg.text (msg.reply / msg.content don't exist)
// T1-F: Alert now imported at top of file

interface BubbleProps {
  msg:          Message;
  isDefender:   boolean;
  onFindLawyer: () => void;
  onUpgrade:    () => void;
  onOpenRights?: () => void;
}

function Bubble({ msg, isDefender, onFindLawyer, onUpgrade, onOpenRights }: BubbleProps) {
  useLang();
  const { showToast } = useToast();
  const isUser = msg.role === 'user';

  const handleLongPress = () => {
    const text = msg.text || '';
    Clipboard.setStringAsync(text).then(() => showToast(t('x_ch_copied_clipboard'), 'success')).catch(() => {});
  };

  return (
    <View style={[styles.bubbleWrap, isUser && styles.bubbleWrapUser]}
      testID="chat-screen">
      {!isUser && (
        <View style={[styles.avatarDot, isDefender && styles.avatarDotDefender]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.avatarText}>
            {isDefender ? '⚖️' : 'JG'}
          </Text>
        </View>
      )}
      <Pressable
        accessibilityRole="button" accessibilityLabel={t('x_ch_attach_file')}
        onLongPress={handleLongPress}
        delayLongPress={400}
        style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}
      >
        <Text
          maxFontSizeMultiplier={1.4}
          style={[styles.bubbleText, isUser && styles.bubbleTextUser]}
        >
          {msg.text}
        </Text>
        {!isUser && !!msg.rightsRefs?.length && (
          <View testID="chat-rights-refs" style={styles.rightsRefs}>
            {msg.rightsRefs.map(r => (
              <TouchableOpacity key={r.key} accessibilityRole="link" accessibilityLabel={t('x_ch_from_rights_card', { heading: r.heading })}
                style={styles.rightsRef} onPress={onOpenRights}>
                <Text maxFontSizeMultiplier={1.4} style={styles.rightsRefText}>{t('x_ch_from_rights_card_2', { value: r.heading.replace(/^\d+\.\s*/, '') })}</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.rightsRefSource}>{t('x_ch_source', { source: r.source })}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {msg.suggestLawyerSearch && !isUser && (
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.lawyerCta}
            onPress={onFindLawyer}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.lawyerCtaText}>
              📍 {t('chat_find_lawyer')}
            </Text>
          </TouchableOpacity>
        )}
        {msg.showUpgrade && !isUser && (
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.upgradeCta}
            onPress={onUpgrade}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.upgradeCtaText}>
              💎 {t('chat_upgrade_cta')}
            </Text>
          </TouchableOpacity>
        )}
      </Pressable>
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
// T1-J: function signature is on one line; all hooks are inside the function body

function ChatScreen({ navigation, route }: ScreenProps) {
  useLang();
  const { confirm } = useConfirm();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  // ── Route params ─────────────────────────────────────────────────────────────
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

  // T1-K: caseId declared once; caseTitle comes only from destructured params above
  const caseId = (route?.params as Record<string, unknown>)?.caseId as string | null ?? null;

  // ── State ─────────────────────────────────────────────────────────────────────
  const [messages,      setMessages]      = useState<Message[]>([]);
  const [input,         setInput]         = useState('');

  const [loading,       setLoading]       = useState(false);
  const [sessionId,     setSessionId]     = useState('');
  const [showDisclaimer,setShowDisclaimer] = useState(true); // T2-E: unified disclaimer state
  const [refreshing,    setRefreshing]    = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────────
  const mountedRef   = useRef(true);
  const listRef      = useRef<FlashListRef<Message>>(null);
  const userStateRef = useRef<{ code: string; name: string } | null>(null);

  // ── Effects ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const _task = InteractionManager.runAfterInteractions(() => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    });
    return () => { mountedRef.current = false; _task.cancel(); };
  }, []);

  useEffect(() => {
    getUserState().then(s => { userStateRef.current = s; }).catch(() => {});
  }, []);


  useEffect(() => {
    if (initialQuery) setInput(initialQuery);
  }, [initialQuery]);

  // T2-C: hasValidConsent() is now defined above (AsyncStorage-based)
  useEffect(() => {
    hasValidConsent().then(ok => {
      if (ok) setShowDisclaimer(false);
    }).catch(() => {});
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    const st = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    return () => clearTimeout(st);
  }, []);

  const loadHistory = useCallback(async (sid: string) => {
    try {
      const res = await api.get(`/chat/history/${sid}`);
      const msgs: Message[] = unwrapList<Record<string, unknown>>(res.data, 'messages', 'history').map((h: Record<string, unknown>) => ({
        id:   randomId(),
        role: h.role as 'user' | 'assistant',
        text: h.content as string,
      }));
      if (mountedRef.current) setMessages(msgs);
    } catch (e: any) { __DEV__ && console.warn((e as Error)?.message); }
  }, []);

  // T1-L: session load on mount (declared after loadHistory, which it calls)
  useEffect(() => {
    getSessionId().then(id => {
      setSessionId(id);
      loadHistory(id);
    });
  }, [loadHistory]);

  const onRefresh = useCallback(async () => {
    if (!sessionId) return;
    setRefreshing(true);
    await loadHistory(sessionId).catch(() => {});
    setRefreshing(false);
  }, [sessionId, loadHistory]);

  // T2-D: exportConversation catch binds error variable
  const exportConversation = useCallback(async () => {
    if (!messages || messages.length === 0) return;
    try {
      const header = [
        t('x_ch_justice_gavel_ai_conversation'),
        '================================',
        t('x_ch_export_exported', { date: new Date().toLocaleDateString(locale(), {
          year: 'numeric', month: 'long', day: 'numeric',
        }) }),
        caseTitle ? t('x_ch_export_case', { title: caseTitle }) : '',
        '',
      ].filter(Boolean).join('\n');

      const body = (messages ?? []).map(m => {
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

      await RNShare.share({
        message: header + '\n\n' + body + '\n\n' + footer,
        title: t('x_ch_ai_legal_conversation'),
      });
    } catch { /* share cancelled by user — not an error */ }
  }, [messages, caseTitle]);

  const clearChat = useCallback(() => {
confirm(t('x_ch_clear_conversation'), t('x_ch_delete_all_messages_this'),
      { confirmLabel: t('x_ch_clear'), destructive: true }).then(async ok => { if (!ok) return;
  const sid = sessionId || await getSessionId();
    try { await api.delete(`/chat/history/${sid}`); } catch (e: any) { __DEV__ && console.warn((e as Error)?.message); }
    const newId = randomId();
    await AsyncStorage.setItem('chat_session_id', newId);
    setSessionId(newId);
    setMessages([]);
    })
  }, [sessionId, confirm]);

  // ── Send ──────────────────────────────────────────────────────────────────────
  const send = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: Message = { id: randomId(), role: 'user', text: text.trim() };
    hapticImpact().catch(() => {});
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    scrollToBottom();

    // ── Crisis keyword detection — route immediately, skip AI ─────────────────
    const lower = text.trim().toLowerCase();
    // English phrases always match; x_ch_crisis_words / x_ch_dv_words add them in the app language.
    const localWords = (k: string) => t(k).split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
    const CRISIS_WORDS = ['suicide', 'kill myself', 'end it', 'hurt myself', 'overdose', // i18n-exempt: matched, not shown
      'dont want to live', 'want to die', 'harm myself', 'self harm', ...localWords('x_ch_crisis_words')]; // i18n-exempt: matched
    const DV_WORDS = ['hitting me', 'beating me', 'choking me', 'he hit', 'she hit', // i18n-exempt: matched, not shown
      'being abused', 'domestic violence', 'unsafe at home', ...localWords('x_ch_dv_words')]; // i18n-exempt: matched

    if (CRISIS_WORDS.some(w => lower.includes(w))) {
      setMessages(prev => [...prev, {
        id: randomId(), role: 'assistant',
        text: t('x_ch_i_hear_please_reach'),
        suggestLawyerSearch: false,
      }]);
      setLoading(false);
      return;
    }

    if (DV_WORDS.some(w => lower.includes(w))) {
      setMessages(prev => [...prev, {
        id: randomId(), role: 'assistant',
        text: t('x_ch_safety_most_important_thing'),
        suggestLawyerSearch: false,
      }]);
      setLoading(false);
      return;
    }

    // ── Incoherent/too-short input ────────────────────────────────────────────
    if (text.trim().length < 3) {
      setMessages(prev => [...prev, {
        id: randomId(), role: 'assistant',
        text: t('x_ch_i_want_help_can'),
        suggestLawyerSearch: false,
      }]);
      setLoading(false);
      return;
    }

    try {
      const online = await isOnline();
      if (!online) {
        const offlineAnswer = getOfflineAnswer(text.trim());
        setMessages(prev => [...prev, {
          id:   randomId(), role: 'assistant',
          text: offlineAnswer || t('x_ch_re_offline_connect_internet'),
          suggestLawyerSearch: false,
        }]);
        setLoading(false);
        scrollToBottom();
        return;
      }

      // T1-M: single sid resolution; inner re-declaration removed
      const isFirstMsg = messages.length === 0;
      if (isFirstMsg) track('first_ai_message', {}).catch(() => {});
      const sid = sessionId || await getSessionId();

      // ── Streaming path (preferred) ────────────────────────────────────────
      const useStream = typeof EventSource !== 'undefined';
      if (useStream) {
        const placeholderId = randomId();
        setMessages(prev => [...prev, { id: placeholderId, role: 'assistant', text: '' }]);
        scrollToBottom();
        let streamedText = '';
        try {
          const token = await getToken();
          let gotContent = false;
          await new Promise<void>((resolve, reject) => {
            fetch(API_BASE_URL + '/chat/stream', {
              method: 'POST',
              headers: {
                'Content-Type':  'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                ...(deviceTimeZone() ? { 'X-Timezone': deviceTimeZone() as string } : {}),
              },
              body: JSON.stringify({
                message:         text.trim(),
                sessionId:       sid,
                caseId,
                caseTitle,
                mode,
                caseContext,
                user_state:      userStateRef.current?.code || null,
                user_state_name: userStateRef.current?.name || null,
              }),
            }).then(async response => {
              if (!response.ok || !response.body) {
                if (TERMINAL_STREAM_STATUSES.has(response.status)) {
                  const data = await response.json().catch(() => ({}));
                  throw new StreamHttpError(response.status, data as Record<string, unknown>);
                }
                throw new Error('Stream unavailable');
              }
              const reader  = response.body.getReader();
              const decoder = new TextDecoder();
              let buffer = '';
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                  if (!line.startsWith('data: ')) continue;
                  try {
                    const event = JSON.parse(line.slice(6));
                    if (event.type === 'token') {
                      gotContent = true;
                      streamedText += event.text;
                      setMessages(prev => prev.map(m =>
                        m.id === placeholderId
                          ? { ...m, text: m.text + event.text }
                          : m
                      ));
                    } else if (event.type === 'done') {
                      gotContent = true;
                      setMessages(prev => prev.map(m =>
                        m.id === placeholderId ? {
                          ...m,
                          text:                event.full_text,
                          intent:              event.intent,
                          suggestLawyerSearch: event.suggestLawyerSearch,
                          rightsRefs:          Array.isArray(event.rights_refs) ? event.rights_refs : undefined,
                        } : m
                      ));
                      scrollToBottom();
                      resolve();
                    } else if (event.type === 'error') {
                      reject(new Error(event.message));
                    }
                  } catch { /* malformed SSE chunk — skip */ }
                }
              }
              // A stream that ends without any content is treated as a failure
              // so the request falls back to the job-queue endpoint below.
              if (gotContent) resolve(); else reject(new Error('Empty stream'));
            }).catch(reject);
          });
          // T1-N: setSending → setLoading
          setLoading(false);
          return; // streaming succeeded — skip fallback
        } catch (streamErr) {
          if (streamErr instanceof StreamHttpError) {
            // Same answer /chat/ask would give — handle it once, don't re-send.
            setMessages(prev => prev.filter(m => m.id !== placeholderId));
            throw streamErr;
          }
          if (streamedText) {
            // The answer was already streaming (and billed): keep what arrived
            // instead of asking the same question a second time.
            setMessages(prev => prev.map(m => m.id === placeholderId
              ? { ...m, text: t('x_ch_answer_was_cut_off', { streamedText }) }
              : m));
            setLoading(false);
            return;
          }
          // Nothing arrived (no SSE support / proxy / network) — fall back to the job queue once.
          setMessages(prev => prev.filter(m => m.id !== placeholderId));
        }
      }

      // ── Fallback: async job queue ─────────────────────────────────────────
      const res = await api.post('/chat/ask', {
        message:         text.trim(),
        caseId:          caseId    || undefined,
        caseTitle:       caseTitle || undefined,
        sessionId:       sid,
        mode,
        caseContext,
        user_state:      userStateRef.current?.code || null,
        user_state_name: userStateRef.current?.name || null,
      });

      if (res.data?.jobId) {
        const jobId         = res.data?.jobId;
        const placeholderId = randomId();
        setMessages(prev => [...prev, { id: placeholderId, role: 'assistant', text: t('x_ch_thinking') }]);
        scrollToBottom();
        pollJob(jobId, {
          onProgress: ({ status, elapsed }: { status: string; elapsed: number }) => {
            const sec   = Math.round(elapsed / 1000);
            const phase = status === 'processing'
              ? (sec < 5 ? t('x_ch_thinking') : sec < 20 ? t('x_ch_analyzing') : t('x_ch_almost_there'))
              : t('x_ch_waiting_queue');
            setMessages(prev => prev.map(m => m.id === placeholderId ? { ...m, text: phase } : m));
          },
        }).then((job: any) => {
          const d = job.result || {};
          setMessages(prev => prev.map(m =>
            m.id === placeholderId
              ? {
                  id: randomId(), role: 'assistant',
                  text:                (d.reply as string) || (d.answer as string) || t('x_ch_done'),
                  suggestLawyerSearch: d.suggestLawyerSearch as boolean,
                  intent:              d.intent as string,
                  rightsRefs:          Array.isArray(d.rights_refs) ? (d.rights_refs as RightsRef[]) : undefined,
                }
              : m
          ));
          setLoading(false);
          scrollToBottom();
        }).catch((e: Error) => {
          setMessages(prev => prev.map(m =>
            m.id === placeholderId
              ? { id: randomId(), role: 'assistant', text: '⚠️ ' + (e.message || t('x_ch_request_failed_try_again')) }
              : m
          ));
          setLoading(false);
          scrollToBottom();
        });
        return;
      }

      // Sync fallback
      setMessages(prev => [...prev, {
        id: randomId(), role: 'assistant',
        text:                res.data?.reply,
        suggestLawyerSearch: res.data?.suggestLawyerSearch,
        intent:              res.data?.intent,
      }]);

    } catch (e: any) {
      const status = (e as { response?: { status?: number; data?: { code?: string; error?: string } } }).response?.status;
      const code   = (e as { response?: { data?: { code?: string } } }).response?.data?.code;

      if (isDisclaimerRequired(e)) {
        notifyDisclaimerRequired();
        setMessages(prev => [...prev, {
          id: randomId(), role: 'assistant',
          text: t('x_ch_before_using_ai_chat'),
          suggestLawyerSearch: false,
        }]);
      } else if (status === 402 || code === 'chat_limit_reached') {
        setMessages(prev => [...prev, {
          id: randomId(), role: 'assistant',
          text: t('x_ch_ve_used_free_ai'),
          suggestLawyerSearch: false,
          showUpgrade: true,
        }]);
      } else if (status === 503 || status === 500) {
        const aiDown = isAiUnavailable(e) || status === 503;
        setMessages(prev => [...prev, {
          id: randomId(), role: 'assistant',
          text: aiDown
            ? t('x_ch_ai_chat_temporarily_unavailable')
            : t('x_ch_server_had_error_please'),
          suggestLawyerSearch: false,
        }]);
      } else if (!status) {
        setMessages(prev => [...prev, {
          id: randomId(), role: 'assistant',
          text: t('x_ch_no_connection_check_internet'),
          suggestLawyerSearch: false,
        }]);
      } else {
        setMessages(prev => [...prev, {
          id: randomId(), role: 'assistant',
          text: t('x_ch_sorry_i_had_trouble'),
          suggestLawyerSearch: false,
        }]);
      }
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }, [sessionId, loading, scrollToBottom, caseContext, caseId, caseTitle, mode, messages.length]);

  // ── Navigation helpers ────────────────────────────────────────────────────────
  const onFindLawyer = () => navigation.navigate('Match');
  const onUpgrade    = () => navigation.navigate('MoreTab', { screen: 'ConsumerSubscription' });


  const isEmpty = messages.length === 0 && !loading;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text maxFontSizeMultiplier={1.4} style={styles.headerTitle}>{t('x_ch_legal_help')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.headerSub}>{t('x_ch_ai_powered_rights_guide')}</Text>
        </View>
        {messages.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={exportConversation}
              style={styles.clearBtn}
              testID="chat-export-button"
             accessibilityLabel={t('x_ch_share_conversation')}>
              <Text maxFontSizeMultiplier={1.4} style={styles.clearBtnText}>{t('share')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={clearChat}
              style={styles.clearBtn}
             accessibilityLabel={t('x_ch_clear')}>
              <Text maxFontSizeMultiplier={1.4} style={styles.clearBtnText}>{t('x_ch_clear')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Disclaimer banner — dismisses after user taps */}
      {showDisclaimer && (
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.6}
          onPress={() => {
            setShowDisclaimer(false);
            recordConsent();
          }}
          style={{
            backgroundColor: colors.bgCard, borderRadius: 8,
            padding: 12, margin: 12,
            borderLeftWidth: 3, borderLeftColor: colors.gold,
          }}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: colors.goldText, fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 12, marginBottom: 4 }}>
            {t('x_ch_ai_legal_information_not')}
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textSecond, fontSize: 11, lineHeight: 16 }}>
            {t('x_ch_i_am_ai_guide')}
          </Text>
        </TouchableOpacity>
      )}

      {/* Messages or empty state */}
      {isEmpty ? (
        <View style={styles.emptyState}>
          <AppIcon name="scale-outline" size={20} color={COLORS.navy} />
          <Text maxFontSizeMultiplier={1.4} style={styles.emptyTitle}>{t('ja_s1')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.emptySub}>
            {t('x_ch_ask_anything_about_legal')}
          </Text>
          <View style={styles.quickPrompts}>
            {/* T1-P: onPress fixed — no longer split across lines */}
            {QUICK_PROMPTS().map(p => (
              <TouchableOpacity
                accessibilityRole="button"
                key={p.label}
                style={styles.quickChip}
                accessibilityLabel={p.label} onPress={() => send(p.text)}
              >
                <Text maxFontSizeMultiplier={1.4} style={styles.quickChipText}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : (
        // T1-Q: renderItem and ListEmptyComponent are separate props, cleanly formatted
        <FlashList<Message>
          ref={listRef}
          keyboardShouldPersistTaps="handled"
          data={messages}
          keyExtractor={m => m.id}
          onRefresh={onRefresh}
          refreshing={refreshing}
          renderItem={({ item }) => (
            <Bubble
              msg={item}
              isDefender={isDefender}
              onFindLawyer={onFindLawyer}
              onUpgrade={onUpgrade}
              onOpenRights={() => (navigation as any).navigate('MoreTab', { screen: 'RightsCard' })}
            />
          )}
          ListEmptyComponent={
            <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 }}>
              {t('x_ch_start_conversation_ask_any')}
            </Text>
          }
          contentContainerStyle={styles.messageList}
          onContentSizeChange={scrollToBottom}
        />
      )}

      {/* Typing indicator */}
      {loading && (
        <View style={styles.typingRow}>
          <View style={[styles.avatarDot, isDefender && styles.avatarDotDefender]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.avatarText}>
              {isDefender ? '⚖️' : 'JG'}
            </Text>
          </View>
          <View style={styles.typingBubble}>
            <ActivityIndicator size="small" color={colors.navy} />
            <Text maxFontSizeMultiplier={1.4} style={styles.typingText}>{t('chat_thinking')}</Text>
          </View>
        </View>
      )}

      {/* Input bar */}
      {/* T1-R: stray '>' after JSX comments removed throughout */}
      <View style={styles.inputBar}>
        {/* Voice input button */}
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.iconBtn}
          onPress={() => navigation.navigate('MoreTab', { screen: 'VoiceNote'})}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityHint={t('x_ch_opens_voice_recorder_transcribe')}
        >
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 20 }}>🎙</Text>
        </TouchableOpacity>

        <TextInput
          style={styles.textInput}
          placeholder={t('x_ch_ask_anything_what_should')}
          placeholderTextColor={colors.textMuted}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={500}
          returnKeyType="send"
          onSubmitEditing={() => send(input)}
        />

        {/* Translate button */}
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.iconBtn}
          onPress={() => navigation.navigate('MoreTab', { screen: 'Translator'})}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel={t('x_ch_open_interpreter')}
          accessibilityHint={t('x_ch_opens_real_time_translation')}
        >
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 20 }}>🌐</Text>
        </TouchableOpacity>

        {/* T1-S: closing '>' on TouchableOpacity restored */}
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
          onPress={() => send(input)}
          disabled={!input.trim() || loading}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.sendBtnText, (!input.trim() || loading) && styles.sendBtnTextDisabled]}>↑</Text>
        </TouchableOpacity>
      </View>

      <Text maxFontSizeMultiplier={1.4} style={styles.disclaimer}>
        {t('x_ch_not_legal_advice_emergencies')}
      </Text>
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
  avatarDotDefender:{ backgroundColor: COLORS.navy },
  avatarText:       { color: COLORS.bgCard, fontSize: 11, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 0.5 },
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
  typingRow:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8 },
  typingBubble:     { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgCard, borderRadius: 16, padding: 10, gap: 8, elevation: 1 },
  typingText:       { fontSize: 12, lineHeight: 20, color: colors.textMuted },
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