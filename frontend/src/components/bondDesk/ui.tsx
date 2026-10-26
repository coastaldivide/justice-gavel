/**
 * components/bondDesk/ui.tsx — the small set of building blocks the Bond Desk
 * screens share (cards, labelled fields, buttons, chips, checkboxes, notices),
 * themed for light and dark and sized for 44pt touch targets.
 */
import React from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View, type KeyboardTypeOptions, type StyleProp, type ViewStyle } from 'react-native';
import { FONTS, RADIUS, useTheme } from '../../constants/theme';
import { AppIcon, ICONS } from '../AppIcon';
import { t } from '../../i18n';

type Colors = ReturnType<typeof useTheme>['colors'];

export function Card({ title, children, testID, style }: { title?: string; children?: React.ReactNode; testID?: string; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  return (
    <View style={[s.card, style]} testID={testID}>
      {!!title && <Text maxFontSizeMultiplier={1.4} style={s.cardTitle} accessibilityRole="header">{title}</Text>}
      {children}
    </View>
  );
}

export function Line({ children, muted, strong, testID, tone }: { children: React.ReactNode; muted?: boolean; strong?: boolean; testID?: string; tone?: 'ok' | 'warn' | 'danger' }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const color = tone === 'ok' ? colors.legal : tone === 'warn' ? colors.warnDark : tone === 'danger' ? colors.danger : muted ? colors.textMuted : colors.textSecond;
  return <Text maxFontSizeMultiplier={1.4} testID={testID} style={[s.line, { color }, strong && s.strong]}>{children}</Text>;
}

export function Row({ label, value, testID }: { label: string; value: React.ReactNode; testID?: string }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  return (
    <View style={s.row} testID={testID}>
      <Text maxFontSizeMultiplier={1.4} style={s.rowLabel}>{label}</Text>
      <Text maxFontSizeMultiplier={1.4} style={s.rowValue}>{value}</Text>
    </View>
  );
}

export function Field({ label, value, onChangeText, placeholder, keyboardType, testID, multiline, autoCapitalize, maxLength = 300 }: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; keyboardType?: KeyboardTypeOptions;
  testID?: string; multiline?: boolean; autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'; maxLength?: number;
}) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  return (
    <View style={{ marginTop: 10 }}>
      <Text maxFontSizeMultiplier={1.4} style={s.label}>{label}</Text>
      <TextInput
        testID={testID} accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={placeholder}
        placeholderTextColor={colors.placeholder} keyboardType={keyboardType} multiline={multiline} maxLength={maxLength}
        autoCapitalize={autoCapitalize} style={[s.input, multiline && { minHeight: 80, textAlignVertical: 'top' }]}
        maxFontSizeMultiplier={1.4}
      />
    </View>
  );
}

export function Btn({ label, onPress, kind = 'primary', testID, disabled, busy, style }: {
  label: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; testID?: string; disabled?: boolean; busy?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const box = kind === 'primary' ? s.btnPrimary : kind === 'danger' ? s.btnDanger : s.btnGhost;
  const txt = kind === 'primary' ? s.btnPrimaryText : kind === 'danger' ? s.btnDangerText : s.btnGhostText;
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!(disabled || busy) }}
      testID={testID} disabled={disabled || busy} onPress={onPress} style={[s.btn, box, (disabled || busy) && { opacity: 0.55 }, style]}>
      {busy ? <ActivityIndicator color={kind === 'primary' ? colors.textOnNavy : colors.textBrand} /> : <Text maxFontSizeMultiplier={1.3} style={txt}>{label}</Text>}
    </TouchableOpacity>
  );
}

export function Chips<K extends string>({ options, value, onChange, testIDPrefix, multi }: {
  options: { key: K; label: string }[]; value: K | K[] | null; onChange: (k: K) => void; testIDPrefix: string; multi?: boolean;
}) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const on = (k: K) => (Array.isArray(value) ? value.includes(k) : value === k);
  return (
    <View style={s.chips}>
      {options.map(o => (
        <TouchableOpacity key={o.key} testID={`${testIDPrefix}-${o.key}`} onPress={() => onChange(o.key)}
          accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityState={multi ? { checked: on(o.key) } : { selected: on(o.key) }}
          style={[s.chip, on(o.key) && s.chipOn]}>
          <Text maxFontSizeMultiplier={1.3} style={[s.chipText, on(o.key) && s.chipTextOn]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function Check({ label, value, onChange, testID }: { label: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  return (
    <TouchableOpacity testID={testID} accessibilityRole="checkbox" accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={s.check}>
      <AppIcon name={value ? ICONS.checkbox : ICONS.checkboxEmpty} size={22} color={value ? colors.legal : colors.textMuted} />
      <Text maxFontSizeMultiplier={1.4} style={s.checkText}>{label}</Text>
    </TouchableOpacity>
  );
}

export function Notice({ text, tone = 'info', testID }: { text: string; tone?: 'info' | 'ok' | 'error'; testID?: string }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const border = tone === 'ok' ? colors.legal : tone === 'error' ? colors.danger : colors.border;
  const bg = tone === 'ok' ? colors.legalBg : tone === 'error' ? colors.errorBg : colors.bgSubtle;
  const color = tone === 'ok' ? colors.legalDark : tone === 'error' ? colors.danger : colors.textSecond;
  return (
    <View testID={testID} style={[s.notice, { borderColor: border, backgroundColor: bg }]} accessibilityLiveRegion="polite">
      <Text maxFontSizeMultiplier={1.4} style={{ color, fontSize: 14, lineHeight: 20 }}>{text}</Text>
    </View>
  );
}

export function Pill({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'ok' | 'warn' | 'danger' }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const color = tone === 'ok' ? colors.legal : tone === 'warn' ? colors.warnDark : tone === 'danger' ? colors.danger : colors.textSecond;
  return <View style={[s.pill, { borderColor: color }]}><Text maxFontSizeMultiplier={1.3} style={[s.pillText, { color }]}>{text}</Text></View>;
}

export const makeStyles = (colors: Colors) => StyleSheet.create({
  card: { backgroundColor: colors.bgCard, marginHorizontal: 12, marginTop: 12, borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: colors.border },
  cardTitle: { fontSize: 17, ...FONTS.bold, color: colors.textPrimary, marginBottom: 4 },
  line: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  strong: { ...FONTS.bold, color: colors.textPrimary },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowLabel: { fontSize: 14, color: colors.textSecond, flexShrink: 1 },
  rowValue: { fontSize: 14, ...FONTS.bold, color: colors.textPrimary, flexShrink: 1, textAlign: 'right' },
  label: { fontSize: 13, ...FONTS.bold, color: colors.textSecond, marginBottom: 4 },
  input: { minHeight: 44, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.inputText, backgroundColor: colors.inputBg },
  btn: { minHeight: 44, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, marginTop: 10 },
  btnPrimary: { backgroundColor: colors.navy },
  btnPrimaryText: { color: colors.textOnNavy, fontSize: 15, ...FONTS.bold, textAlign: 'center' },
  btnGhost: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard },
  btnGhostText: { color: colors.textBrand, fontSize: 14, ...FONTS.bold, textAlign: 'center' },
  btnDanger: { borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.bgCard },
  btnDangerText: { color: colors.danger, fontSize: 14, ...FONTS.bold, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { minHeight: 44, paddingHorizontal: 12, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { fontSize: 13, color: colors.textSecond, ...FONTS.semiBold },
  chipTextOn: { color: colors.textOnNavy },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 44, paddingVertical: 10 },
  checkText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.textPrimary },
  notice: { marginHorizontal: 12, marginTop: 12, padding: 12, borderRadius: RADIUS.md, borderWidth: 1 },
  pill: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  pillText: { fontSize: 12, ...FONTS.bold },
});

/**
 * A one-field prompt (void reason, returned to …): `ask(title, label)` resolves
 * with the text, or null when cancelled. Render `element` once in the screen.
 */
export function useTextPrompt(): { ask: (title: string, label: string, opts?: { required?: boolean; initial?: string }) => Promise<string | null>; element: React.ReactElement } {
  const [state, setState] = React.useState<{ title: string; label: string; required: boolean; resolve: (v: string | null) => void } | null>(null);
  const [value, setValue] = React.useState('');
  const ask = React.useCallback((title: string, label: string, opts?: { required?: boolean; initial?: string }) => new Promise<string | null>(resolve => {
    setValue(opts?.initial ?? '');
    setState({ title, label, required: opts?.required !== false, resolve });
  }), []);
  const close = (v: string | null) => { state?.resolve(v); setState(null); };
  const element = (
    <PromptModal visible={!!state} title={state?.title || ''} label={state?.label || ''} value={value} onChange={setValue}
      canSubmit={!state?.required || !!value.trim()} onCancel={() => close(null)} onSubmit={() => close(value.trim())} />
  );
  return { ask, element };
}

function PromptModal({ visible, title, label, value, onChange, canSubmit, onCancel, onSubmit }: {
  visible: boolean; title: string; label: string; value: string; onChange: (v: string) => void; canSubmit: boolean; onCancel: () => void; onSubmit: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.overlay, padding: 12 }}>
        <Card title={title} testID="text-prompt">
          <Field label={label} value={value} onChangeText={onChange} testID="text-prompt-input" multiline maxLength={500} />
          <Btn label={t('confirm_ok')} onPress={onSubmit} disabled={!canSubmit} testID="text-prompt-ok" />
          <Btn kind="ghost" label={t('cancel')} onPress={onCancel} testID="text-prompt-cancel" />
        </Card>
      </View>
    </Modal>
  );
}
