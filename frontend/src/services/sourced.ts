/**
 * sourced.ts — the shape of a sourced AI answer (backend ai/citations.js publicAnswer) and a
 * reader that keeps only well-formed parts. The server already verified every citation against
 * the passages it sent; the app never shows a part the server marked `withheld`, and a citation
 * number that names no listed source is not drawn.
 */
export interface SourcedSegment { text?: string; cites?: number[]; withheld?: boolean }
export interface SourcedSource {
  n: number;
  id: string;
  kind: string;
  title: string;
  jurisdiction: string | null;
  year: number | null;
  url: string | null;
  publisher: string | null;
  checked: string | null;
  app_link: string | null;
  also?: { publisher?: string; url?: string | null }[];
  passage: string;
}
export interface SourcedAnswer {
  grounded: boolean;
  nothing_found?: boolean;
  no_source?: boolean;
  segments: SourcedSegment[];
  sources: SourcedSource[];
  withheld?: number;
  dropped?: number;
}

/** In-app screens a source may open (MoreTab stack). */
export const APP_LINKS: readonly string[] = ['RightsCard', 'CourtGuide', 'CaseSteps', 'Expungement'];

const isHttp = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u);

/** A server value → a SourcedAnswer, or null when it is not one. */
export function readSourced(v: unknown): SourcedAnswer | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.segments)) return null;
  const sources: SourcedSource[] = (Array.isArray(o.sources) ? o.sources : [])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && Number.isInteger((s as { n?: unknown }).n) && typeof (s as { title?: unknown }).title === 'string')
    .map((s) => ({
      n: Number(s.n), id: String(s.id ?? ''), kind: String(s.kind ?? ''), title: String(s.title),
      jurisdiction: typeof s.jurisdiction === 'string' ? s.jurisdiction : null,
      year: Number.isInteger(s.year) ? Number(s.year) : null,
      url: isHttp(s.url) ? s.url : null,
      publisher: typeof s.publisher === 'string' ? s.publisher : null,
      checked: typeof s.checked === 'string' ? s.checked : null,
      app_link: typeof s.app_link === 'string' && APP_LINKS.includes(s.app_link) ? s.app_link : null,
      also: Array.isArray(s.also) ? (s.also as { publisher?: string; url?: string | null }[]).filter((a) => a && isHttp(a.url)) : [],
      passage: typeof s.passage === 'string' ? s.passage : '',
    }));
  const known = new Set(sources.map((s) => s.n));
  const segments: SourcedSegment[] = [];
  for (const raw of o.segments as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const g = raw as Record<string, unknown>;
    if (g.withheld === true) { segments.push({ withheld: true }); continue; }
    if (typeof g.text !== 'string') continue;
    segments.push({ text: g.text, cites: (Array.isArray(g.cites) ? g.cites : []).filter((n): n is number => Number.isInteger(n) && known.has(n as number)) });
  }
  return {
    grounded: o.grounded === true, nothing_found: o.nothing_found === true, no_source: o.no_source === true,
    segments, sources, withheld: Number(o.withheld) || 0, dropped: Number(o.dropped) || 0,
  };
}

/** Append one streamed segment (and the sources it first cites) to an answer being built. */
export function appendSegment(a: SourcedAnswer | null, segment: unknown, sources: unknown): SourcedAnswer {
  const cur: SourcedAnswer = a ? { ...a, segments: [...a.segments], sources: [...a.sources] } : { grounded: false, segments: [], sources: [] };
  const extra = readSourced({ segments: [], sources: Array.isArray(sources) ? sources : [] });
  for (const s of extra?.sources || []) if (!cur.sources.some((x) => x.n === s.n)) cur.sources.push(s);
  if (cur.sources.length) cur.grounded = true;
  const one = readSourced({ segments: [segment], sources: cur.sources });
  const seg = one?.segments[0];
  if (seg && !(seg.withheld && cur.segments[cur.segments.length - 1]?.withheld)) cur.segments.push(seg);
  return cur;
}

/** The visible words (no markers) — copy / share / export. */
export function sourcedPlainText(a: SourcedAnswer, withheldLabel: string): string {
  return a.segments.map((g) => (g.withheld ? ` [${withheldLabel}] ` : `${g.text}${g.cites?.length ? g.cites.map((n) => `[${n}]`).join('') : ''}`)).join('').replace(/[ \t]{2,}/g, ' ').trim()
    + (a.sources.length ? `\n\n${a.sources.map((s) => `[${s.n}] ${s.title}${s.url ? ` — ${s.url}` : ''}`).join('\n')}` : '');
}
