/**
 * LegalSource — how a legal-information screen says where its content comes from
 * (the pattern Penalties uses, section E):
 *
 *   <UnreviewedNotice />  a warning box: general information, not reviewed by a
 *                         lawyer, no source recorded (or the text you pass)
 *   <SourceLine />        "Source as recorded: … · recorded <date>" under a row,
 *                         plus "not checked again since" / "last checked <date>"
 *
 * `lang` renders the text in another language than the app's (IceDetention can
 * switch one page to English to show it to someone).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../constants/theme';
import { t, tl, useLang, locale, type Lang } from '../i18n';
import { IconLabel, ICONS } from './AppIcon';

/** 'YYYY-MM-DD' or an ISO time → a long local date ('' when absent / invalid). */
export function recordedDate(v?: string | null, lang?: Lang): string {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale(lang), { year: 'numeric', month: 'long', day: 'numeric' });
}

export function UnreviewedNotice({ text, lang, inset = true, testID = 'unreviewed-notice' }: { text?: string; lang?: Lang; inset?: boolean; testID?: string }): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const tx = (k: string) => (lang ? tl(lang, k) : t(k));
  return (
    <View testID={testID} style={[styles.notice, !inset && styles.flush, { backgroundColor: colors.warnBg, borderLeftColor: colors.warnDark }]} accessibilityRole="summary">
      <IconLabel icon={ICONS.alertHigh} color={colors.warnDark} textStyle={[styles.noticeText, { color: colors.textPrimary }]} style={styles.noticeRow}>{text || tx('src_guide_not_reviewed')}</IconLabel>
    </View>
  );
}

export function SourceLine({ source, recorded, verified, lang, testID = 'source-line' }: {
  source?: string | null; recorded?: string | null; verified?: string | null; lang?: Lang; testID?: string;
}): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const tx = (k: string, p?: Record<string, string>) => (lang ? tl(lang, k, p) : t(k, p));
  const when = recordedDate(recorded, lang);
  const parts = [when
    ? tx('pen_source', { source: source || tx('pen_source_unknown'), date: when })
    : tx('src_source_only', { source: source || tx('pen_source_unknown') })];
  if (verified) parts.push(tx('src_last_checked', { date: recordedDate(verified, lang) }));
  else if (when) parts.push(tx('src_not_rechecked'));
  return <Text testID={testID} maxFontSizeMultiplier={1.3} style={[styles.source, { color: colors.textMuted }]}>{parts.join(' · ')}</Text>;
}

const styles = StyleSheet.create({
  notice: { borderRadius: 10, borderLeftWidth: 4, padding: 12, marginHorizontal: 12, marginTop: 12, marginBottom: 4 },
  flush: { marginHorizontal: 0 },
  noticeRow: { alignItems: 'flex-start' },
  noticeText: { fontSize: 13, lineHeight: 19 },
  source: { fontSize: 12, lineHeight: 17, marginTop: 6 },
});
