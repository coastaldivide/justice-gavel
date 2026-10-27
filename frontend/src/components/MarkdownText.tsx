/**
 * MarkdownText — the small part of Markdown AI answers use, drawn with
 * React Native <Text> only: # headings, - / * / 1. lists, **bold**, *italic*,
 * `code`, --- rules and [label](https://…) links. Nothing is ever interpreted
 * as HTML (on web, react-native-web writes text nodes), so an answer that
 * contains "<script>" or "<img onerror=…>" shows exactly those characters.
 * Links open only for http(s) URLs.
 */
import React, { memo } from 'react';
import { Linking, StyleSheet, Text, View, type TextStyle, type StyleProp } from 'react-native';
import { useTheme } from '../constants/theme';

type Inline = { kind: 'text' | 'bold' | 'italic' | 'code' | 'link'; text: string; url?: string };

const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/g;

export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  for (const seg of line.split(INLINE)) {
    if (!seg) continue;
    if ((seg.startsWith('**') && seg.endsWith('**') && seg.length > 4) || (seg.startsWith('__') && seg.endsWith('__') && seg.length > 4)) {
      out.push({ kind: 'bold', text: seg.slice(2, -2) });
    } else if (seg.startsWith('*') && seg.endsWith('*') && seg.length > 2) {
      out.push({ kind: 'italic', text: seg.slice(1, -1) });
    } else if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) {
      out.push({ kind: 'code', text: seg.slice(1, -1) });
    } else {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(seg);
      if (m) out.push(/^https?:\/\//i.test(m[2]) ? { kind: 'link', text: m[1], url: m[2] } : { kind: 'text', text: m[1] });
      else out.push({ kind: 'text', text: seg });
    }
  }
  return out;
}

export type Block =
  | { kind: 'h'; level: number; text: string }
  | { kind: 'li'; marker: string; text: string }
  | { kind: 'hr' }
  | { kind: 'gap' }
  | { kind: 'p'; text: string };

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    let m: RegExpExecArray | null;
    if (!line.trim()) { if (blocks.length && blocks[blocks.length - 1].kind !== 'gap') blocks.push({ kind: 'gap' }); continue; }
    if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) blocks.push({ kind: 'h', level: m[1].length, text: m[2] });
    else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) blocks.push({ kind: 'hr' });
    else if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) blocks.push({ kind: 'li', marker: '•', text: m[1] });
    else if ((m = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(line))) blocks.push({ kind: 'li', marker: `${m[1]}.`, text: m[2] });
    else blocks.push({ kind: 'p', text: line });
  }
  while (blocks.length && blocks[blocks.length - 1].kind === 'gap') blocks.pop();
  return blocks;
}

function InlineText({ text, color, linkColor }: { text: string; color: string; linkColor: string }) {
  return (
    <>
      {parseInline(text).map((s, i) => {
        if (s.kind === 'bold') return <Text key={i} style={styles.bold}>{s.text}</Text>;
        if (s.kind === 'italic') return <Text key={i} style={styles.italic}>{s.text}</Text>;
        if (s.kind === 'code') return <Text key={i} style={[styles.code, { color }]}>{s.text}</Text>;
        if (s.kind === 'link') {
          return (
            <Text key={i} accessibilityRole="link" style={[styles.link, { color: linkColor }]}
              onPress={() => { Linking.openURL(s.url as string).catch(() => { /* no browser: the label stays readable */ }); }}>
              {s.text}
            </Text>
          );
        }
        return <Text key={i}>{s.text}</Text>;
      })}
    </>
  );
}

function MarkdownTextImpl({ text, style, testID }: { text: string; style?: StyleProp<TextStyle>; testID?: string }) {
  const { colors } = useTheme();
  const color = (StyleSheet.flatten(style)?.color as string) || colors.textPrimary;
  const linkColor = colors.textBrand;
  return (
    <View testID={testID}>
      {parseBlocks(text).map((b, i) => {
        if (b.kind === 'gap') return <View key={i} style={styles.gap} />;
        if (b.kind === 'hr') return <View key={i} style={[styles.hr, { backgroundColor: colors.border }]} />;
        if (b.kind === 'h') {
          return (
            <Text key={i} maxFontSizeMultiplier={1.4} selectable accessibilityRole="header"
              style={[style, styles.heading, b.level <= 2 && styles.headingBig]}>
              <InlineText text={b.text} color={color} linkColor={linkColor} />
            </Text>
          );
        }
        if (b.kind === 'li') {
          return (
            <View key={i} style={styles.li}>
              <Text maxFontSizeMultiplier={1.4} style={[style, styles.marker]}>{b.marker}</Text>
              <Text maxFontSizeMultiplier={1.4} selectable style={[style, styles.liText]}>
                <InlineText text={b.text} color={color} linkColor={linkColor} />
              </Text>
            </View>
          );
        }
        return (
          <Text key={i} maxFontSizeMultiplier={1.4} selectable style={style}>
            <InlineText text={b.text} color={color} linkColor={linkColor} />
          </Text>
        );
      })}
    </View>
  );
}

export const MarkdownText = memo(MarkdownTextImpl);

const styles = StyleSheet.create({
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  code: { fontFamily: 'monospace' },
  link: { textDecorationLine: 'underline' },
  heading: { fontWeight: '800', marginTop: 4, marginBottom: 2 },
  headingBig: { fontSize: 16 },
  li: { flexDirection: 'row', gap: 6, paddingStart: 2, marginTop: 2 },
  marker: { minWidth: 16 },
  liText: { flex: 1 },
  gap: { height: 8 },
  hr: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
});
