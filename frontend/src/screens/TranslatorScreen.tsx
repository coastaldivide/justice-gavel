/**
 * TranslatorScreen -- Live attorney-client translation
 *
 * Design direction: two-sided clarity.
 * The screen is physically divided: defender's half (top, navy) and
 * client's half (bottom, slate). Each side has its own language label,
 * input, and speaks button. The division is the UI -- no navigation,
 * no menus, no decoration. Both people look at the same phone OR the
 * defender runs their phone while the client sees a join screen.
 *
 * Two modes:
 *   SOLO MODE -- one phone, both parties type in turn
 *   SPLIT MODE -- two phones, each with their own half
 *     Defender: creates session, gets a 6-char code (K7M2PX)
 *     Client:   enters code on their phone, sees only their half
 *
 * Turn-based flow (solo mode):
 *   Defender types → translation appears in client's language → tap to hand phone
 *   Client types in their language → translation appears in defender's language
 *
 * Turn-based flow (split mode):
 *   Each phone has its own half, polls every 2s for incoming messages
 *
 * Languages: EN · ES · PT · VI
 * Cost per session: ~$0.015 (50 messages × $0.0003)
 * Included in paid tier -- no per-session charge
 */
import { COLORS, FONTS, RADIUS, SHADOW, ThemeColors, useTheme } from '../constants/theme';
import type { ScreenProps } from '../types/navigation';
import React, {
  useState, useEffect, useCallback, useRef
} from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Animated, KeyboardAvoidingView, Platform, Share, Clipboard, RefreshControl} from 'react-native';
import { api } from '../services/api';
import { useAuthGate } from '../components/AuthGate';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';

declare var events: any;
declare var load: any; // hoisted from component scope
// ── Language config ────────────────────────────────────────────────────────
const LANGUAGES = [
  { code: 'en', label: 'English',    native: 'English',    flag: '🇺🇸' },
  { code: 'es', label: 'Spanish',    native: 'Español',    flag: '🇲🇽' },
  { code: 'pt', label: 'Portuguese', native: 'Português',  flag: '🇧🇷' },
  { code: 'vi', label: 'Vietnamese', native: 'Tiếng Việt', flag: '🇻🇳' },
];

// ── Types ──────────────────────────────────────────────────────────────────
interface TurnMessage {
  id?: number;
  side: 'a' | 'b';
  original: string;
  translated: string;
  src_lang: string;
  tgt_lang: string;
  created_at?: string;
  _pending?: boolean;
}

type Phase = 'setup' | 'session' | 'join';

function getLang(code: string) {
  return LANGUAGES.find(l => l.code === code) || LANGUAGES[0];
}

// ── Animated message bubble ────────────────────────────────────────────────
function TurnBubble({
  msg, isA, langA, langB,
}: {
  msg: TurnMessage; isA: boolean; langA: string; langB: string;
}) {
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    load().finally ? load().finally(() => setRefreshing(false)) : (setRefreshing(false))
  }, []);

  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(isA ? -12 : 12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade,  { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 220, useNativeDriver: true }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
    ]).start();
  }, []);

  const srcLang = getLang(msg.src_lang);
  const tgtLang = getLang(msg.tgt_lang);
  const aColor  = COLORS.navy;
  const bColor  = COLORS.textSecond;

  return (
    <Animated.View style={[
      styles.turnBubble,
      { opacity: fade, transform: [{ translateY: slide }] },
      isA
        ? { borderLeftWidth: 3, borderLeftColor: aColor }
        : { borderRightWidth: 3, borderRightColor: bColor },
      { backgroundColor: COLORS.bgCard, borderColor: COLORS.border },
      msg._pending && { opacity: 0.6 },
    ]}>
      {/* Speaker label */}
      <View style={styles.bubbleSpeaker}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.bubbleSpeakerText, { color: isA ? aColor : bColor }]}>
          {srcLang.flag} {srcLang.native}
        </Text>
        {msg._pending && <ActivityIndicator size="small" color={COLORS.textSecond} style={{ marginLeft: 6 }} />}
      </View>

      {/* Original */}
      <TouchableOpacity onPress={() => Clipboard.setString(msg.original)}
        accessibilityRole="button"
      >
        <Text maxFontSizeMultiplier={1.4} style={[styles.bubbleOriginal, { color: COLORS.textPrimary }]}>
          {msg.original}
        </Text>
      </TouchableOpacity>

      {/* Translation */}
      {msg.translated && msg.translated !== msg.original && (
        <View style={[styles.translationBox, {
          backgroundColor: isA
            ? (isDark ? COLORS.textPrimary : COLORS.bgSubtle)
            : (isDark ? COLORS.bgCard : COLORS.bg),
          borderColor: isA ? COLORS.navy + '33' : bColor + '33',
        }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.translationLang, { color: isA ? aColor : bColor }]}>
            {tgtLang.flag} {tgtLang.native}
          </Text>
          <TouchableOpacity onPress={() => Clipboard.setString(msg.translated)}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.translationText, { color: COLORS.textPrimary }]}>
              {msg.translated}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </Animated.View>
  );
}

// ── Language picker ────────────────────────────────────────────────────────
function LangPicker({
  value, onChange, exclude, colors,
}: {
  value: string; onChange: (code: string) => void;
  exclude?: string; colors: ThemeColors;
}) {
  return (
    <View style={styles.langPickerRow}>
      {LANGUAGES.filter(l => l.code !== exclude).map(l => (
        <TouchableOpacity
          accessibilityRole="button"
          key={l.code}
          style={[styles.langChip, {
            backgroundColor: value === l.code ? COLORS.navy : COLORS.bgCard,
            borderColor:     value === l.code ? COLORS.navy : COLORS.border,
          }]}
          onPress={() => onChange(l.code)}
          accessibilityLabel={`${l.label} -- ${l.native}`}
          accessibilityState={{ selected: value === l.code }}>
          <Text maxFontSizeMultiplier={1.4} style={styles.langChipFlag}>{l.flag}</Text>
          <Text maxFontSizeMultiplier={1.4} style={[styles.langChipLabel,
            { color: value === l.code ? COLORS.bgCard : COLORS.textSecond }]}>
            {l.native}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────
export default function TranslatorScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  const [submitting, setSubmitting] = React.useState(false);
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const { colors, isDark } = useTheme();
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);
  const { initialSide } = (route?.params as any) ?? {}; // 'b' for client join flow

  const abortRef = useRef<AbortController | null>(null);
  const [phase,     setPhase]     = useState<Phase>(initialSide === 'b' ? 'join' : 'setup');
  const [langA,     setLangA]     = useState('en');  // defender
  const [langB,     setLangB]     = useState('es');  // client
  const [sessionCode, setCode]    = useState('');
  const [joinCode,  setJoinCode]  = useState('');
  const [joiningAs, setJoiningAs] = useState<'a'|'b'>('b');
  const [messages,  setMessages]  = useState<TurnMessage[]>([]);
  const [inputA,    setInputA]    = useState('');
  const [inputB,    setInputB]    = useState('');
  const [sendingA,  setSendingA]  = useState(false);
  const [sendingB,  setSendingB]  = useState(false);
  const [creating,  setCreating]  = useState(false);
  const [joinError, setJoinError] = useState('');
  const [lastMsgId, setLastMsgId] = useState(0);
  const lastMsgIdRef = useRef(0); // ref avoids poll restart on every message
  const [mode,      setMode]      = useState<'solo'|'split'>('solo');

  const scrollRef = useRef<ScrollView>(null);
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    navigation.setOptions({ title: '🗣 Interpreter' });
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  // Poll for new messages in split mode
  useEffect(() => {
    if (phase !== 'session' || mode !== 'split' || !sessionCode) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await api.get(
          `/translate/session/${sessionCode}/messages?since=${lastMsgIdRef.current}`,
          { headers: {} }
        ).catch(() => api.get(`/translate/session/${sessionCode}/messages?since=${lastMsgIdRef.current}`));
        const newMsgs: TurnMessage[] = res.data || [];
        if (newMsgs.length > 0) {
          setMessages(prev => {
            const ids = new Set(prev.map(m => m.id));
            return [...prev, ...newMsgs.filter(m => !ids.has(m.id))];
          });
          const newId = newMsgs[newMsgs.length - 1].id || lastMsgIdRef.current;
          lastMsgIdRef.current = newId;
          setLastMsgId(newId);
        }
      } catch (e: any) { __DEV__ && console.warn(e?.message); }
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [phase, mode, sessionCode]); // lastMsgId via ref -- no restart on each message

  // ── Create session ────────────────────────────────────────────────────────
  const createSession = useCallback(async (selectedMode: 'solo'|'split') => {
    const run = async () => {
      setCreating(true);
      setMode(selectedMode);
      try {
        const res = await api.post('/translate/session', { lang_a: langA, lang_b: langB });
        if (!mountedRef.current) return;
        setCode(res.data?.code);
        setMessages([]);
        setPhase('session');
      } catch (e: any) {
        Alert.alert('Could not start session', e.response?.data?.error || e.message);
      } finally {
        setCreating(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
      }
    };
    run();
  }, [langA, langB, requireAuth]);

  // ── Join session (client side) ────────────────────────────────────────────
  const joinSession = useCallback(async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) {
      setJoinError('Enter the 6-character code from the attorney\'s phone.');
      return;
    }
    setJoinError('');
    try {
      const res = await api.get(`/translate/session/${code}`);
      if (!mountedRef.current) return;
      setLangA(res.data?.lang_a);
      setLangB(res.data?.lang_b);
      setCode(code);
      setJoiningAs('b');
      setMode('split');

      // Load existing messages
      const msgs = await api.get(`/translate/session/${code}/messages?since=0`);
      setMessages(msgs.data || []);
      if (msgs.data?.length) {
        const id = msgs.data[msgs.data.length - 1].id;
        lastMsgIdRef.current = id;
        setLastMsgId(id);
      }

      setPhase('session');
    } catch (e: any) {
      setJoinError('Session not found. Check the code and try again.');
    }
  }, [joinCode]);

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (side: 'a' | 'b') => {
    const text = side === 'a' ? inputA.trim() : inputB.trim();
    if (!text) return;
    if (side === 'a') { setSendingA(true); setInputA(''); }
    else              { setSendingB(true); setInputB(''); }

    // Optimistic
    const optimistic: TurnMessage = {
      side,
      original:   text,
      translated: '…',
      src_lang:   side === 'a' ? langA : langB,
      tgt_lang:   side === 'a' ? langB : langA,
      _pending:   true,
      id: Date.now(),
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      let res;
      if (mode === 'split' || sessionCode) {
        res = await api.post(`/translate/session/${sessionCode}/message`, { text, side });
      } else {
        res = await api.post('/translate/message', {
          text,
          src_lang: side === 'a' ? langA : langB,
          tgt_lang: side === 'a' ? langB : langA,
        });
      }
      const confirmed: TurnMessage = {
        side,
        original:   res.data?.original,
        translated: res.data?.translated,
        src_lang:   side === 'a' ? langA : langB,
        tgt_lang:   side === 'a' ? langB : langA,
        id: res.data?.id || Date.now() + 1,
      };
      setMessages(prev => prev.map(m => m._pending && m.id === optimistic.id ? confirmed : m));
      if (res.data?.id) { lastMsgIdRef.current = res.data?.id; setLastMsgId(res.data?.id); }
    } catch (e: any) {
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      if (side === 'a') setInputA(text);
      else              setInputB(text);
      Alert.alert('Translation failed', e.response?.data?.error || 'Check your connection.');
    } finally {
      if (side === 'a') setSendingA(false);
      else              setSendingB(false);
    }
  }, [inputA, inputB, langA, langB, sessionCode, mode]);

  const shareCode = useCallback(() => {
    try {
      Share.share({
      message: `Join my translation session on Justice Gavel.\n\nCode: ${sessionCode}\n\nDownload the app and tap "Interpreter" → "Join with code".`,
      title: 'Join Translation Session',
    });
    } catch (shareErr: any) {
      // Share API unavailable on this browser/device — fail silently
    }
  }, [sessionCode]);

  // ── RENDER: Join (client) ────────────────────────────────────────────────
  if (phase === 'join') return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <AuthGateModal />
      <ScrollView contentContainerStyle={styles.setupScroll} keyboardShouldPersistTaps="handled">
        <Text maxFontSizeMultiplier={1.4} style={styles.joinEmoji}>🗝</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.joinTitle, { color: colors.textPrimary }]}>
          Join translation session
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.joinSub, { color: colors.textMuted }]}>
          Enter the 6-character code from the attorney's phone.
        </Text>

        <TextInput
          style={[styles.codeInput, {
            backgroundColor: colors.bgCard,
            borderColor: joinError ? COLORS.emergency : colors.border,
            color: colors.textPrimary,
          }]}
          value={joinCode}
          onChangeText={v => { setJoinCode(v.toUpperCase()); setJoinError(''); }}
          placeholder="K7M2PX"
          placeholderTextColor={COLORS.textSecond}
          autoCapitalize="characters"
          maxLength={6}
          keyboardType="default"
          autoFocus
          accessibilityLabel="Session code"

          returnKeyType="next"
          blurOnSubmit
        />
        {!!joinError && (
          <Text maxFontSizeMultiplier={1.4} style={[styles.joinError, { color: COLORS.emergency }]}>{joinError}</Text>
        )}
        <TouchableOpacity activeOpacity={0.6}
          style={[styles.joinBtn, { backgroundColor: COLORS.navy },
            joinCode.length !== 6 && { opacity: 0.45 }]}
          onPress={joinSession}
          disabled={joinCode.length !== 6}
          accessibilityLabel="Join session"
          accessibilityRole="button"
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.joinBtnText}>Join Session →</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.backLink}
          accessibilityRole="button"
          onPress={() => setPhase('setup')}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.backLinkText, { color: colors.textMuted }]}>← Back</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  // ── RENDER: Setup ────────────────────────────────────────────────────────
  if (phase === 'setup') return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <AuthGateModal />
      <ScrollView contentContainerStyle={styles.setupScroll} keyboardShouldPersistTaps="handled">

        <Text maxFontSizeMultiplier={1.4} style={styles.setupEmoji}>🗣</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.setupTitle, { color: colors.textPrimary }]}>
          Attorney-Client Interpreter
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.setupSub, { color: colors.textMuted }]}>
          Real-time translation for attorney-client meetings.{'\n'}
          Replaces a $50-200/hr professional interpreter.
        </Text>

        {/* Mode selector */}
        <View style={[styles.modeRow, { borderColor: colors.border }]}>
          {[
            { key: 'solo',  icon: '📱', label: 'One phone', sub: 'Pass the phone back and forth' },
            { key: 'split', icon: '📲', label: 'Two phones', sub: 'Each person uses their own phone' },
          ].map(m => (
            <TouchableOpacity
              accessibilityRole="button"
              key={m.key}
              style={[styles.modeCard, {
                backgroundColor: colors.bgCard,
                borderColor: colors.border,
              }]}
              onPress={() => createSession(m.key as 'solo'|'split')}
              disabled={creating}
              accessibilityLabel={m.label}
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.modeIcon}>{m.icon}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.modeLabel, { color: colors.textPrimary }]}>{m.label}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.modeSub, { color: colors.textMuted }]}>{m.sub}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {creating && <ActivityIndicator color={COLORS.navy} style={{ marginVertical: 12 }} />}
        {/* Attorney language */}
        <Text maxFontSizeMultiplier={1.4} style={[styles.langLabel, { color: colors.textMuted }]}>
          Attorney's language
        </Text>
        <LangPicker value={langA} onChange={setLangA} exclude={langB} colors={colors} />

        {/* Client language */}
        <Text maxFontSizeMultiplier={1.4} style={[styles.langLabel, { color: colors.textMuted }]}>
          Client's language
        </Text>
        <LangPicker value={langB} onChange={setLangB} exclude={langA} colors={colors} />

        {/* Join existing */}
        <View style={[styles.dividerRow, { borderColor: colors.border }]}>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          <Text maxFontSizeMultiplier={1.4} style={[styles.dividerText, { color: colors.textMuted }]}>or</Text>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
        </View>

        <TouchableOpacity
          style={[styles.joinExisting, { borderColor: colors.border, backgroundColor: colors.bgCard }]}
          onPress={() => setPhase('join')}
          accessibilityRole="button"
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.joinExistingText, { color: colors.textPrimary }]}>
            🗝  Join with a code (client)
          </Text>
        </TouchableOpacity>

        <Text maxFontSizeMultiplier={1.4} style={[styles.setupDisclaimer, { color: colors.textMuted }]}>
          Translations are AI-generated. For critical legal proceedings, use a certified interpreter.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  // ── RENDER: Session ──────────────────────────────────────────────────────
  const onlySideB = joiningAs === 'b' && mode === 'split';
  const langAObj  = getLang(langA);
  const langBObj  = getLang(langB);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>

      {/* Session code bar */}
      {sessionCode && (
        <View style={[styles.codeBar, {
          backgroundColor: isDark ? colors.textPrimary : colors.bgSubtle,
          borderBottomColor: COLORS.navy + '33',
        }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.codeBarLabel, { color: colors.textMuted }]}>Session code</Text>
          <Text maxFontSizeMultiplier={1.4} style={[styles.codeBarCode, { color: COLORS.navy }]}>{sessionCode}</Text>
          {mode === 'split' && (
            <TouchableOpacity onPress={shareCode} style={styles.shareCodeBtn}
              accessibilityRole="button"
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.shareCodeText, { color: COLORS.navy }]}>Share →</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
          accessibilityRole="button"
            onPress={() => {
              if (pollRef.current) clearInterval(pollRef.current);
              setPhase('setup');
              setMessages([]);
              setCode('');
            }}
            style={styles.endBtn}
            accessibilityLabel="End session"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.endBtnText}>End</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Message thread */}
      <ScrollView
        ref={scrollRef}
        style={[styles.thread, { backgroundColor: isDark ? colors.tabBg : colors.bg }]}
        contentContainerStyle={styles.threadContent}
        showsVerticalScrollIndicator={false}
      >
        {messages.length === 0 && (
          <View style={styles.emptyThread}>
            <Text maxFontSizeMultiplier={1.4} style={styles.emptyThreadIcon}>💬</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.emptyThreadText, { color: colors.textMuted }]}>
              {onlySideB
                ? `Type in ${langBObj.native} below. The attorney will see your message in ${langAObj.native}.`
                : `Type in ${langAObj.native} or ${langBObj.native} below.\nBoth sides will see translations instantly.`}
            </Text>
          </View>
        )}
        {messages.map((msg, i) => (
          <TurnBubble
            key={msg.id ?? i}
            msg={msg}
            isA={msg.side === 'a'}
            langA={langA}
            langB={langB}
          />
        ))}
      </ScrollView>

      {/* Input area -- two halves or one side */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={sessionCode ? 110 : 90}
      >
        {/* Side A -- attorney (hidden if client-only mode) */}
        {!onlySideB && (
          <View style={[styles.inputHalf, styles.inputHalfA, {
            backgroundColor: isDark ? colors.textPrimary : colors.bgSubtle,
            borderTopColor: COLORS.navy + '44',
          }]}>
            <View style={styles.inputHalfLabel}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.inputSideFlag]}>{langAObj.flag}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.inputSideLabel, { color: COLORS.navy }]}>
                {langAObj.native}
              </Text>
            </View>
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.msgInput, {
                  backgroundColor: isDark ? colors.bgCard : colors.bgCard,
                  borderColor: COLORS.navy + '44',
                  color: colors.textPrimary,
                }]}
                placeholder={`Type in ${langAObj.native}…`}
                placeholderTextColor={COLORS.textSecond}
                value={inputA}
                onChangeText={setInputA}
                multiline
                maxLength={500}
                accessibilityLabel={`Type in ${langAObj.label}`}
              />
              <TouchableOpacity
                style={[styles.sendBtn, {
                  backgroundColor: inputA.trim() && !sendingA ? COLORS.navy : colors.border
                }]}
                onPress={() => sendMessage('a')}
            accessibilityRole="button"
                disabled={!inputA.trim() || sendingA}
                accessibilityLabel="Send and translate"
              >
                {sendingA
                  ? <ActivityIndicator color={colors.bgCard} size="small" />
                  : <Text maxFontSizeMultiplier={1.4} style={styles.sendBtnText}>→</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Side B -- client */}
        <View style={[styles.inputHalf, {
          backgroundColor: isDark ? colors.bgCard : colors.bg,
          borderTopColor: 'rgba(84,110,122,0.27)',
        }]}>
          <View style={styles.inputHalfLabel}>
            <Text maxFontSizeMultiplier={1.4} style={styles.inputSideFlag}>{langBObj.flag}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.inputSideLabel, { color: colors.textSecond }]}>
              {langBObj.native}
            </Text>
          </View>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.msgInput, {
                backgroundColor: isDark ? colors.bgCard : colors.bgCard,
                borderColor: 'rgba(84,110,122,0.27)',
                color: colors.textPrimary,
              }]}
              placeholder={`Type in ${langBObj.native}…`}
              placeholderTextColor={COLORS.textSecond}
              value={inputB}
              onChangeText={setInputB}
              multiline
              maxLength={500}
              accessibilityLabel={`Type in ${langBObj.label}`}
            />
            <TouchableOpacity
              style={[styles.sendBtn, {
                backgroundColor: inputB.trim() && !sendingB ? colors.textSecond : colors.border
              }]}
              onPress={() => sendMessage('b')}
            accessibilityRole="button"
              disabled={!inputB.trim() || sendingB}
              accessibilityLabel="Send and translate"
            >
              {sendingB
                ? <ActivityIndicator color={colors.bgCard} size="small" />
                : <Text maxFontSizeMultiplier={1.4} style={styles.sendBtnText}>→</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1 },

  // Setup
  setupScroll:      { padding: 20, paddingBottom: 40 },
  setupEmoji:       { fontSize: 48, textAlign: 'center', marginBottom: 10, marginTop: 10 },
  setupTitle:       { fontSize: 22, ...FONTS.black, textAlign: 'center', marginBottom: 8 },
  setupSub:         { fontSize: 12, textAlign: 'center', lineHeight: 20, marginBottom: 24 },

  modeRow: { flexDirection: 'row', gap: 12, marginBottom: 22, borderWidth: 0 },
  modeCard:{ flex: 1, borderRadius: RADIUS.xl, borderWidth: 1.5, padding: 16,
    alignItems: 'center', ...SHADOW.sm },
  modeIcon:{ fontSize: 28, marginBottom: 8 },
  modeLabel:{ fontSize: 14, lineHeight: 21, ...FONTS.black, marginBottom: 4 },
  modeSub: { fontSize: 11, textAlign: 'center', lineHeight: 15 },

  langLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.8, marginBottom: 8 },
  langPickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  langChip:      { flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill, borderWidth: 1.5 },
  langChipFlag:  { fontSize: 16,
    lineHeight: 24, },
  langChipLabel: { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  dividerLine:{ flex: 1, height: 0.5 },
  dividerText:{ fontSize: 12 },

  joinExisting:     { borderRadius: RADIUS.lg, borderWidth: 1.5, paddingVertical: 13,
    alignItems: 'center', marginBottom: 16 },
  joinExistingText: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  setupDisclaimer:  { fontSize: 11, textAlign: 'center', lineHeight: 16 },

  // Join
  joinEmoji: { fontSize: 48, textAlign: 'center', marginBottom: 10, marginTop: 20 },
  joinTitle: { fontSize: 20, ...FONTS.black, textAlign: 'center', marginBottom: 8 },
  joinSub:   { fontSize: 12, textAlign: 'center', lineHeight: 20, marginBottom: 22 },
  codeInput: { borderWidth: 2, borderRadius: RADIUS.lg, paddingVertical: 16,
    paddingHorizontal: 20, fontSize: 28, ...FONTS.black, textAlign: 'center',
    letterSpacing: 8, marginBottom: 8 },
  joinError: { fontSize: 12, textAlign: 'center', marginBottom: 8 },
  joinBtn:   { borderRadius: RADIUS.lg, paddingVertical: 15, alignItems: 'center',
    marginTop: 8, marginBottom: 14, ...SHADOW.sm },
  joinBtnText:{ color: COLORS.bgCard, fontSize: 15, lineHeight: 22, ...FONTS.black },
  backLink:   { paddingVertical: 10, alignItems: 'center' },
  backLinkText:{ fontSize: 12, lineHeight: 20, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },

  // Session
  codeBar: { flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 0.5 },
  codeBarLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700', textTransform: 'uppercase' },
  codeBarCode:  { fontSize: 18, ...FONTS.black, letterSpacing: 3, flex: 1 },
  shareCodeBtn: { paddingHorizontal: 10, paddingVertical: 10, borderRadius: 8,
    borderWidth: 1.5, borderColor: COLORS.navy + '55' },
  shareCodeText:{ fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  endBtn:       { paddingHorizontal: 10, paddingVertical: 10, borderRadius: 8,
    backgroundColor: COLORS.emergency },
  endBtnText:   { color: COLORS.bgCard, fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700' },

  thread:        { flex: 1 },
  threadContent: { padding: 12, paddingBottom: 6 },

  emptyThread:     { alignItems: 'center', justifyContent: 'center', padding: 32, flex: 1 },
  emptyThreadIcon: { fontSize: 36, marginBottom: 10 },
  emptyThreadText: { fontSize: 12, textAlign: 'center', lineHeight: 20 },

  // Turn bubble
  turnBubble: { borderRadius: RADIUS.lg, borderWidth: 1,
    padding: 12, marginBottom: 10, ...SHADOW.sm },
  bubbleSpeaker:     { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  bubbleSpeakerText: { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  bubbleOriginal:    { fontSize: 15, lineHeight: 22, marginBottom: 8 },
  translationBox:    { borderRadius: RADIUS.md, borderWidth: 1, padding: 10, marginTop: 4 },
  translationLang:   { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', textTransform: 'uppercase',
    letterSpacing: 0.5, marginBottom: 5 },
  translationText:   { fontSize: 15, lineHeight: 22 },

  // Input halves
  inputHalf:     { borderTopWidth: 0.5, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 },
  inputHalfA:    {},
  inputHalfLabel:{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  inputSideFlag: { fontSize: 16,
    lineHeight: 24, },
  inputSideLabel:{ fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  inputRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  msgInput:      { flex: 1, borderWidth: 1.5, borderRadius: 20,
    paddingHorizontal: 16, paddingTop: 9, paddingBottom: 9,
    fontSize: 14, maxHeight: 90, lineHeight: 19 },
  sendBtn:       { width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center' },
  sendBtnText:   { color: COLORS.bgCard, fontSize: 18, fontWeight: '300' },
});

// Module-level fallback for helper components
const styles = makeStyles(COLORS);