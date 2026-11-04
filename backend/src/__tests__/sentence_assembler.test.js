/**
 * sentence_assembler.test.js — the uncited stream assembler (ai/citations.js SentenceAssembler):
 *   - linear: a 3,000-word answer with no sentence end, streamed word by word, is assembled in
 *     well under a second (it used to re-scan the whole buffer on every token and blocked the
 *     server's event loop for minutes — web journey E7);
 *   - nothing is dropped: every character lands in exactly one sentence ("a.b works." stays whole —
 *     the old regex scan silently skipped the text before a "." not followed by a space);
 *   - a sentence is emitted only once its end (and the space after it) has arrived, so a legal
 *     sentence is still judged whole.
 * Plus the Anthropic mock's citeMode 'text' (the scripted text, cited chunk by chunk).
 */
import { SentenceAssembler } from '../ai/citations.js';
import { citedBlocks } from '../../scripts/anthropic-mock-lib.mjs';

const textOf = (a) => a.result().segments.map((s) => s.text ?? '[withheld]').join('');

describe('SentenceAssembler', () => {
  test('3,000 words without a sentence end, one token at a time, in linear time', () => {
    const a = new SentenceAssembler();
    const t0 = Date.now();
    for (let i = 0; i < 3000; i++) a.push('word ');
    a.end();
    expect(Date.now() - t0).toBeLessThan(1000);
    const got = textOf(a);
    expect(got.length === 'word '.length * 3000 && got === 'word '.repeat(3000)).toBe(true);
  });

  test('sentences split at . ! ? (+ closing quotes) followed by space, and at line breaks; nothing lost', () => {
    const a = new SentenceAssembler();
    const text = 'Version a.b works. Really?! "Yes." Then\n\nmore 。next';
    const out = [];
    for (const ch of text) out.push(...a.push(ch));
    out.push(...a.end());
    expect(out.map((e) => e.segment.text)).toEqual(['Version a.b works. ', 'Really?! ', '"Yes." ', 'Then\n', '\n', 'more 。next']);
    expect(textOf(a)).toBe(text);
  });

  test('a sentence waits for the space after its end before it is shown', () => {
    const a = new SentenceAssembler();
    expect(a.push('Hello there.')).toEqual([]);
    expect(a.push(' Next').map((e) => e.segment.text)).toEqual(['Hello there. ']);
  });
});

describe('Anthropic mock citeMode text', () => {
  const body = {
    messages: [{ role: 'user', content: [
      { type: 'search_result', source: 'jg:a', title: 'A', content: [{ type: 'text', text: 'Passage A.' }], citations: { enabled: true } },
      { type: 'text', text: 'question' },
    ] }],
  };
  test('the scripted text, cut at a line, a sentence end (4+ words) or 8 words, every chunk cited, joined unchanged', () => {
    const text = '## Head\n\nOne two. ' + Array.from({ length: 10 }, (_, i) => `w${i}`).join(' ');
    const blocks = citedBlocks(body, { citeMode: 'text', text });
    expect(blocks.map((b) => b.text).join('')).toBe(text);
    expect(blocks.map((b) => b.text)).toEqual(["## Head\n\n", "One two. w0 w1 w2 w3 w4 w5 ", "w6 w7 w8 w9"]);
    for (const b of blocks) expect(b.citations[0]).toMatchObject({ type: 'search_result_location', source: 'jg:a', search_result_index: 0 });
  });
});
