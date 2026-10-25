/**
 * components/AppIcon.tsx — the app's one icon set (Ionicons via @expo/vector-icons).
 *
 * No emoji in UI text: a screen shows a meaning with an icon from ICONS
 * (semantic names, below) next to a plain translated label. The i18n strings
 * carry words only (src/__tests__/noEmoji.test.js enforces this).
 *
 *   <AppIcon name={ICONS.phone} size={18} color={colors.white} />
 *   <IconLabel icon={ICONS.location} color={c.textPrimary} textStyle={styles.x}>{t('ja_state')}</IconLabel>
 *
 * Icons are decorative for screen readers (hidden) unless they are the only
 * label of a control: pass `accessibilityLabel` and the icon is announced.
 */

import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons'; // one icon set only: the package root bundles every set's glyph map
import { themeColors, useTheme } from '../constants/theme';

export type IconName = keyof typeof Ionicons.glyphMap;

interface AppIconProps {
  name: IconName;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
  /** Only when the icon is the sole label of a control; otherwise it is hidden from screen readers. */
  accessibilityLabel?: string;
  testID?: string;
}

export function AppIcon({ name, size = 22, color, style, accessibilityLabel, testID }: AppIconProps) {
  const a11y = accessibilityLabel
    ? { accessibilityLabel, accessibilityRole: 'image' as const }
    : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const, 'aria-hidden': true };
  return <Ionicons name={name} size={size} color={color ?? themeColors().textPrimary} style={style} testID={testID} {...a11y} />;
}

/**
 * An icon followed by a label on one line (wraps under itself, not under the
 * icon). The label is the accessible text; the icon is decorative. A label
 * style with textAlign 'center' centres the row.
 */
export function IconLabel({ icon, color, iconColor, size, textStyle, style, children, numberOfLines, maxFontSizeMultiplier = 1.4, testID, center }: {
  icon: IconName;
  /** Text and icon colour; defaults to the colour in textStyle. */
  color?: string;
  /** Icon colour when it differs from the text (e.g. a semantic status colour). */
  iconColor?: string;
  size?: number; textStyle?: StyleProp<TextStyle>; style?: StyleProp<ViewStyle>;
  children: React.ReactNode; numberOfLines?: number; maxFontSizeMultiplier?: number; testID?: string; center?: boolean;
}) {
  const { colors } = useTheme();
  // Margins on the label style belong to the row (so a heading style with
  // marginBottom keeps the icon level with its text).
  const flat = { ...(StyleSheet.flatten(textStyle) || {}) } as TextStyle;
  const margins: ViewStyle = {};
  // So do the label's own flex / alignSelf / width (they size the row in its parent).
  for (const k of ['margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical',
    'flex', 'flexGrow', 'alignSelf', 'width', 'maxWidth'] as const) {
    if (flat[k] !== undefined) { (margins as Record<string, unknown>)[k] = flat[k]; delete flat[k]; }
  }
  const centered = center || flat.textAlign === 'center';
  const fontSize = flat.fontSize ?? 15;
  const textColor = (flat.color as string | undefined) ?? color ?? colors.textPrimary;
  return (
    <View style={[iconLabelStyles.row, centered && iconLabelStyles.center, margins, style]}>
      <AppIcon name={icon} size={size ?? Math.round(fontSize * 1.15)} color={iconColor ?? color ?? textColor} style={iconLabelStyles.icon} />
      <Text testID={testID} maxFontSizeMultiplier={maxFontSizeMultiplier} numberOfLines={numberOfLines}
        style={[{ color: color ?? textColor }, flat, iconLabelStyles.text, centered && iconLabelStyles.textCenter]}>{children}</Text>
    </View>
  );
}

/** A 0–5 star rating drawn with icons (decorative; give the parent an accessibilityLabel). */
export function Stars({ value, size = 14, color, style }: { value: number; size?: number; color: string; style?: StyleProp<ViewStyle> }) {
  const n = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <View style={[iconLabelStyles.stars, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[1, 2, 3, 4, 5].map(i => <AppIcon key={i} name={i <= n ? 'star' : 'star-outline'} size={size} color={color} />)}
    </View>
  );
}

const iconLabelStyles = StyleSheet.create({
  stars: { flexDirection: 'row', gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  center: { justifyContent: 'center' },
  icon: { flexShrink: 0 },
  text: { flexShrink: 1 },
  textCenter: { textAlign: 'center' },
});

// ── Semantic icon map ────────────────────────────────────────────────────────
// One name per meaning the app's former emoji carried (the emoji each replaced
// is noted so pass 2 can map the rest of the screens the same way). Use these
// constants, not raw Ionicons names, so a meaning looks the same everywhere.
export const ICONS = {
  // Navigation / chrome
  home:           'home-outline',              // 🏠
  cases:          'folder-open-outline',       // 📁 🗂
  lawyers:        'people-outline',
  settings:       'settings-outline',          // ⚙
  more:           'grid-outline',
  back:           'chevron-back',
  close:          'close',                     // ✕ ❌
  menu:           'menu-outline',
  library:        'library-outline',           // 📚 (Resources tab)
  external:       'open-outline',              // ↗
  chevronRight:   'chevron-forward',           // ›
  chevronDown:    'chevron-down',              // ▾ ▼
  chevronUp:      'chevron-up',                // ▲

  // Legal
  gavel:          'hammer-outline',
  lawyer:         'briefcase-outline',         // ⚖ (lawyer, legal help; Ionicons' "scale" is a weighing scale, so not used)
  shield:         'shield-checkmark-outline',  // 🛡 (insurance, protection)
  document:       'document-text-outline',     // 📄 📃 📜 (charges, PDFs, forms)
  clipboard:      'clipboard-outline',         // 📋 (rights card, checklists, plans)
  briefcase:      'briefcase-outline',         // 💼 (white collar, employment)
  courthouse:     'business-outline',          // 🏛 🏢 🏦 (court, jail, firm)
  rights:         'hand-left-outline',         // ✋ ✊ (do not / civil rights)
  speak:          'megaphone-outline',         // 🗣 📢 📣 (say these words, advocacy)
  silent:         'volume-mute-outline',       // 🤐 🤫 (stay silent)
  search:         'search-outline',            // 🔍 🔎
  bail:           'lock-open-outline',         // 🔓 (bail / release)
  lock:           'lock-closed-outline',       // 🔒 🔐 🔏 (sign in, private)
  key:            'key-outline',               // 🔑 🗝
  idCard:         'id-card-outline',           // 🪪 👤 (arrested person, identity)
  booking:        'barcode-outline',           // 🔢 (booking number)
  tag:            'pricetag-outline',          // 🏷
  immigration:    'airplane-outline',          // ✈ 🛂 (ICE, travel)
  globe:          'globe-outline',             // 🌐 🌎 (website, language, international)
  juvenile:       'person-outline',            // 🧒 👶 👦 👧 (children, juvenile)
  family:         'people-circle-outline',     // 👨‍👩‍👧 👪 👥 (family)
  housing:        'home-outline',              // 🏘 🏡 🏚 (housing, tenant)
  car:            'car-outline',               // 🚗 🚦 (DUI, traffic, searches)
  drug:           'medkit-outline',            // 💊 🩹 (drug charges, injury)
  weapon:         'warning-outline',           // 🔫 (weapons charges — a neutral warning glyph)
  heartBroken:    'heart-dislike-outline',     // 💔 (divorce)
  calculator:     'calculator-outline',        // 🧮
  diversion:      'git-branch-outline',        // 🔄 🔁 (diversion, alternative path)
  mentalHealth:   'pulse-outline',             // 🧠 (mental health)
  ai:             'sparkles-outline',          // 🤖 🧠 (AI features)
  medical:        'medical-outline',           // 🏥 (hospital, emergency care)
  breathe:        'leaf-outline',              // 🫁 🌱 (breathing, calm)
  ground:         'eye-outline',               // 👁 (grounding exercise)
  calm:           'partly-sunny-outline',      // 🌤 (reassurance)
  peace:          'flower-outline',            // 🕊

  // Alerts & urgency
  emergency:      'alert-circle',              // 🚨 🆘 (true emergency)
  alertCritical:  'alert-circle',
  alertHigh:      'warning-outline',           // ⚠ ⛔ 🚩 🛑 🚫
  alertNormal:    'information-circle-outline',// ℹ
  sos:            'radio-outline',             // SOS broadcast
  flash:          'flash',                     // ⚡ (quick)
  ban:            'ban-outline',               // 🚫 📵
  offline:        'cloud-offline-outline',     // 📴 📡 📵 (offline / no signal)
  signal:         'cellular-outline',          // 📶
  help:           'help-circle-outline',       // ❓ ❔
  idea:           'bulb-outline',              // 💡 (tip)
  flag:           'flag-outline',              // ⚑ 🚩 (report a listing)
  construction:   'construct-outline',         // 🚧

  // Status (pair the icon with its word and a semantic theme colour:
  // colors.legal = ok, colors.warn = caution, colors.emergency = error)
  statusOk:       'checkmark-circle',          // ✅ (ok / done)
  statusWarn:     'warning',                   // ⚠️ (caution)
  statusError:    'close-circle',              // ❌ ⛔ (failed / not eligible)
  statusUnknown:  'help-circle',               // ❔ (unknown / check)
  checkmark:      'checkmark-circle',          // ✅
  checkOutline:   'checkmark-circle-outline',
  checkbox:       'checkbox-outline',          // ☑
  checkboxEmpty:  'square-outline',            // ☐ ⬜
  radioOn:        'radio-button-on',           // ◉ ●
  radioOff:       'radio-button-off',          // ○
  dotRed:         'ellipse',                   // 🔴 🟡 🟢 (status dots; colour carries the state)
  star:           'star-outline',              // ☆
  starFilled:     'star',                      // ⭐ ★
  trophy:         'trophy-outline',            // 🏆 🥇
  medal:          'medal-outline',             // 🥈 🥉 🎖 (also veterans)
  perfect:        'ribbon-outline',            // 💯
  diamond:        'diamond-outline',           // 💎
  target:         'locate-outline',            // 🎯
  rocket:         'rocket-outline',            // 🚀
  fire:           'flame-outline',             // 🔥
  progress:       'trending-up-outline',       // 📈
  stats:          'stats-chart-outline',       // 📊
  wave:           'hand-right-outline',        // 👋 (welcome back)
  pin:            'pin-outline',               // 📌
  handshake:      'people-outline',            // 🤝
  puzzle:         'extension-puzzle-outline',  // 🧩
  graduation:     'school-outline',            // 🎓
  book:           'book-outline',              // 📖 📚 (lessons, bar prep)

  // Actions
  add:            'add-circle-outline',
  edit:           'create-outline',            // ✏ ✍ 📝
  delete:         'trash-outline',             // 🗑
  share:          'share-outline',             // 📤
  shareSocial:    'share-social-outline',      // 📱 (share to social)
  download:       'download-outline',
  save:           'save-outline',              // 💾
  print:          'print-outline',             // 🖨
  attach:         'attach-outline',            // 📎
  filter:         'funnel-outline',
  refresh:        'refresh-outline',           // ↺ ↻
  undo:           'arrow-undo-outline',        // ↩
  up:             'arrow-up-outline',          // ⬆
  clean:          'sparkles-outline',          // 🧹 (clear record)
  record:         'mic-outline',               // 🎙 🎤 (recorder, voice note)
  stop:           'stop-circle-outline',       // ⏹
  play:           'play-circle-outline',       // ▶
  camera:         'camera-outline',            // 📷 📸
  video:          'videocam-outline',          // 📹 (video consultation)
  scan:           'scan-outline',              // document scanner
  image:          'image-outline',             // 🖼
  exit:           'exit-outline',              // 🚪

  // Communication
  phone:          'call-outline',              // 📞 ☎
  phoneFilled:    'call',
  mobile:         'phone-portrait-outline',    // 📱 📲
  message:        'chatbubble-outline',        // 💬
  chat:           'chatbubbles-outline',
  notification:   'notifications-outline',     // 🔔
  mail:           'mail-outline',              // ✉ 📧 📬 📭
  send:           'send-outline',
  inbox:          'file-tray-full-outline',
  crisis:         'heart-outline',             // 💙 (crisis line 988)
  heart:          'heart',
  headset:        'headset-outline',           // live help

  // Finance
  money:          'cash-outline',              // 💰
  card:           'card-outline',              // 💳
  receipt:        'receipt-outline',
  wallet:         'wallet-outline',

  // People / account
  user:           'person-outline',            // 👤 🪑 (seat)
  attorney:       'person-circle-outline',     // 👔 (attorney)
  firm:           'business-outline',          // 🏢
  lawyerBadge:    'ribbon-outline',

  // Places & time
  location:       'location-outline',          // 📍
  directions:     'navigate-outline',          // 🧭 🗺
  map:            'map-outline',               // 🗺
  calendar:       'calendar-outline',          // 📅 📆 🗓
  calendarAdd:    'calendar-number-outline',
  clock:          'time-outline',              // 🕐 🕑 ⏱
  alarm:          'alarm-outline',             // ⏰
  hourglass:      'hourglass-outline',         // ⏳
  shirt:          'shirt-outline',             // 👔 (what to wear)
  bag:            'bag-check-outline',         // ✅ (what to bring)
  eye:            'eye-outline',
  eyeOff:         'eye-off-outline',
} as const satisfies Record<string, IconName>;

export type IconKey = keyof typeof ICONS;

export default AppIcon;
