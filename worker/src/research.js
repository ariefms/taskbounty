// Research step: fetch a URL (or DuckDuckGo Lite search for a question),
// extract readable text, build an extractive summary.
// On any failure this returns { ok: false, reason } — never a fabricated summary.

import { htmlToText, summarize, extractUrl } from "./extract.js";

const USER_AGENT =
  "TaskBounty-Worker/0.1 (+https://github.com/; demo research agent, testnet only)";

/** Fetch a URL as text. 10 s timeout, follows redirects (fetch default). */
export async function fetchText(url, timeoutMs = 10_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html, text/plain, */*" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const body = await res.text();
    if (contentType.includes("text/html")) return htmlToText(body);
    if (contentType.includes("text/plain") || contentType.includes("text/")) return body.trim();
    // Unknown content type: try it as HTML anyway; empty result is handled below.
    const text = htmlToText(body);
    return text || body.trim();
  } finally {
    clearTimeout(timer);
  }
}

function decodeUddg(href) {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/**
 * DuckDuckGo Lite HTML search. Returns the top result URL, or null.
 * Parses the result-link anchors; the real target hides in the uddg param.
 */
export async function searchDuckDuckGo(query, timeoutMs = 10_000, fetchFn = fetch) {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      signal: ctrl.signal,
      headers: { "user-agent": USER_AGENT },
    });
    if (!res.ok) throw new Error(`DuckDuckGo Lite HTTP ${res.status}`);
    const html = await res.text();
    // Anchors look like: <a rel="nofollow" href="//duckduckgo.com/l/?uddg=...&amp;rut=..."
    // class='result-link'> (single quotes, class after href).
    const anchors = [...html.matchAll(/<a[^>]*class=['"]result-link['"][^>]*>/gi)];
    for (const [tag] of anchors) {
      const hrefMatch = tag.match(/href="([^"]+)"/i) || tag.match(/href='([^']+)'/i);
      if (!hrefMatch) continue;
      const href = hrefMatch[1].replace(/&amp;/g, "&");
      const target = decodeUddg(href) || (href.startsWith("http") ? href : null);
      if (target && /^https?:\/\//.test(target)) return target;
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Do the research for one task.
 * Returns { ok: true, sourceUrl, summary, sentences, textChars } or
 * { ok: false, reason } when there is nothing usable to summarise.
 */
export async function doResearch(task, opts = {}) {
  const timeoutMs = opts.fetchTimeoutMs ?? 10_000;
  const fetchFn = opts.fetchText ?? fetchText;
  const searchFn = opts.search ?? searchDuckDuckGo;
  const description = (task.description || "").trim();

  let sourceUrl = extractUrl(description);
  if (!sourceUrl) {
    // No URL: search the question/description, take the top result.
    const query = description.slice(0, 200);
    let top;
    try {
      top = await searchFn(query, timeoutMs);
    } catch (err) {
      return { ok: false, reason: `web search failed: ${err.message}` };
    }
    if (!top) return { ok: false, reason: "web search returned no results" };
    sourceUrl = top;
  }

  let text;
  try {
    text = await fetchFn(sourceUrl, timeoutMs);
  } catch (err) {
    return { ok: false, reason: `fetch failed for ${sourceUrl}: ${err.message}` };
  }
  if (!text || text.length < 200) {
    return { ok: false, reason: `no usable text from ${sourceUrl} (${text?.length ?? 0} chars)` };
  }

  const sentences = summarize(text, 5);
  if (sentences.length === 0) {
    return { ok: false, reason: `could not extract sentences from ${sourceUrl}` };
  }
  const summary =
    `Source: ${sourceUrl}\n\n` +
    `Summary (extractive — sentences copied verbatim from the source):\n` +
    sentences.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return { ok: true, sourceUrl, summary, sentences, textChars: text.length };
}
