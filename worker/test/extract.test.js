import test from "node:test";
import assert from "node:assert/strict";
import {
  htmlToText,
  splitSentences,
  summarize,
  extractUrl,
  isResearchTask,
} from "../src/extract.js";

// --- HTML text extractor ---

test("htmlToText strips scripts/styles/tags and decodes entities", () => {
  const html = `<html><head><style>.x{color:red}</style>
    <script>var secret = 1;</script></head>
    <body><h1>Page Heading To Drop</h1><p>NEAR &amp; Agents</p><p>First paragraph.</p>
    <p>Second &lt;paragraph&gt; with &#39;quotes&#39;.</p></body></html>`;
  const text = htmlToText(html);
  assert.ok(text.includes("NEAR & Agents"));
  assert.ok(text.includes("First paragraph."));
  assert.ok(text.includes("Second <paragraph> with 'quotes'."));
  assert.ok(!text.includes("secret"));
  assert.ok(!text.includes("color:red"));
  assert.ok(!text.includes("Page Heading To Drop")); // headings are dropped
  assert.ok(!text.includes("<p>"));
});

test("htmlToText returns empty string for empty/garbage input", () => {
  assert.equal(htmlToText(""), "");
  assert.equal(htmlToText("<script>only()</script>"), "");
  assert.equal(htmlToText(null), "");
});

// --- Extractive summariser ---

const DOC = [
  "NEAR Protocol is a layer-one blockchain designed for usability and scalability.",
  "NEAR Protocol uses sharding to scale transaction throughput as the network grows.",
  "The weather in Paris is mild in November with occasional rain.",
  "Developers build smart contracts on NEAR Protocol using Rust or JavaScript.",
  "NEAR Protocol sharding splits the network into pieces called shards.",
  "Cooking rice needs water, heat, and a pot with a lid.",
].join(" ");

test("summarize returns verbatim sentences about the dominant topic, in order", () => {
  const out = summarize(DOC, 3);
  assert.equal(out.length, 3);
  // Every returned sentence must be verbatim from the source — nothing invented.
  for (const s of out) assert.ok(DOC.includes(s), `not verbatim: ${s}`);
  // NEAR/sharding sentences dominate by keyword frequency; off-topic ones lose.
  assert.ok(out.some((s) => s.includes("NEAR Protocol")));
  assert.ok(!out.some((s) => s.includes("Cooking rice")));
  assert.ok(!out.some((s) => s.includes("weather in Paris")));
  // Original order preserved.
  const idx = out.map((s) => DOC.indexOf(s));
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
});

test("summarize returns [] when there is nothing to summarise", () => {
  assert.deepEqual(summarize("", 5), []);
  assert.deepEqual(summarize("Hi.", 5), []);
});

test("summarize drops duplicate sentences", () => {
  const dup = "NEAR uses sharding to scale. NEAR uses sharding to scale. Sharding splits the network.";
  const out = summarize(dup, 5);
  assert.equal(new Set(out).size, out.length);
  assert.ok(out.includes("NEAR uses sharding to scale."));
});

test("splitSentences splits on sentence boundaries", () => {
  assert.deepEqual(splitSentences("One. Two! Three? Four."), [
    "One.",
    "Two!",
    "Three?",
    "Four.",
  ]);
});

// --- Task scoping ---

test("extractUrl finds the first URL and trims trailing punctuation", () => {
  assert.equal(
    extractUrl("Read https://example.com/page, please."),
    "https://example.com/page",
  );
  assert.equal(extractUrl("no url here"), null);
});

test("isResearchTask accepts only Open research tasks with a URL or question", () => {
  const base = { status: "Open", category: "research", description: "Summarise https://example.com" };
  assert.equal(isResearchTask(base), true);
  assert.equal(isResearchTask({ ...base, description: "What is NEAR sharding?" }), true);
  assert.equal(isResearchTask({ ...base, category: "text" }), false);
  assert.equal(isResearchTask({ ...base, status: "Claimed" }), false);
  assert.equal(isResearchTask({ ...base, description: "short" }), false);
});
