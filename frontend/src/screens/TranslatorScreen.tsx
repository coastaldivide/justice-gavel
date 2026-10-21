import { useToast } from '../components/ToastProvider';
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
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import type { ScreenProps } from '../types/navigation';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Animated, KeyboardAvoidingView, Platform } from 'react-native';
import { unwrapList, api, apiErrorMessage } from '../services/api';
import { useAuthGate } from '../components/AuthGate';
import { hapticSelection, RNShare, Clipboard } from '../utils/webCompat';
import { t, useLang, perLang } from '../i18n';
import { IconLabel, ICONS } from '../components/AppIcon';

// ── Language config ────────────────────────────────────────────────────────
const LANGUAGES = perLang(() => [
  { code: 'en', label: t('x_st_english'),    native: 'English',    flag: '🇺🇸' },
  { code: 'es', label: t('hn_lang_spanish'),    native: 'Español',    flag: '🇲🇽' },
  { code: 'pt', label: t('hn_lang_portuguese'), native: 'Português',  flag: '🇧🇷' },
  { code: 'vi', label: t('hn_lang_vietnamese'), native: 'Tiếng Việt', flag: '🇻🇳' },
]);

// ── Types ──────────────────────────────────────────────────────────────────
interface TurnMessage {
  id?: number;
  side: 'a' | 'b';
  original: string;
  /** null: the message could not be translated (the other side sees the original) */
  translated: string | null;
  translation_error?: string;
  src_lang: string;
  tgt_lang: string;
  created_at?: string;
  _pending?: boolean;
}

type Phase = 'setup' | 'session' | 'join';

function getLang(code: string) {
  return LANGUAGES().find(l => l.code === code) || LANGUAGES()[0];
}

// ── Animated message bubble ────────────────────────────────────────────────
function TurnBubble({
  msg, isA,
}: {
  msg: TurnMessage; isA: boolean;
}) {
  useLang();
  const { isDark } = useTheme();
  const styles = makeStyles();

  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(isA ? -12 : 12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade,  { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start();
    return () => slide.stopAnimation();
  }, [fade, slide]);

  const srcLang = getLang(msg.src_lang);
  const tgtLang = getLang(msg.tgt_lang);
  const aColor  = COLORS.navy;
  const bColor  = COLORS.textSecond;

  return (
    <Animated.View testID="translator-bubble" style={[
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
      <TouchableOpacity
          accessibilityRole="button" accessibilityHint={t('translator_tap_copy')} onPress={() => { hapticSelection(); Clipboard.setString(msg.original); }}
      >
        <Text maxFontSizeMultiplier={1.4} style={[styles.bubbleOriginal, { color: COLORS.textPrimary }]}>
          {msg.original}
        </Text>
      </TouchableOpacity>

      {/* Not translated (AI unavailable / busy): say so, never pass the original off as a translation */}
      {!msg._pending && msg.translated == null && (
        <IconLabel icon={ICONS.statusWarn} textStyle={[styles.notTranslated, { color: COLORS.textSecond }]} maxFontSizeMultiplier={1.4} testID="translator-not-translated">{t('translator_not_translated', { lang: tgtLang.native })}</IconLabel>
      )}

      {/* Translation */}
      {!msg._pending && !!msg.translated && msg.translated !== msg.original && (
        <View style={[styles.translationBox, {
          backgroundColor: isA
            ? (isDark ? COLORS.textPrimary : COLORS.bgSubtle)
            : (isDark ? COLORS.bgCard : COLORS.bg),
          borderColor: isA ? COLORS.navy + '33' : bColor + '33',
        }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.translationLang, { color: isA ? aColor : bColor }]}>
            {tgtLang.flag} {tgtLang.native}
          </Text>
          <TouchableOpacity
          accessibilityRole="button" accessibilityHint={t('translator_tap_copy')} onPress={() => { hapticSelection(); Clipboard.setString(msg.translated || ''); }}
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
  value, onChange, exclude,
}: {
  value: string; onChange: (code: string) => void;
  exclude?: string;
}) {
  useLang();
  return (
    <View style={styles.langPickerRow}
      testID="translator-screen">
      {LANGUAGES().filter(l => l.code !== exclude).map(l => (
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
function TranslatorScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { showToast } = useToast();
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const { colors, isDark } = useTheme();
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);
  const { initialSide } = (route?.params as import('../types/api').RouteParams) ?? {}; // 'b' for client join flow

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
  const lastMsgIdRef = useRef(0); // ref avoids poll restart on every message
  const [mode,      setMode]      = useState<'solo'|'split'>('solo');

  const scrollRef = useRef<ScrollView>(null);
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  // The per-session token from create / join: a guest who joined by code is
  // known to the server only by it (X-Translate-Token on every call).
  const tokenRef  = useRef<string | null>(null);
  const sessionHeaders = () => (tokenRef.current ? { headers: { 'X-Translate-Token': tokenRef.current } } : {});

  /** Add messages once each (the poll and the send answer can bring the same one). */
  const mergeMessages = useCallback((incoming: TurnMessage[]) => {
    if (!incoming.length) return;
    setMessages(prev => {
      const ids = new Set(prev.filter(m => !m._pending).map(m => m.id));
      return [...prev, ...incoming.filter(m => !ids.has(m.id))];
    });
    const maxId = Math.max(lastMsgIdRef.current, ...incoming.map(m => Number(m.id) || 0));
    lastMsgIdRef.current = maxId;
  }, []);

  useEffect(() => {
    navigation.setOptions({ title: t('x_nav_interpreter') });
  }, [navigation]);

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
        const res = await api.get(`/translate/session/${sessionCode}/messages?since=${lastMsgIdRef.current}`, sessionHeaders());
        mergeMessages(unwrapList<TurnMessage>(res.data, 'messages'));
      } catch (e) { __DEV__ && console.warn((e as Error)?.message); }
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [phase, mode, sessionCode, mergeMessages]); // lastMsgId via ref -- no restart on each message

  // ── Create session ────────────────────────────────────────────────────────
  const createSession = useCallback(async (selectedMode: 'solo'|'split') => {
    const run = async () => {
      setCreating(true);
      setMode(selectedMode);
      try {
        const res = await api.post('/translate/session', { lang_a: langA, lang_b: langB });
        if (!mountedRef.current) return;
        tokenRef.current = res.data?.session_token || null;
        lastMsgIdRef.current = 0;
        setCode(res.data?.code);
        setJoiningAs('a');
        setMessages([]);
        setPhase('session');
      } catch (e) {
        showToast(apiErrorMessage(e, t('x_translator_translation_session_failed')), 'error');
      } finally {
        if (mountedRef.current) setCreating(false);
      }
    };
    // POST /translate/session requires an account: prompt guests to sign in first.
    requireAuth(run);
  }, [langA, langB, requireAuth, showToast]);

  // ── Join session (client side) ────────────────────────────────────────────
  const joinSession = useCallback(async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) {
      setJoinError(t('x_translator_enter_6_character_code'));
      return;
    }
    setJoinError('');
    try {
      const res = await api.get(`/translate/session/${code}`);
      if (!mountedRef.current) return;
      if (res.data?.session_token) tokenRef.current = res.data.session_token;
      setLangA(res.data?.lang_a);
      setLangB(res.data?.lang_b);
      setCode(code);
      setJoiningAs('b');
      setMode('split');

      // Load existing messages
      lastMsgIdRef.current = 0;
      setMessages([]);
      const msgs = await api.get(`/translate/session/${code}/messages?since=0`, sessionHeaders());
      mergeMessages(unwrapList<TurnMessage>(msgs.data, 'messages'));
      setPhase('session');
    } catch (e) {
      setJoinError(apiErrorMessage(e, t('x_translator_session_not_found_check')));
    }
  }, [joinCode, mergeMessages]);

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
      id: Date.now() + Math.floor(Math.random() * 10000),
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      const res = await api.post(`/translate/session/${sessionCode}/message`, { text, side }, sessionHeaders());
      const confirmed: TurnMessage = {
        side,
        original:   res.data?.original ?? text,
        translated: res.data?.translated ?? null,
        translation_error: res.data?.translation_error,
        src_lang:   res.data?.src_lang || optimistic.src_lang,
        tgt_lang:   res.data?.tgt_lang || optimistic.tgt_lang,
        id: res.data?.id,
      };
      // The poll may already have brought this message: keep one copy.
      setMessages(prev => {
        const rest = prev.filter(m => m.id !== optimistic.id);
        return confirmed.id != null && rest.some(m => m.id === confirmed.id) ? rest : [...rest, confirmed];
      });
      if (confirmed.id) lastMsgIdRef.current = Math.max(lastMsgIdRef.current, Number(confirmed.id));
      if (res.data?.translation_error) showToast(res.data?.message || t('translator_not_translated', { lang: getLang(confirmed.tgt_lang).native }), 'warning');
    } catch (e) {
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      if (side === 'a') setInputA(text);
      else              setInputB(text);
      showToast(apiErrorMessage(e, t('x_translator_check_connection')), 'error');
    } finally {
      if (side === 'a') setSendingA(false);
      else              setSendingB(false);
    }
  }, [inputA, inputB, langA, langB, sessionCode, showToast]);

  const shareCode = useCallback(() => {
    try {
      RNShare.share({
      message: t('x_translator_join_my_translation_session', { sessionCode }),
      title: t('x_translator_join_translation_session'),
    });
    } catch {
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
        <IconLabel icon={ICONS.key} textStyle={styles.joinEmoji} maxFontSizeMultiplier={1.4}></IconLabel>
        <Text maxFontSizeMultiplier={1.4} style={[styles.joinTitle, { color: colors.textPrimary }]}>
          {t('x_translator_join_translation_session_2')}
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.joinSub, { color: colors.textMuted }]}>
          {t('x_translator_enter_6_character_code')}
        </Text>

        <TextInput
          style={[styles.codeInput, {
            backgroundColor: colors.bgCard,
            borderColor: joinError ? COLORS.emergency : colors.border,
            color: colors.textPrimary,
          }]}
          testID="translator-code-input"
          value={joinCode}
          onChangeText={v => { setJoinCode(v.toUpperCase()); setJoinError(''); }}
          placeholder="K7M2PX"
          placeholderTextColor={COLORS.textSecond}
          autoCapitalize="characters"
          maxLength={6}
          keyboardType="default"
          autoFocus

          returnKeyType="next"
          blurOnSubmit
        />
        {!!joinError && (
          <Text maxFontSizeMultiplier={1.4} style={[styles.joinError, { color: colors.emergency }]}>{joinError}</Text>
        )}
        <TouchableOpacity
          accessibilityRole="button" activeOpacity={0.6}
          style={[styles.joinBtn, { backgroundColor: COLORS.navy },
            joinCode.length !== 6 && { opacity: 0.45 }]}
          onPress={joinSession}
          testID="translator-join-submit"
          disabled={joinCode.length !== 6}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.joinBtnText}>{t('x_translator_join_session')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          style={styles.backLink}
          accessibilityLabel={t('ja_back')} onPress={() => setPhase('setup')}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.backLinkText, { color: colors.textMuted }]}>{t('ja_back')}</Text>
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

        <IconLabel icon={ICONS.speak} textStyle={styles.setupEmoji} maxFontSizeMultiplier={1.4}></IconLabel>
        <Text maxFontSizeMultiplier={1.4} style={[styles.setupTitle, { color: colors.textPrimary }]}>
          {t('x_translator_attorney_client_interpreter')}
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.setupSub, { color: colors.textMuted }]}>
          {t('x_translator_real_time_translation_attorney')}
        </Text>

        {/* Mode selector */}
        <View style={[styles.modeRow, { borderColor: colors.border }]}>
          {[
            { key: 'solo',  icon: '📱', label: t('translator_one_phone'), sub: t('x_translator_pass_phone_back_forth') },
            { key: 'split', icon: '📲', label: t('translator_two_phones'), sub: t('x_translator_each_person_uses_their') },
          ].map(m => (
            <TouchableOpacity
              accessibilityRole="button"
              key={m.key}
              testID={`translator-mode-${m.key}`}
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
          {t('translator_attorney_lang')}
        </Text>
        <LangPicker value={langA} onChange={setLangA} exclude={langB} />

        {/* Client language */}
        <Text maxFontSizeMultiplier={1.4} style={[styles.langLabel, { color: colors.textMuted }]}>
          {t('translator_client_lang')}
        </Text>
        <LangPicker value={langB} onChange={setLangB} exclude={langA} />

        {/* Join existing */}
        <View style={[styles.dividerRow, { borderColor: colors.border }]}>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          <Text maxFontSizeMultiplier={1.4} style={[styles.dividerText, { color: colors.textMuted }]}>{t('x_translator_text')}</Text>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          testID="translator-join-existing"
          style={[styles.joinExisting, { borderColor: colors.border, backgroundColor: colors.bgCard }]}
          onPress={() => setPhase('join')}
        >
          <IconLabel icon={ICONS.key} textStyle={[styles.joinExistingText, { color: colors.textPrimary }]} maxFontSizeMultiplier={1.4}>{t('x_translator_join_with_code_client')}</IconLabel>
        </TouchableOpacity>

        <Text maxFontSizeMultiplier={1.4} style={[styles.setupDisclaimer, { color: colors.textMuted }]}>
          {t('x_translator_translations_ai_generated_critical')}
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
          <Text maxFontSizeMultiplier={1.4} style={[styles.codeBarLabel, { color: colors.textMuted }]}>{t('translator_session_code')}</Text>
          <Text maxFontSizeMultiplier={1.4} testID="translator-session-code" style={[styles.codeBarCode, { color: COLORS.navy }]}>{sessionCode}</Text>
          {mode === 'split' && (
            <TouchableOpacity
              accessibilityRole="button" onPress={shareCode} style={styles.shareCodeBtn}
             accessibilityLabel={t('x_translator_share')}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.shareCodeText, { color: COLORS.navy }]}>{t('x_translator_share')}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => {
              if (pollRef.current) clearInterval(pollRef.current);
              tokenRef.current = null;
              lastMsgIdRef.current = 0;
              setPhase('setup');
              setMessages([]);
              setCode('');
            }}
            style={styles.endBtn}
            accessibilityLabel={t('x_translator_end_session')}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.endBtnText}>{t('x_translator_end')}</Text>
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
            <IconLabel icon={ICONS.message} textStyle={styles.emptyThreadIcon} maxFontSizeMultiplier={1.4}></IconLabel>
            <Text maxFontSizeMultiplier={1.4} style={[styles.emptyThreadText, { color: colors.textMuted }]}>
              {onlySideB
                ? t('x_translator_type_below_attorney_will', { native: langBObj.native, native2: langAObj.native })
                : t('x_translator_type_below_both_sides', { native: langAObj.native, native2: langBObj.native })}
            </Text>
          </View>
        )}
        {(messages ?? []).map((msg, i) => (
          <TurnBubble
            key={msg.id ?? i}
            msg={msg}
            isA={msg.side === 'a'}
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
                placeholder={t('x_translator_type', { native: langAObj.native })}
                placeholderTextColor={COLORS.textSecond}
                testID="translator-input-a"
                value={inputA}
                onChangeText={setInputA}
                multiline
                maxLength={2000}
                accessibilityLabel={t('x_translator_type_2', { label: langAObj.label })}
              />
              <TouchableOpacity
                accessibilityRole="button"
                style={[styles.sendBtn, {
                  backgroundColor: inputA.trim() && !sendingA ? COLORS.navy : colors.border
                }]}
                testID="translator-send-a"
                onPress={() => sendMessage('a')}
                disabled={!inputA.trim() || sendingA}
                accessibilityLabel={t('x_translator_send_translate')}
          accessibilityHint={t('cp_double_tap')}
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
              placeholder={t('x_translator_type', { native: langBObj.native })}
              placeholderTextColor={COLORS.textSecond}
              testID="translator-input-b"
              value={inputB}
              onChangeText={setInputB}
              multiline
              maxLength={2000}
              accessibilityLabel={t('x_translator_type_2', { label: langBObj.label })}
            />
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.sendBtn, {
                backgroundColor: inputB.trim() && !sendingB ? colors.textSecond : colors.border
              }]}
              testID="translator-send-b"
              onPress={() => sendMessage('b')}
              disabled={!inputB.trim() || sendingB}
              accessibilityLabel={t('x_translator_send_translate')}
          accessibilityHint={t('cp_double_tap')}
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
const makeStyles = () => StyleSheet.create({
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
  notTranslated:     { fontSize: 12, lineHeight: 18, marginTop: 2 },

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
  sendBtn:       { width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center' },
  sendBtnText:   { color: COLORS.bgCard, fontSize: 18, fontWeight: '300' },
});

// Module-level fallback for helper components
const styles = makeStyles();
export default React.memo(TranslatorScreen);