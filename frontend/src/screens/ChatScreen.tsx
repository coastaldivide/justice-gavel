/**
 * ChatScreen — Full conversation UI wired to Claude backend
 *
 * Fixes applied (v5.4.0):
 *   T1-A  Removed useFocusEffect + clearChat() from Bubble sub-component
 *   T1-B  Added isDefender prop to Bubble
 *   T1-C  Removed stray '>' after conditional close on avatar row
 *   T1-D  Changed <View onLongPress> → <Pressable> (View ignores touch props)
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

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView,
  Platform, Pressable, Share, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';

import type { ScreenProps } from '../types/navigation';
import { api }            from '../services/api';
import { pollJob }        from '../services/jobPoller';
import { isOnline }       from '../services/offlineCache';
import { t }              from '../i18n';
import { getUserState }   from '../utils/userState';
import { getToken }       from '../utils/secureStorage';
import { useTheme }       from '../constants/theme';
import { hapticImpact }   from '../utils/webCompat';

// ── Static colour palette used in module-scope constants and StyleSheet ────────
// (useTheme() is hook-only; these mirror the dark-navy design system values)
const COLORS = {
  bg:          COLORS.bg,
  bgCard:      colors.surface,
  bgSubtle:    COLORS.border,
  navy:        '#042C53',
  gold:        COLORS.gold,
  textSecond:  COLORS.steel,
  textFaint:   COLORS.textMuted,
  textMuted:   COLORS.textMuted,
};

// ── Message shape ──────────────────────────────────────────────────────────────
interface Message {
  id:                  string;
  role:                'user' | 'assistant';
  text:                string;
  suggestLawyerSearch?: boolean;
  intent?:             string;
  showUpgrade?:        boolean;
}

// ── Cryptographically secure session token ────────────────────────────────────
function randomId(): string {
  const arr = new Uint32Array(2);
  crypto.getRandomValues(arr);
  return Array.from(arr, n => n.toString(36)).join('');
}

async function getSessionId(): Promise<string> {
  let id = await AsyncStorage.getItem('chat_session_id');
  if (!id) { id = randomId(); await AsyncStorage.setItem('chat_session_id', id); }
  return id;
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
}

function Bubble({ msg, isDefender, onFindLawyer, onUpgrade }: BubbleProps) {
  const isUser = msg.role === 'user';

  const handleLongPress = () => {
    const text = msg.text || '';
    Alert.alert('Message Options', 'Select an action for this message', [
      { text: 'Copy',   onPress: () => Clipboard.setStringAsync(text).catch(() => {}) },
      { text: 'Share',  onPress: () => { try { Share.share({ message: text }); } catch (_) {} } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={[styles.bubbleWrap, isUser && styles.bubbleWrapUser]}>
      {!isUser && (
        <View style={[styles.avatarDot, isDefender && styles.avatarDotDefender]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.avatarText}>
            {isDefender ? '⚖️' : 'JG'}
          </Text>
        </View>
      )}
      <Pressable
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
        {msg.suggestLawyerSearch && !isUser && (
          <TouchableOpacity
            style={styles.lawyerCta}
            onPress={onFindLawyer}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.lawyerCtaText}>
              📍 {t('chat_find_lawyer')}
            </Text>
          </TouchableOpacity>
        )}
        {msg.showUpgrade && !isUser && (
          <TouchableOpacity
            style={styles.upgradeCta}
            onPress={onUpgrade}
            accessibilityRole="button"
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
const PROMPT_CATEGORIES = [
  {
    category: t('chat_cat_emergency'),
    color: COLORS.emergency,          // was COLORS.emergencyDark
    prompts: [
      { label: t('chat_prompt_just_arrested'), text: 'I was just arrested. What should I do right now?' },
      { label: t('chat_prompt_know_rights'),   text: 'What are my rights during a police stop?' },
      { label: t('chat_prompt_dui'),           text: 'I was charged with a DUI. What happens next?' },
      { label: t('chat_prompt_need_lawyer'),   text: 'I need a criminal defense lawyer. Can you help me find one?' },
    ],
  },
  {
    category: t('chat_cat_drug_criminal'),
    color: COLORS.blue,          // was COLORS.blue
    prompts: [
      { label: t('chat_prompt_drug'),         text: 'I was charged with drug possession. What are my options?' },
      { label: t('chat_prompt_assault'),      text: 'I have an assault charge. What should I expect?' },
      { label: t('chat_prompt_expungement'),  text: 'Can I get my arrest record expunged?' },
      { label: t('chat_prompt_probation'),    text: 'I may have violated my probation. What happens next?' },
    ],
  },
  {
    category: t('chat_cat_family'),
    color: COLORS.blue,
    prompts: [
      { label: t('chat_prompt_divorce'),     text: 'I want to file for divorce. What are the steps?' },
      { label: t('chat_prompt_custody'),     text: 'How does child custody work in my state?' },
      { label: t('chat_prompt_restraining'), text: 'How do I get a restraining order?' },
      { label: t('chat_prompt_tenant'),      text: 'My landlord is trying to evict me. What are my rights?' },
    ],
  },
  {
    category: t('chat_cat_work'),
    color: COLORS.navy,          // was COLORS.legalDark
    prompts: [
      { label: t('chat_prompt_wrongful'),    text: 'I think I was wrongfully fired. What can I do?' },
      { label: t('chat_prompt_wage'),        text: 'My employer is not paying me correctly. What are my options?' },
      { label: t('chat_prompt_bankruptcy'),  text: 'What are my options if I cannot pay my debts?' },
      { label: t('chat_prompt_claims'),      text: 'How do I file a small claims court case?' },
    ],
  },
  {
    category: t('chat_cat_immigration'),
    color: COLORS.emergency,          // was COLORS.warnDark
    prompts: [
      { label: t('chat_prompt_ice'),   text: 'A family member was detained by ICE. What should we do?', intent: 'ice_detention' },
      { label: t('chat_prompt_asylum'),text: 'How do I apply for asylum in the US?' },
      { label: t('chat_prompt_visa'),  text: 'My visa is expiring. What are my options?' },
      { label: t('chat_prompt_daca'),  text: 'What are my rights as a DACA recipient?' },
    ],
  },
];

const QUICK_PROMPTS = PROMPT_CATEGORIES[0].prompts;

// ── Offline AI response cache ──────────────────────────────────────────────────
const OFFLINE_QA: { q: string[]; a: string }[] = [
  { q: ['miranda', 'miranda rights', 'what are my rights'],
    a: "You have the right to remain silent -- use it. You have the right to an attorney -- ask for one immediately. If you cannot afford an attorney, one must be appointed for you. Do not answer any questions about the alleged offense until your attorney is present. Say only: 'I am invoking my right to remain silent and my right to an attorney.' Then stop talking." },
  { q: ['bail', 'how does bail work', 'what is bail'],
    a: "Bail is money paid to the court to secure release from jail before trial. The judge sets the amount at a bail hearing, usually within 24-72 hours of arrest. You can pay the full amount directly (gets returned after the case), or use a bail bondsman who pays it for a non-refundable fee (typically 10%). If you cannot make bail, you stay in custody until trial or until the bail is reduced. Your attorney can file a motion to reduce bail." },
  { q: ['arraignment', 'what happens at arraignment'],
    a: "Arraignment is your first formal court appearance -- usually within 24-72 hours of arrest. The judge reads the charges, you enter a plea (not guilty is almost always the right plea at arraignment), and bail is set or reviewed. Keep it short: enter not guilty, say nothing else. Your attorney does the talking." },
  { q: ['attorney', 'public defender', 'do i get a lawyer', 'can i afford a lawyer'],
    a: "You have a constitutional right to an attorney. If you cannot afford one, the court will appoint a public defender at no cost. Request a public defender at arraignment. A public defender is a licensed attorney -- they handle thousands of these cases and know the local courts. Do not waive your right to an attorney." },
  { q: ['phone call', 'right to a phone call'],
    a: "You have the right to make a phone call after arrest. In most states this must be allowed within a reasonable time -- usually a few hours. Use it to call a family member or an attorney. Do not use it to discuss the facts of your case -- jail calls are recorded." },
  { q: ['search', 'can police search me', 'illegal search'],
    a: "Police can search you without a warrant if: you consent (never consent), you are being arrested (incident to arrest), they see evidence in plain view, there are exigent circumstances (emergency), or a warrant has been issued. Do not consent to any search. Say: 'I do not consent to a search.' If searched anyway, do not resist -- raise it with your attorney as a Fourth Amendment suppression issue." },
  { q: ['right to remain silent', '5th amendment', 'self incrimination'],
    a: "The Fifth Amendment protects you from being forced to testify against yourself. You can invoke this right at any time -- before, during, or after arrest. Simply say: 'I am invoking my Fifth Amendment right to remain silent.' After that, answer no questions about the alleged offense. This includes questions that seem harmless. Silence cannot be used against you -- but anything you say can." },
  { q: ['expungement', 'clear my record', 'seal my record'],
    a: "Expungement seals or destroys criminal records so they do not appear on background checks. Eligibility depends on your state, the charge, how much time has passed, and whether you completed your sentence. Most first-time non-violent misdemeanors are eligible after a waiting period. Use the Expungement Checker in this app for your specific state and charge type." },
  { q: ['dui', 'dwi', 'drunk driving'],
    a: "A DUI/DWI arrest triggers two separate proceedings: a criminal case and an administrative DMV hearing to suspend your license. The license suspension hearing has a short deadline -- usually 7-10 days after arrest -- and is separate from the criminal case. You need an attorney for both. Do not plead guilty at arraignment. Many DUI defenses involve the accuracy of the breathalyzer, the legality of the stop, and the field sobriety test procedure." },
  { q: ['domestic violence', 'domestic battery'],
    a: "Domestic violence charges often involve mandatory arrest policies -- police may be required to arrest even if the alleged victim does not want to press charges. The state, not the victim, prosecutes the case. Immigration consequences for non-citizens are severe. Bail may involve a protective order prohibiting contact. Do not contact the alleged victim, even if they want you to -- violating a protective order is a separate crime." },
  { q: ['drug possession', 'possession', 'controlled substance'],
    a: "Drug possession charges vary by substance, quantity, and whether the state considers it simple possession or possession with intent to distribute. First-time possession charges may qualify for diversion programs -- completing the program results in no conviction. Immigration consequences for non-citizens are severe even for minor drug offenses. Use the Diversion Checker in this app." },
  { q: ['felony', 'what is a felony'],
    a: "A felony is a serious crime typically punishable by more than one year in prison (as opposed to a misdemeanor, which carries less than one year). Felony convictions have severe collateral consequences: loss of voting rights in many states, loss of the right to possess firearms, bars to public housing and some employment, and immigration consequences for non-citizens. Never plead guilty to a felony without fully understanding these consequences." },
  { q: ['misdemeanor', 'what is a misdemeanor'],
    a: "A misdemeanor is a lesser criminal offense typically punishable by up to one year in jail (not prison). Class A or Class 1 misdemeanors are the most serious; Class C or Class 3 are the least serious. Even misdemeanors can have significant consequences for employment, housing, and immigration. Many misdemeanors are eligible for expungement after a waiting period." },
  { q: ['probable cause', 'what is probable cause'],
    a: "Probable cause is the legal standard police must meet before making an arrest or conducting a search. It means there is a reasonable basis to believe a crime has been committed. It is more than a hunch but less than certainty. If police arrested you or searched you without probable cause, your attorney can file a motion to suppress any evidence obtained as a result." },
  { q: ['plea deal', 'plea bargain', 'should i take a plea'],
    a: "A plea bargain is an agreement to plead guilty in exchange for a reduced charge or lighter sentence. Whether to accept depends on the strength of the evidence against you, the likely outcome at trial, and your personal circumstances. Never accept a plea without consulting an attorney who has reviewed the discovery. Once you plead guilty, it is very difficult to reverse." },
  { q: ['jury trial', 'right to jury trial'],
    a: "You have a constitutional right to a jury trial for any offense carrying more than six months in jail. A jury of 12 (or 6 in some states for misdemeanors) must unanimously agree you are guilty beyond a reasonable doubt. In a bench trial, a judge decides. Your attorney can advise which is more advantageous for your specific case and judge." },
  { q: ['discovery', 'what is discovery'],
    a: "Discovery is the process through which you get to see the evidence the prosecution plans to use against you. It includes police reports, witness statements, lab results, body camera footage, and anything the prosecution knows that might help your defense (Brady material). Your attorney files a motion for discovery. Under Brady v. Maryland, the prosecution must turn over any evidence favorable to the defense." },
  { q: ['speedy trial', 'how long can they hold me'],
    a: "The Sixth Amendment guarantees the right to a speedy trial. Most states have specific speedy trial deadlines -- typically 70-180 days from arrest for felonies. Excessive delays can result in dismissal. If you are held in custody and your case is not being resolved, your attorney should file a motion asserting your speedy trial rights." },
  { q: ['bond', 'bondsman', 'bail bondsman'],
    a: "A bail bondsman posts bail on your behalf in exchange for a non-refundable fee -- typically 10% of the bail amount. If bail is $10,000, you pay the bondsman $1,000 and they pay the court the full $10,000. If you fail to appear, the bondsman is responsible for the full amount and may send a bounty hunter to find you. The bondsman fee is never returned." },
  { q: ['suppress', 'motion to suppress', 'throw out evidence'],
    a: "A motion to suppress asks the court to exclude evidence obtained in violation of your constitutional rights -- typically the Fourth Amendment (unlawful search), Fifth Amendment (coerced statement), or Sixth Amendment (interrogation after counsel invoked). If the motion is granted, the suppressed evidence cannot be used at trial. This often leads to reduced charges or dismissal." },
  { q: ['immigration', 'deportation', 'ice', 'non-citizen'],
    a: "A criminal conviction -- even a misdemeanor -- can trigger deportation, inadmissibility, or loss of DACA status for non-citizens. Immigration consequences depend on the exact charge, not the name of the offense. Never plead guilty without having an immigration attorney review the immigration consequences. See the Immigration Consequences section of this app for detail by offense type." },
  { q: ['juvenile', 'minor', 'under 18', 'teen'],
    a: "Juvenile court is separate from adult court and uses different terminology -- adjudicated delinquent, not convicted. Records are confidential in most states and can often be sealed automatically or by petition. A juvenile cannot waive Miranda rights in many states without a parent or attorney present. The most dangerous event is a transfer to adult court -- fight it immediately. See the Juvenile Justice section of this app." },
  { q: ['parole', 'probation', 'what is parole'],
    a: "Probation is supervision instead of (or in addition to) jail time, ordered at sentencing. Parole is early release from prison under supervision. Both involve conditions -- regular check-ins, drug testing, no new offenses, and often restrictions on travel and association. A violation can result in revocation and the underlying sentence being imposed. Attend every check-in. Communicate proactively with your officer." },
  { q: ['court date', 'miss court', 'missed hearing'],
    a: "Missing a court date results in a bench warrant for your arrest and often forfeiture of any bail paid. Appear at every court date. If you cannot appear due to a genuine emergency, your attorney must notify the court immediately and file a motion to continue. Do not simply not show up -- a bench warrant stays active until you are arrested or surrender." },
  { q: ['what do i do', 'arrested', 'just arrested', 'i was arrested'],
    a: "Do these things in order: 1) Say nothing except 'I want a lawyer.' 2) Do not resist -- comply physically while invoking rights verbally. 3) Remember the officer's name and badge number. 4) Use your phone call to contact family or an attorney. 5) Do not discuss the case with anyone in the jail -- conversations are monitored. 6) At arraignment, plead not guilty. 7) Find a criminal defense attorney before your next court date." },
  { q: ['dui', 'dwi', 'drunk driving', 'drinking and driving', 'i was drinking'],
    a: "After a DUI arrest -- do this immediately:\n1. DO NOT answer questions about drinking (invoke silence + lawyer)\n2. You have 7-10 DAYS to request a DMV hearing or your license is automatically suspended -- this is separate from the criminal case\n3. A DUI attorney can often negotiate a better outcome than you expect\n4. You will be arraigned within 24-72 hours -- plead NOT GUILTY\n\nUse the Deadline Calculator in this app to track your DMV deadline." },
  { q: ['just arrested', 'i was arrested', 'what do i do', 'help me', 'arrested'],
    a: "Right now -- the only 3 things that matter:\n\n1. SAY: 'I am invoking my right to remain silent and I want a lawyer.' Then stop talking.\n2. Do NOT consent to any searches.\n3. Use your phone call to call a bail bondsman or attorney -- NOT to discuss what happened.\n\nEverything else can wait. Open the HelpNow screen in this app to find a bondsman and attorney near you." },
  { q: ['domestic violence', 'dv', 'hit my partner', 'my partner hit me', 'domestic'],
    a: "Domestic violence situations:\n\nIF YOU ARE IN DANGER: Call 911 immediately.\nNational DV Hotline: 1-800-799-7233 (24/7, free, confidential)\n\nIF YOU WERE CHARGED:\n• Do not contact the alleged victim -- even if they want you to\n• Comply with any protective order completely\n• The state prosecutes DV cases -- the victim cannot 'drop charges'\n• Get a defense attorney immediately" },
  { q: ['drug', 'drugs', 'possession', 'weed', 'marijuana', 'cocaine', 'meth'],
    a: "For a drug possession charge:\n\n1. STAY SILENT -- drug cases are often built on statements you make\n2. The most common defense is an unlawful search -- if police searched without a warrant or consent, evidence may be suppressed\n3. First-time possession often qualifies for diversion programs (no conviction)\n4. Public defenders handle drug cases routinely\n\nOpen 'Drug Charge Penalties' in this app to see what your state\'s laws say." },
  { q: ['i cant afford', 'no money', 'broke', 'poor', 'free help'],
    a: "You have FREE options:\n\n1. PUBLIC DEFENDER -- Free attorney appointed by the court. Real lawyers. Request one at arraignment.\n2. LAW SCHOOL CLINICS -- Law students supervised by professors handle real cases for free. Find one in Resources.\n3. LEGAL AID -- Income-based free legal help. Find in Resources.\n4. SELF-REPRESENTATION -- Last resort but possible for minor charges.\n\nYou always have options. Open Resources in this app to find free help near you." },
  { q: ['scared', 'nervous', 'freaking out', 'panic', 'help', 'please help'],
    a: "Take a breath. You can get through this.\n\nRight now, the most important thing: Don't talk to police about the incident. Just say you want a lawyer.\n\nThis app can help you find a bail bondsman to get out of jail, an attorney to defend you, and a public defender if you can\'t afford one.\n\nTap 'HelpNow' on the home screen to get connected immediately." },
  { q: ['probation', 'violated probation', 'probation violation', 'missed check in'],
    a: "If you violated probation:\n\n1. Contact your probation officer proactively -- being upfront is always better than them finding out\n2. Get an attorney before your next PO meeting if possible\n3. A probation violation hearing has a LOWER standard of proof than a criminal trial\n4. First violations often result in increased conditions, not automatic revocation\n\nDocument any circumstances that explain the violation (medical issue, job loss, etc.)." },
];

// T1-H/I: hooks removed from function body; function closes cleanly with return null
function getOfflineAnswer(query: string): string | null {
  const q = query.toLowerCase().trim();
  for (const entry of OFFLINE_QA) {
    if (entry.q.some(keyword => q.includes(keyword))) {
      return entry.a + '\n\n_Offline response -- cached answer. Connect to the internet for a personalized AI response._';
    }
  }
  return null;
}

// ── ChatScreen ─────────────────────────────────────────────────────────────────
// T1-J: function signature is on one line; all hooks are inside the function body
export default function ChatScreen({ navigation, route }: ScreenProps) {
  const { colors, isDark } = useTheme();
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
  // T1-L: correct generic type; no JSX attribute in type parameter
  const listRef      = useRef<FlatList<Message>>(null);
  const userStateRef = useRef<{ code: string; name: string } | null>(null);

  // ── Effects ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    getUserState().then(s => { userStateRef.current = s; }).catch(() => {});
  }, []);

  // T1-L: session load moved into useEffect (was floating outside any hook)
  useEffect(() => {
    getSessionId().then(id => {
      setSessionId(id);
      loadHistory(id);
    });
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
      const msgs: Message[] = (res.data || []).map((h: Record<string, unknown>) => ({
        id:   randomId(),
        role: h.role as 'user' | 'assistant',
        text: h.content as string,
      }));
      if (mountedRef.current) setMessages(msgs);
    } catch (e) { __DEV__ && console.warn((e as Error)?.message); }
  }, []);

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
        'Justice Gavel AI Conversation',
        '================================',
        `Exported: ${new Date().toLocaleDateString('en-US', {
          year: 'numeric', month: 'long', day: 'numeric',
        })}`,
        caseTitle ? `Case: ${caseTitle}` : '',
        '',
      ].filter(Boolean).join('\n');

      const body = messages.map(m => {
        const sender = m.role === 'assistant' ? 'Justice Gavel AI' : 'You';
        return `[${sender}]\n${m.text}`;
      }).join('\n\n---\n\n');

      const footer = [
        '', '================================',
        'IMPORTANT: This conversation is general legal information only.',
        'It is not legal advice. Consult a licensed attorney for advice',
        'specific to your situation.', '',
        'Justice Gavel · justicegavel.app',
      ].join('\n');

      await Share.share({
        message: header + '\n\n' + body + '\n\n' + footer,
        title: 'AI Legal Conversation',
      });
    } catch (_e) { /* share cancelled by user — not an error */ }
  }, [messages, caseTitle]);

  const clearChat = useCallback(async () => {
    const sid = sessionId || await getSessionId();
    try { await api.delete(`/chat/history/${sid}`); } catch (e) { __DEV__ && console.warn((e as Error)?.message); }
    const newId = randomId();
    await AsyncStorage.setItem('chat_session_id', newId);
    setSessionId(newId);
    setMessages([]);
  }, [sessionId]);

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
    const CRISIS_WORDS = ['suicide', 'kill myself', 'end it', 'hurt myself', 'overdose',
      'dont want to live', 'want to die', 'harm myself', 'self harm'];
    const DV_WORDS = ['hitting me', 'beating me', 'choking me', 'he hit', 'she hit',
      'being abused', 'domestic violence', 'unsafe at home'];

    if (CRISIS_WORDS.some(w => lower.includes(w))) {
      setMessages(prev => [...prev, {
        id: randomId(), role: 'assistant',
        text: "I hear you. Please reach out for immediate support right now:\n\n📞 988 Suicide & Crisis Lifeline -- call or text 988 (free, 24/7)\n📞 Crisis Text Line -- text HOME to 741741\n\nYou don't have to face this alone. These counselors are trained to help and will listen without judgment.\n\nIf you're in immediate danger, call 911.",
        suggestLawyerSearch: false,
      }]);
      setLoading(false);
      return;
    }

    if (DV_WORDS.some(w => lower.includes(w))) {
      setMessages(prev => [...prev, {
        id: randomId(), role: 'assistant',
        text: "Your safety is the most important thing right now.\n\n🔴 If you are in immediate danger -- call 911\n\n📞 National DV Hotline: 1-800-799-7233 (24/7, confidential)\n💬 Text START to 88788\n\nI can also help you find a local shelter, understand your legal rights, or locate the nearest public defender. What do you need right now?",
        suggestLawyerSearch: false,
      }]);
      setLoading(false);
      return;
    }

    // ── Incoherent/too-short input ────────────────────────────────────────────
    if (text.trim().length < 3) {
      setMessages(prev => [...prev, {
        id: randomId(), role: 'assistant',
        text: "I want to help -- can you tell me a little more about what's going on? For example:\n\n• \"I was just arrested -- what do I do?\"\n• \"How do I find a bail bondsman?\"\n• \"What are my rights if police stop me?\"",
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
          text: offlineAnswer || "You're offline. Connect to the internet for AI responses.\n\nTip: common questions like Miranda rights, bail, arraignment, and expungement are available offline -- try asking about those.",
          suggestLawyerSearch: false,
        }]);
        setLoading(false);
        scrollToBottom();
        return;
      }

      // T1-M: single sid resolution; inner re-declaration removed
      const sid = sessionId || await getSessionId();

      // ── Streaming path (preferred) ────────────────────────────────────────
      const useStream = typeof EventSource !== 'undefined';
      if (useStream) {
        const placeholderId = randomId();
        setMessages(prev => [...prev, { id: placeholderId, role: 'assistant', text: '' }]);
        scrollToBottom();
        try {
          const token = await getToken();
          await new Promise<void>((resolve, reject) => {
            fetch((api.defaults?.baseURL || '') + '/chat/stream', {
              method: 'POST',
              headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${token}`,
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
              if (!response.ok || !response.body) throw new Error('Stream unavailable');
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
                      setMessages(prev => prev.map(m =>
                        m.id === placeholderId
                          ? { ...m, text: m.text + event.text }
                          : m
                      ));
                    } else if (event.type === 'done') {
                      setMessages(prev => prev.map(m =>
                        m.id === placeholderId ? {
                          ...m,
                          text:                event.full_text,
                          intent:              event.intent,
                          suggestLawyerSearch: event.suggestLawyerSearch,
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
              resolve();
            }).catch(reject);
          });
          // T1-N: setSending → setLoading
          setLoading(false);
          return; // streaming succeeded — skip fallback
        } catch {
          // Streaming failed — remove placeholder and fall through to pollJob
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
        setMessages(prev => [...prev, { id: placeholderId, role: 'assistant', text: '⏳ Thinking…' }]);
        scrollToBottom();
        pollJob(jobId, {
          onProgress: ({ status, elapsed }: { status: string; elapsed: number }) => {
            const sec   = Math.round(elapsed / 1000);
            const phase = status === 'processing'
              ? (sec < 5 ? '⏳ Thinking…' : sec < 20 ? '⏳ Analyzing…' : '⏳ Almost there…')
              : '⏳ Waiting in queue…';
            setMessages(prev => prev.map(m => m.id === placeholderId ? { ...m, text: phase } : m));
          },
        }).then((job: { result?: Record<string, unknown> }) => {
          const d = job.result || {};
          setMessages(prev => prev.map(m =>
            m.id === placeholderId
              ? {
                  id: randomId(), role: 'assistant',
                  text:                (d.reply as string) || (d.answer as string) || 'Done.',
                  suggestLawyerSearch: d.suggestLawyerSearch as boolean,
                  intent:              d.intent as string,
                }
              : m
          ));
          setLoading(false);
          scrollToBottom();
        }).catch((e: Error) => {
          setMessages(prev => prev.map(m =>
            m.id === placeholderId
              ? { id: randomId(), role: 'assistant', text: '⚠️ ' + (e.message || 'Request failed. Try again.') }
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

    } catch (e) {
      const status = (e as { response?: { status?: number; data?: { code?: string; error?: string } } }).response?.status;
      const code   = (e as { response?: { data?: { code?: string } } }).response?.data?.code;

      if (status === 402 || code === 'chat_limit_reached') {
        setMessages(prev => [...prev, {
          id: randomId(), role: 'assistant',
          text: "You've used your 3 free AI questions for today.\n\nUpgrade to Starter ($9.99/mo) for unlimited chat, full lawyer search, arrest records, and all Know Your Rights lessons.",
          suggestLawyerSearch: false,
          showUpgrade: true,
        }]);
      } else if (status === 503 || status === 500) {
        const errBody  = (e as { response?: { data?: { error?: string } } }).response?.data?.error || '';
        const isApiKey = errBody.toLowerCase().includes('api') || errBody.toLowerCase().includes('anthropic');
        setMessages(prev => [...prev, {
          id: randomId(), role: 'assistant',
          text: isApiKey
            ? 'AI chat needs an Anthropic API key to work.\n\nSetup: add ANTHROPIC_API_KEY to backend/.env and restart. Get your key at console.anthropic.com'
            : 'The server had an error. Please try again in a moment.',
          suggestLawyerSearch: false,
        }]);
      } else if (!status) {
        setMessages(prev => [...prev, {
          id: randomId(), role: 'assistant',
          text: 'No connection. Check your internet and try again.',
          suggestLawyerSearch: false,
        }]);
      } else {
        setMessages(prev => [...prev, {
          id: randomId(), role: 'assistant',
          text: 'Sorry, I had trouble responding. Please try again.',
          suggestLawyerSearch: false,
        }]);
      }
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }, [sessionId, loading, scrollToBottom]);

  // ── Navigation helpers ────────────────────────────────────────────────────────
  const onFindLawyer = () => navigation.navigate('Match');
  const onUpgrade    = () => navigation.navigate('MoreTab', { screen: 'ConsumerSubscription' });

  const onCivilRoute = (msg: string) => {
    const m = msg.toLowerCase();
    if (/ice|detain|immigr|deportat|visa|daca/.test(m))
      return navigation.navigate('MoreTab', { screen: 'IceDetention' });
    if (/evict|landlord|tenant|rent|housin/.test(m))
      return navigation.navigate('MoreTab', { screen: 'TenantRights' });
    if (/injur|accident|slip|fall|malpractice|car crash/.test(m))
      return navigation.navigate('MoreTab', { screen: 'PILead', params: { caseType: 'Personal Injury' } });
    if (/civil rights|police brutality|wrongful arrest|excessive force/.test(m))
      return navigation.navigate('MoreTab', { screen: 'PILead', params: { caseType: 'Civil Rights' } });
    if (/fired|terminat|discriminat|wage|harass.*work/.test(m))
      return navigation.navigate('MoreTab', { screen: 'PILead', params: { caseType: 'Employment' } });
    return onFindLawyer();
  };

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
          <Text maxFontSizeMultiplier={1.4} style={styles.headerTitle}>Legal Help</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.headerSub}>AI-powered rights guide</Text>
        </View>
        {messages.length > 0 && (
          <TouchableOpacity
            onPress={clearChat}
            style={styles.clearBtn}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Disclaimer banner — dismisses after user taps */}
      {showDisclaimer && (
        <TouchableOpacity
          activeOpacity={0.6}
          onPress={() => {
            setShowDisclaimer(false);
            recordConsent();
          }}
          accessibilityRole="button"
          style={{
            backgroundColor: colors.bgCard, borderRadius: 8,
            padding: 12, margin: 12,
            borderLeftWidth: 3, borderLeftColor: colors.gold,
          }}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: colors.gold, fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 12, marginBottom: 4 }}>
            ⚠️ AI Legal Information -- Not Legal Advice
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textSecond, fontSize: 11, lineHeight: 16 }}>
            I am an AI guide, not a licensed attorney. Nothing here is legal advice. For advice
            specific to your case, consult a licensed attorney. Tap to dismiss.
          </Text>
        </TouchableOpacity>
      )}

      {/* Messages or empty state */}
      {isEmpty ? (
        <View style={styles.emptyState}>
          <Text maxFontSizeMultiplier={1.4} style={styles.emptyIcon}>⚖️</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.emptyTitle}>Know your rights</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.emptySub}>
            Ask anything about your legal situation. I'm here to help.
          </Text>
          <View style={styles.quickPrompts}>
            {/* T1-P: onPress fixed — no longer split across lines */}
            {QUICK_PROMPTS.map(p => (
              <TouchableOpacity
                key={p.label}
                style={styles.quickChip}
                onPress={() => send(p.text)}
                accessibilityRole="button"
              >
                <Text maxFontSizeMultiplier={1.4} style={styles.quickChipText}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : (
        // T1-Q: renderItem and ListEmptyComponent are separate props, cleanly formatted
        <FlatList<Message>
          ref={listRef}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
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
            />
          )}
          ListEmptyComponent={
            <Text maxFontSizeMultiplier={1.4} style={{ color: COLORS.textFaint, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 }}>
              Start a conversation. Ask any legal question.
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
          style={styles.iconBtn}
          onPress={() => navigation.navigate('MoreTab', { screen: 'VoiceNote' })}
          accessibilityRole="button"
          accessibilityLabel="Use voice input"
          accessibilityHint="Opens voice recorder to transcribe and send a message"
        >
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 20 }}>🎙</Text>
        </TouchableOpacity>

        <TextInput
          style={styles.textInput}
          placeholder="Ask anything -- What should I do? How do I get out?"
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
          style={styles.iconBtn}
          onPress={() => navigation.navigate('MoreTab', { screen: 'Translator' })}
          accessibilityRole="button"
          accessibilityLabel="Open interpreter"
          accessibilityHint="Opens real-time translation for non-English speakers"
        >
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 20 }}>🌐</Text>
        </TouchableOpacity>

        {/* T1-S: closing '>' on TouchableOpacity restored */}
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
          onPress={() => send(input)}
            accessibilityRole="button"
          disabled={!input.trim() || loading}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.sendBtnText}>↑</Text>
        </TouchableOpacity>
      </View>

      <Text maxFontSizeMultiplier={1.4} style={styles.disclaimer}>
        Not legal advice. For emergencies call 911.
      </Text>
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
  emptyTitle:       { fontSize: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.navy, marginBottom: 8 },
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
  bubbleAssistant:  { backgroundColor: COLORS.bgCard, borderBottomLeftRadius: 4, elevation: 1, shadowColor: COLORS.bg, shadowOpacity: 0.05, shadowRadius: 3 },
  bubbleUser:       { backgroundColor: COLORS.navy, borderBottomRightRadius: 4 },
  bubbleText:       { fontSize: 14, color: colors.bgCard, lineHeight: 20 },
  bubbleTextUser:   { color: COLORS.bgCard },
  lawyerCta:        { marginTop: 10, backgroundColor: colors.legal, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: colors.legal },
  lawyerCtaText:    { fontSize: 12, lineHeight: 20, color: '#fff', fontFamily: 'Inter_700Bold', fontWeight: '700' },
  upgradeCta:       { marginTop: 10, backgroundColor: COLORS.bgSubtle, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: COLORS.bgSubtle },
  upgradeCtaText:   { fontSize: 12, lineHeight: 20, color: COLORS.navy, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  typingRow:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8 },
  typingBubble:     { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.bgCard, borderRadius: 16, padding: 10, gap: 8, elevation: 1 },
  typingText:       { fontSize: 12, lineHeight: 20, color: colors.textMuted },
  inputBar:         { flexDirection: 'row', alignItems: 'flex-end', padding: 10, paddingBottom: Platform.OS === 'ios' ? 10 : 10, backgroundColor: COLORS.bgCard, borderTopWidth: 1, borderTopColor: colors.border, gap: 8 },
  textInput:        { flex: 1, backgroundColor: COLORS.bg, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, lineHeight: 21, color: colors.bgCard, maxHeight: 100, borderWidth: 1, borderColor: colors.border },
  sendBtn:          { width: 52, height: 52, borderRadius: 20, backgroundColor: COLORS.navy, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled:  { backgroundColor: COLORS.bgSubtle },
  sendBtnText:      { color: COLORS.bgCard, fontSize: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', lineHeight: 22 },
  disclaimer:       { textAlign: 'center', fontSize: 11, color: colors.textMuted, paddingVertical: 10, backgroundColor: COLORS.bgCard },
  defenderBanner:    { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.12)' },
  defenderBannerText:{ color: COLORS.bgCard, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  defenderBannerSub: { color: 'rgba(255,255,255,0.65)', fontSize: 11, marginTop: 2 },
  defenderPrompts:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 },
  defenderChip:      { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5 },
  defenderChipText:  { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
});
