/**
 * CitedAnswer — an AI answer whose legal statements are tied to sources (chat bubble and legal
 * research). The server checked every citation against the passages it sent (backend
 * ai/citations.js); here:
 *   - each cited part is followed by its numbers [1] [2] — tapping one opens that source below;
 *   - headings, list items and rules are drawn like MarkdownText (citedLines), bold / italic /
 *     code inline; text only, never HTML;
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

type Piece = { text: string; cites: number[]; withheld?: boolean };
type CitedLine = { kind: 'p' | 'h' | 'li' | 'gap' | 'hr'; level: number; marker: string; pieces: Piece[] };

/**
 * The answer's segments as lines of markdown blocks (heading, list item, rule, paragraph), each
 * line keeping which piece of text carries which source numbers — so a cited answer is drawn
 * like any other answer (MarkdownText) with its numbers in place. Text only, never HTML.
 */
export function citedLines(segments: SourcedAnswer['segments']): CitedLine[] {
  const raw: Piece[][] = [[]];
  for (const g of segments) {
    if (g.withheld) { raw[raw.length - 1].push({ text: '', cites: [], withheld: true }); continue; }
    // A cited run of only spaces / line breaks: its numbers go with the words before it.
    if (!String(g.text || '').trim() && (g.cites || []).length) {
      const prev = raw.flat().reverse().find((p) => !p.withheld && p.text.trim());
      if (prev) prev.cites = [...prev.cites, ...(g.cites || []).filter((n) => !prev.cites.includes(n))];
      String(g.text || '').split('\n').slice(1).forEach(() => raw.push([]));
      continue;
    }
    const parts = String(g.text || '').split('\n');
    // the numbers follow the segment's last words (not the empty line after a trailing break)
    let at = parts.length - 1;
    while (at > 0 && !parts[at].trim()) at -= 1;
    parts.forEach((part, k) => {
      if (k > 0) raw.push([]);
      if (part || k === at) raw[raw.length - 1].push({ text: part, cites: k === at ? (g.cites || []) : [] });
    });
  }
  const out: CitedLine[] = [];
  for (const pieces of raw) {
    const full = pieces.map((p) => p.text).join('');
    if (!pieces.some((p) => p.withheld || p.cites.length) && !full.trim()) {
      if (out.length && out[out.length - 1].kind !== 'gap') out.push({ kind: 'gap', level: 0, marker: '', pieces: [] });
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(full) && !pieces.some((p) => p.withheld || p.cites.length)) { out.push({ kind: 'hr', level: 0, marker: '', pieces: [] }); continue; }
    let m: RegExpExecArray | null;
    let kind: 'p' | 'h' | 'li' = 'p'; let level = 0; let marker = ''; let cut = 0;
    if ((m = /^(#{1,4})\s+/.exec(full))) { kind = 'h'; level = m[1].length; cut = m[0].length; }
    else if ((m = /^\s*[-*•]\s+/.exec(full))) { kind = 'li'; marker = '•'; cut = m[0].length; }
    else if ((m = /^\s*(\d{1,3})[.)]\s+/.exec(full))) { kind = 'li'; marker = `${m[1]}.`; cut = m[0].length; }
    const kept: Piece[] = [];
    for (const p of pieces) {
      if (cut > 0 && !p.withheld) {
        const take = Math.min(cut, p.text.length);
        cut -= take;
        const rest = p.text.slice(take);
        if (rest || p.cites.length) kept.push({ ...p, text: rest });
      } else kept.push(p);
    }
    out.push({ kind, level, marker, pieces: kept });
  }
  while (out.length && out[out.length - 1].kind === 'gap') out.pop();
  return out;
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
      <View testID={`${testID}-text`}>
        {citedLines(answer.segments).map((line, li) => {
          if (line.kind === 'gap') return <View key={li} style={s.gap} />;
          if (line.kind === 'hr') return <View key={li} style={s.hr} />;
          const body = (
            <Text maxFontSizeMultiplier={1.4} selectable accessibilityRole={line.kind === 'h' ? 'header' : undefined}
              style={[s.body, textStyle, line.kind === 'h' && s.heading, line.kind === 'h' && line.level <= 2 && s.headingBig, line.kind === 'li' && s.liText]}>
              {line.pieces.map((g, i) => (g.withheld ? (
                <Text key={i} style={s.withheld} testID={`${testID}-withheld`}>{` ${t('cite_withheld')} `}</Text>
              ) : (
                <Text key={i}>
                  {parseInline(g.text).map((p, j) => (
                    <Text key={j} style={p.kind === 'bold' ? s.bold : p.kind === 'italic' ? s.italic : p.kind === 'code' ? s.code : undefined}>{p.text}</Text>
                  ))}
                  {g.cites.map((n) => {
                    const src = answer.sources.find((x) => x.n === n);
                    return (
                      <Text key={`c${n}`} accessibilityRole="link" accessibilityLabel={t('cite_num_a11y', { n, title: src?.title || '' })}
                        testID={`${testID}-cite-${n}`} style={s.cite} onPress={() => setOpen(open === n ? null : n)}>{`[${n}]`}</Text>
                    );
                  })}
                </Text>
              )))}
            </Text>
          );
          if (line.kind !== 'li') return <React.Fragment key={li}>{body}</React.Fragment>;
          return (
            <View key={li} style={s.li}>
              <Text maxFontSizeMultiplier={1.4} style={[s.body, textStyle, s.marker]}>{line.marker}</Text>
              {body}
            </View>
          );
        })}
      </View>

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
  code:         { fontFamily: 'monospace' },
  heading:      { fontWeight: '800', marginTop: 4, marginBottom: 2 },
  headingBig:   { fontSize: 16 },
  li:           { flexDirection: 'row', gap: 6, paddingStart: 2, marginTop: 2 },
  marker:       { minWidth: 16 },
  liText:       { flex: 1 },
  gap:          { height: 8 },
  hr:           { height: StyleSheet.hairlineWidth, marginVertical: 8, backgroundColor: c.border },
  cite:         { color: c.textBrand, fontWeight: '700', fontSize: 12 },
  withheld:     { fontStyle: 'italic', color: c.textSecond },
  notice:       { marginTop: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg },
  noticeTitle:  { fontWeight: '700', color: c.textPrimary, marginBottom: 4 },
  noticeBody:   { color: c.textSecond, fontSize: 14, lineHeight: 19 },
  btnRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  btn:          { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: c.textBrand, justifyContent: 'center' },
  btnText:      { color: c.textBrand, fontWeight: '700', fontSize: 14 },
  sources:      { marginTop: 12, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8 },
  sourcesTitle: { fontWeight: '800', color: c.textPrimary, marginBottom: 4 },
  source:       { marginVertical: 3 },
  sourceHead:   { flexDirection: 'row', gap: 6, minHeight: 44, alignItems: 'flex-start' },
  sourceNum:    { color: c.textBrand, fontWeight: '700', fontSize: 14 },
  sourceInfo:   { flex: 1 },
  sourceTitle:  { color: c.textPrimary, fontSize: 14, fontWeight: '600' },
  sourceMeta:   { color: c.textSecond, fontSize: 12, marginTop: 2 },
  passageBox:   { marginTop: 6, marginStart: 18, paddingStart: 10, borderStartWidth: 3, borderStartColor: c.textBrand },
  passageLabel: { color: c.textSecond, fontSize: 12, fontWeight: '700' },
  passage:      { color: c.textPrimary, fontSize: 14, lineHeight: 20, marginTop: 2, writingDirection: 'auto' },
  linkBtn:      { minHeight: 44, justifyContent: 'center' },
  link:         { color: c.textBrand, textDecorationLine: 'underline', fontSize: 14 },
  label:        { color: c.textSecond, fontSize: 12, marginTop: 8 },
});
