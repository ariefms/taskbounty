// Pure text helpers: HTML -> readable text, and extractive summarisation.
// No network, no chain, no LLM — fully unit-testable.

const STOPWORDS = new Set(
  `a an the and or but if then else when while of at by for with about into
  through after over between out against during without before under around
  among is am are was were be been being have has had do does did will would
  shall should can could may might must i you he she it we they me him her us
  them my your his its our their this that these those there here what which
  who whom how why not no yes so as to in on from up down off per via also
  more most other some any each every both few than too very just only own
  same such because until`.split(/\s+/),
);

/** Decode the HTML entities we realistically meet; anything else is left as-is. */
export function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

/**
 * Strip a fetched HTML page down to readable text.
 * Removes scripts, styles, nav/footer/aside boilerplate and tags, then
 * collapses whitespace. Returns "" when there is nothing readable.
 */
export function htmlToText(html) {
  if (!html || typeof html !== "string") return "";
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<(nav|footer|header|aside|form|svg|iframe|h[1-6])[\s\S]*?<\/\1>/gi, " ");
  // Block elements become a space so words from adjacent blocks don't merge.
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote)>/gi, " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  // Reference/citation noise common on wiki-style pages.
  s = s.replace(/\[\s*\d+\s*\]/g, " ");
  s = s.replace(/\[\s*edit\s*\]/gi, " ");
  s = s.replace(/\bRetrieved\s+\d{1,2}\s+\w+\s+\d{4}\s*\./gi, " ");
  return s.replace(/[ \t\r\f\v]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

/** Split plain text into sentences (keeps the trailing punctuation). */
export function splitSentences(text) {
  if (!text) return [];
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function words(sentence) {
  return (sentence.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || []).filter(
    (w) => !STOPWORDS.has(w) && w.length > 1,
  );
}

/**
 * Extractive summary: rank sentences by keyword frequency (words that recur
 * in the text score higher), take the top N, return them in original order.
 * Nothing is generated or paraphrased — every returned sentence is verbatim
 * from the source text, so no fact can be invented.
 */
export function summarize(text, maxSentences = 5) {
  const sentences = splitSentences(text).filter((s) => {
    const w = words(s);
    return w.length >= 3 && s.length <= 600;
  });
  // Drop exact duplicate sentences (common on JS-heavy/marketing pages).
  const seen = new Set();
  const unique = sentences.filter((s) => {
    const key = s.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const sentencesDeduped = unique;
  if (sentencesDeduped.length === 0) return [];
  const freq = new Map();
  for (const s of sentencesDeduped) {
    for (const w of words(s)) freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const scored = sentencesDeduped.map((s, i) => {
    const ws = words(s);
    // Sum of keyword frequencies, lightly normalised by length so a very
    // long sentence does not win just by containing more words.
    const score = ws.reduce((acc, w) => acc + (freq.get(w) ?? 0), 0) / Math.sqrt(ws.length);
    return { sentence: s, score, index: i };
  });
  const top = scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxSentences)
    .sort((a, b) => a.index - b.index);
  return top.map((t) => t.sentence);
}

/** First http(s) URL in a string, or null. Trailing punctuation is trimmed. */
export function extractUrl(text) {
  if (!text) return null;
  const m = text.match(/https?:\/\/[^\s"'<>)\]]+/i);
  if (!m) return null;
  return m[0].replace(/[.,;:!?]+$/, "");
}

/** A task is in scope for this worker: category research + a URL or a question. */
export function isResearchTask(task) {
  if (!task || task.category !== "research" || task.status !== "Open") return false;
  const desc = (task.description || "").trim();
  if (desc.length < 10) return false;
  return Boolean(extractUrl(desc) || desc.endsWith("?") || desc.length >= 20);
}
