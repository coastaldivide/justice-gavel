/**
 * CitedAnswer — an AI answer whose legal statements are tied to sources (chat bubble and legal
 * research). The server checked every citation against the passages it sent (backend
 * ai/citations.js); here:
 *   - each cited part is followed by its numbers [1] [2] — tapping one opens that source below;
 *   - a part with no source is never shown: the marker "No source found for this part — not
 *     shown" stands in its place;
 *   - "Sources": number, title, kind, jurisdiction, year and the date it was checked; open one to
 *     read the exact passage cited, then open the source page or the app screen it comes from;
 *   - an answer with no source for its legal parts (or nothing found at all) points to the rights
 *     card and legal help.
 * Layout uses start / end only, so it mirrors in Arabic (right to left).
 */
import React, { useState } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View, type StyleProp, type TextStyle } from 'react-native';
import { t, useLang, locale } from '../i18n';
import { useTheme, type ThemeColors } from '../constants/theme';
import { parseInline } from './MarkdownText';
import type { SourcedAnswer, SourcedSource } from '../services/sourced';

/** "2026-11-01" → a long date; "2026-04" → month and year. */
export function checkedLabel(v: string | null): string {
  if (!v) return '';
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (d) return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3])).toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric' });
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString(locale(), { year: 'numeric', month: 'long' });
  return '';
}

const KIND_KEYS: Record<string, string> = {
  rights_card: 'cite_kind_rights_card', court_guide: 'cite_kind_court_guide', case_steps: 'cite_kind_case_steps',
  expungement: 'cite_kind_expungement', recording_law: 'cite_kind_recording_law', library: 'cite_kind_library',
};

export function sourceMeta(s: SourcedSource): string {
  const parts: string[] = [];
  if (KIND_KEYS[s.kind]) parts.push(t(KIND_KEYS[s.kind]));
  if (s.jurisdiction) parts.push(['US', 'federal'].includes(s.jurisdiction) ? t('cite_us') : s.jurisdiction);
  if (s.year) parts.push(String(s.year));
  const c = checkedLabel(s.checked);
  if (c) parts.push(t('cite_checked', { date: c }));
  return parts.join(' · ');
}

interface Props {
  answer: SourcedAnswer;
  /** Open an app screen (RightsCard, CourtGuide, CaseSteps, Expungement, HelpNow). */
  onOpenApp?: (screen: string) => void;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
}

export default function CitedAnswer({ answer, onOpenApp, textStyle, testID = 'cited-answer' }: Props) {
  useLang();
  const { colors } = useTheme();
  const [open, setOpen] = useState<number | null>(null);
  const s = styles(colors);
  const showHelp = answer.no_source || answer.nothing_found;

  return (
    <View testID={testID}>
      <Text maxFontSizeMultiplier={1.4} selectable style={[s.body, textStyle]} testID={`${testID}-text`}>
        {answer.segments.map((g, i) => (g.withheld ? (
          <Text key={i} style={s.withheld} testID={`${testID}-withheld`}>{` ${t('cite_withheld')} `}</Text>
        ) : (
          <Text key={i}>
            {parseInline(g.text || '').map((p, j) => (
              <Text key={j} style={p.kind === 'bold' ? s.bold : p.kind === 'italic' ? s.italic : undefined}>{p.text}</Text>
            ))}
            {(g.cites || []).map((n) => {
              const src = answer.sources.find((x) => x.n === n);
              return (
                <Text key={`c${n}`} accessibilityRole="link" accessibilityLabel={t('cite_num_a11y', { n, title: src?.title || '' })}
                  testID={`${testID}-cite-${n}`} style={s.cite} onPress={() => setOpen(open === n ? null : n)}>{`[${n}]`}</Text>
              );
            })}
          </Text>
        )))}
      </Text>

      {showHelp && (
        <View style={s.notice} testID={`${testID}-no-source`}>
          {answer.no_source && <Text maxFontSizeMultiplier={1.4} style={s.noticeTitle}>{t('cite_no_source_title')}</Text>}
          {answer.no_source && <Text maxFontSizeMultiplier={1.4} style={s.noticeBody}>{t('cite_no_source_body')}</Text>}
          {!!onOpenApp && (
            <View style={s.btnRow}>
              <TouchableOpacity accessibilityRole="button" testID={`${testID}-open-rights`} style={s.btn} onPress={() => onOpenApp('RightsCard')}>
                <Text maxFontSizeMultiplier={1.3} style={s.btnText}>{t('cite_btn_rights')}</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" testID={`${testID}-open-help`} style={s.btn} onPress={() => onOpenApp('HelpNow')}>
                <Text maxFontSizeMultiplier={1.3} style={s.btnText}>{t('cite_btn_help')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {answer.sources.length > 0 && (
        <View style={s.sources} testID={`${testID}-sources`}>
          <Text maxFontSizeMultiplier={1.4} style={s.sourcesTitle}>{t('cite_sources')}</Text>
          {answer.sources.map((src) => {
            const isOpen = open === src.n;
            return (
              <View key={src.n} style={s.source} testID={`${testID}-source-${src.n}`}>
                <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: isOpen }}
                  accessibilityLabel={t('cite_num_a11y', { n: src.n, title: src.title })}
                  onPress={() => setOpen(isOpen ? null : src.n)} style={s.sourceHead}>
                  <Text maxFontSizeMultiplier={1.4} style={s.sourceNum}>{`[${src.n}]`}</Text>
                  <View style={s.sourceInfo}>
                    <Text maxFontSizeMultiplier={1.4} style={s.sourceTitle}>{src.title}</Text>
                    {!!sourceMeta(src) && <Text maxFontSizeMultiplier={1.4} style={s.sourceMeta}>{sourceMeta(src)}</Text>}
                  </View>
                </TouchableOpacity>
                {isOpen && (
                  <View style={s.passageBox} testID={`${testID}-passage-${src.n}`}>
                    <Text maxFontSizeMultiplier={1.4} style={s.passageLabel}>{t('cite_passage')}</Text>
                    <Text maxFontSizeMultiplier={1.4} selectable style={s.passage}>{`“${src.passage.trim()}”`}</Text>
                    {!!src.publisher && src.publisher !== src.title && <Text maxFontSizeMultiplier={1.4} style={s.sourceMeta}>{src.publisher}</Text>}
                    {!!src.url && (
                      <TouchableOpacity accessibilityRole="link" testID={`${testID}-open-url-${src.n}`} style={s.linkBtn}
                        onPress={() => Linking.openURL(src.url as string).catch(() => {})}>
                        <Text maxFontSizeMultiplier={1.3} style={s.link}>{t('cite_open_source')}</Text>
                      </TouchableOpacity>
                    )}
                    {(src.also || []).map((a, k) => (
                      <TouchableOpacity key={k} accessibilityRole="link" style={s.linkBtn} onPress={() => Linking.openURL(String(a.url)).catch(() => {})}>
                        <Text maxFontSizeMultiplier={1.3} style={s.link}>{a.publisher || t('cite_open_source')}</Text>
                      </TouchableOpacity>
                    ))}
                    {!!src.app_link && !!onOpenApp && (
                      <TouchableOpacity accessibilityRole="button" testID={`${testID}-open-app-${src.n}`} style={s.linkBtn}
                        onPress={() => onOpenApp(src.app_link as string)}>
                        <Text maxFontSizeMultiplier={1.3} style={s.link}>{t('cite_open_in_app')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            );
          })}
          <Text maxFontSizeMultiplier={1.3} style={s.label}>{t('cite_label')}</Text>
        </View>
      )}
    </View>
  );
}

const styles = (c: ThemeColors) => StyleSheet.create({
  body:         { fontSize: 14, lineHeight: 20, color: c.textPrimary, writingDirection: 'auto' },
  bold:         { fontWeight: '700' },
  italic:       { fontStyle: 'italic' },
  cite:         { color: c.textBrand, fontWeight: '700', fontSize: 12 },
  withheld:     { fontStyle: 'italic', color: c.textSecond },
  notice:       { marginTop: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg },
  noticeTitle:  { fontWeight: '700', color: c.textPrimary, marginBottom: 4 },
  noticeBody:   { color: c.textSecond, fontSize: 13, lineHeight: 18 },
  btnRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  btn:          { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: c.textBrand, justifyContent: 'center' },
  btnText:      { color: c.textBrand, fontWeight: '700', fontSize: 13 },
  sources:      { marginTop: 12, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8 },
  sourcesTitle: { fontWeight: '800', color: c.textPrimary, marginBottom: 4 },
  source:       { marginVertical: 3 },
  sourceHead:   { flexDirection: 'row', gap: 6, minHeight: 32, alignItems: 'flex-start' },
  sourceNum:    { color: c.textBrand, fontWeight: '700', fontSize: 13 },
  sourceInfo:   { flex: 1 },
  sourceTitle:  { color: c.textPrimary, fontSize: 13, fontWeight: '600' },
  sourceMeta:   { color: c.textSecond, fontSize: 12, marginTop: 2 },
  passageBox:   { marginTop: 6, marginStart: 18, paddingStart: 10, borderStartWidth: 3, borderStartColor: c.textBrand },
  passageLabel: { color: c.textSecond, fontSize: 12, fontWeight: '700' },
  passage:      { color: c.textPrimary, fontSize: 13, lineHeight: 19, marginTop: 2, writingDirection: 'auto' },
  linkBtn:      { minHeight: 32, justifyContent: 'center' },
  link:         { color: c.textBrand, textDecorationLine: 'underline', fontSize: 13 },
  label:        { color: c.textSecond, fontSize: 11, marginTop: 8 },
});
