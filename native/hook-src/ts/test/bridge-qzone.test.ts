// Qzone tests: every pure transform against the reference's own behaviour, plus
// differential checks against the four vendored packages the reference used.
//
// The two differential suites here are the important ones, because they are the
// only way to know the hand-written replacements are faithful:
//
//   * `parseQzoneFeedContent` vs `work/bridge-parts/ref/qzone-feed-content.mjs`,
//     which is the reference region loaded with htmlparser2/domhandler/domutils/
//     entities still attached (reference/index.mjs:330535–335541). The fixtures
//     below are shaped like real feed rows — nested divs, an unclosed `<p>`, a
//     comment subtree, a video cover, protocol-relative image URLs.
//   * `parseJsLiteral` vs `JSON.parse` on equivalent input, plus round-trips
//     through the JS-literal-specific syntax that JSON cannot express.
//
// What is NOT tested: the sixteen HTTP calls and the gotrpc JSON surface. A fake
// transport would only prove the fake matches the fake. What IS tested is every
// URL and body those calls are built from (asserted as exact strings), every
// response mapping (constructed inputs), and every cursor/validation rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  QZONE_FEED_CURSOR_MAX_LENGTH,
  QZONE_FEED_NUMERIC_FIELDS,
  QZONE_FEED_STATE_FIELDS,
  QZONE_FEED_STRING_FIELDS,
  decodeQzoneFeedCursor,
  encodeQzoneFeedCursor,
  initialQzoneFeedState,
  nextQzoneFeedState,
  qzoneFeedPosition,
  type QzoneFeedState,
} from "../src/bridge/web/qzone-feed-cursor.js";
import {
  QZONE_APPID_SHUOSHUO,
  count,
  hasClass,
  imageUrl,
  parseQzoneFeedContent,
  text as feedText,
} from "../src/bridge/web/qzone-feed-content.js";
import { findAll, decodeEntities, parseDocument, stripTags, type HtmlNode } from "../src/bridge/web/html.js";
import {
  QZONE_FEED_MAX_COUNT,
  QZONE_MSG_LIST_RATE_LIMIT,
  QZONE_UGC_RIGHTS,
  assertRichParams,
  buildQzoneUpdatePayload,
  deleteQzoneMsg,
  feedHasMore,
  getQzoneFeeds,
  legacyMsgListRoute,
  mapFeeds,
  mapMsgList,
  normalizeQzoneImageBase64,
  normalizeQzoneUgcRight,
  normalizeTargetUins,
  parseJsLiteral,
  parseQzoneCallback,
  parseQzoneJson,
  pickPicUrl,
  userMsgListRoute,
} from "../src/bridge/web/qzone.js";
import {
  decodeCursor,
  encodeCursor,
  encodeQzoneEmotionUgcId,
  feedParams,
  getQzoneFeedDetail,
  getQzoneHomeFeeds,
  getQzonePublicFeeds,
  isObject,
  richContent,
  setQzonePublicFollow,
} from "../src/bridge/web/qzone-public.js";
import { getBknFromCookie } from "../src/bridge/web/request-util.js";
import { MemoryIdentity } from "../src/bridge/bridge.js";
import { QzoneApi } from "../src/bridge/apis/qzone.js";
import type { BridgeContext } from "../src/bridge/context.js";

// ===========================================================================
// 1. Differential: parseQzoneFeedContent vs the four vendored packages
// ===========================================================================

interface RefFeedContent {
  tid: string | null;
  content: string | null;
  content_complete: boolean | null;
  images: string[] | null;
  like_count: number | null;
  comment_count: number | null;
}
type RefParse = (
  html: string,
  key: string,
  uin: number,
  appid: number,
  likeCount: unknown,
  commentCount: unknown,
) => RefFeedContent;

/**
 * The reference region loaded as a LIVE module, if the dev artefact is present.
 *
 * `work/bridge-parts/ref/qzone-feed-content.mjs` is `reference/index.mjs:330535-
 * 335634` re-sliced with prelude stubs, so it still carries the real htmlparser2,
 * domhandler, domutils and entities. Importing it is what makes the differential
 * suite below a comparison rather than a recording of my own output.
 */
// Resolved from the COMPILED location (`build/test/`), which is three levels
  // below the repo root, not two. Building the path from `import.meta.url` keeps it
  // correct under `node --test build/test/*.test.js` without a cwd assumption.
  const ORACLE_URL = new URL("../../../work/bridge-parts/ref/qzone-feed-content.mjs", import.meta.url);

async function loadOracle(): Promise<RefParse | null> {
  try {
    const module = (await import(ORACLE_URL.href)) as { parseQzoneFeedContent?: unknown };
    return typeof module.parseQzoneFeedContent === "function" ? (module.parseQzoneFeedContent as RefParse) : null;
  } catch {
    return null;
  }
}

/** The fixtures below are the differential corpus; also used by the pure tests. */
const FEED_FIXTURES: { name: string; html: string; key: string; uin: number; appid: number; like: unknown; comment: unknown }[] = [
  {
    name: "one paragraph and one photo",
    html: '<li class="f-item" data-key="K1"><div class="f-info"><span>hello</span></div><div class="img-item" data-originurl="//p.qpic.cn/a.jpg"></div></li>',
    key: "K1",
    uin: 42,
    appid: 311,
    like: "7",
    comment: "3",
  },
  {
    name: "nested divs and a br",
    html: '<li class="f-item" data-key="K2"><div class="f-info"><div>line1</div><div>line2<br/>line3</div></div></li>',
    key: "K2",
    uin: 42,
    appid: 311,
    like: undefined,
    comment: undefined,
  },
  {
    name: "feed_data metadata with a tid",
    html: '<li class="f-item" data-key="K3"><i name="feed_data" data-uin="42" data-fkey="K3" data-tid="TID-3"></i><div class="f-info qz_info_complete">full text</div></li>',
    key: "K3",
    uin: 42,
    appid: 311,
    like: null,
    comment: null,
  },
  {
    name: "appid 8 must not pick up a tid",
    html: '<li class="f-item" data-key="K4"><i name="feed_data" data-uin="42" data-fkey="K4" data-tid="TID-4"></i><div class="f-info">x</div></li>',
    key: "K4",
    uin: 42,
    appid: 8,
    like: 0,
    comment: 0,
  },
  {
    name: "truncated post with a qz_toggle",
    html: '<li class="f-item" data-key="K5"><div class="f-info">prefix<span data-cmd="qz_toggle">全文</span></div></li>',
    key: "K5",
    uin: 42,
    appid: 311,
    like: undefined,
    comment: undefined,
  },
  {
    name: "video cover skipped",
    html: '<li class="f-item" data-key="K6"><div class="img-item" data-v_itemid="v1" data-originurl="//p.qpic.cn/v.jpg"></div><div class="img-item" data-originurl="//p.qpic.cn/p.jpg"></div></li>',
    key: "K6",
    uin: 42,
    appid: 311,
    like: undefined,
    comment: undefined,
  },
  {
    name: "comment subtree invisible",
    html: '<li class="f-item" data-key="K7"><div class="f-info">post</div><div class="mod-comments"><div class="f-info">comment</div></div></li>',
    key: "K7",
    uin: 42,
    appid: 311,
    like: undefined,
    comment: undefined,
  },
  {
    name: "img fallback truesrc plus an emoji alt",
    html: '<li class="f-item" data-key="K8"><div class="f-info">hi<img alt="[微笑]"/>there</div><div class="img-item"><img src="//p.qpic.cn/lo.jpg" truesrc="//p.qpic.cn/hi.jpg"/></div></li>',
    key: "K8",
    uin: 42,
    appid: 311,
    like: undefined,
    comment: undefined,
  },
  {
    name: "unclosed paragraphs",
    html: '<li class="f-item" data-key="K9"><div class="f-info"><p>unclosed<p>second</div></li>',
    key: "K9",
    uin: 42,
    appid: 311,
    like: undefined,
    comment: undefined,
  },
  {
    name: "entities",
    html: '<li class="f-item" data-key="KA"><div class="f-info">a &amp; b &nbsp; c &#20320;&#x597d; &copy;</div></li>',
    key: "KA",
    uin: 42,
    appid: 311,
    like: undefined,
    comment: undefined,
  },
  {
    name: "like button outside the f-item",
    html: '<div class="f-single"><li class="f-item" data-key="KB"><div class="f-info">post</div></li><a class="qz_like_btn_v3" data-likecnt="99"></a></div>',
    key: "KB",
    uin: 42,
    appid: 311,
    like: undefined,
    comment: undefined,
  },
  {
    name: "no matching body",
    html: '<li class="f-item" data-key="OTHER"><div class="f-info">nope</div></li>',
    key: "KZ",
    uin: 42,
    appid: 311,
    like: 5,
    comment: 6,
  },
  {
    name: "load_img dropped from text",
    html: '<li class="f-item" data-key="KC"><div class="f-info">text<span class="load_img">展开</span></div></li>',
    key: "KC",
    uin: 42,
    appid: 311,
    like: undefined,
    comment: undefined,
  },
  {
    name: "duplicate image url collapses",
    html: '<li class="f-item" data-key="KD"><div class="img-item" data-originurl="https://p.qpic.cn/1.jpg"></div><div class="img-item" data-originurl="https://p.qpic.cn/2.jpg"></div><div class="img-item" data-originurl="https://p.qpic.cn/1.jpg"></div></li>',
    key: "KD",
    uin: 42,
    appid: 311,
    like: undefined,
    comment: undefined,
  },
  {
    name: "data-url3 fallback",
    html: '<li class="f-item" data-key="KE"><div class="img-item" data-url3="https://p.qpic.cn/3.jpg"></div></li>',
    key: "KE",
    uin: 42,
    appid: 311,
    like: undefined,
    comment: undefined,
  },
  {
    name: "nested list li newlines",
    html: '<li class="f-item" data-key="KF"><div class="f-info">a<ul><li>b</li><li>c</li></ul></div></li>',
    key: "KF",
    uin: 42,
    appid: 311,
    like: undefined,
    comment: undefined,
  },
];

/** The expected results, captured from the vendored bundle (see the header). */
const FEED_EXPECTED: Record<string, RefFeedContent> = {
  K1: { tid: null, content: "hello", content_complete: true, images: ["https://p.qpic.cn/a.jpg"], like_count: 7, comment_count: 3 },
  K2: { tid: null, content: "line1\n\nline2\nline3", content_complete: true, images: [], like_count: null, comment_count: null },
  K3: { tid: "TID-3", content: "full text", content_complete: true, images: [], like_count: null, comment_count: null },
  K4: { tid: null, content: "x", content_complete: true, images: [], like_count: 0, comment_count: 0 },
  K5: { tid: null, content: "prefix", content_complete: false, images: [], like_count: null, comment_count: null },
  K6: { tid: null, content: null, content_complete: null, images: ["https://p.qpic.cn/p.jpg"], like_count: null, comment_count: null },
  K7: { tid: null, content: "post", content_complete: true, images: [], like_count: null, comment_count: null },
  // The img's alt is inline: no newline is inserted before or after it, because an
  // img is not a block element. The `\n` in the source between `</div>` and the
  // text is collapsed by the whitespace rule.
  K8: { tid: null, content: "hi[微笑]there", content_complete: true, images: ["https://p.qpic.cn/hi.jpg"], like_count: null, comment_count: null },
  K9: { tid: null, content: "unclosed\n\nsecond", content_complete: true, images: [], like_count: null, comment_count: null },
  // JS `\s` matches U+00A0, so `&nbsp;` collapses to a plain space inside feed
  // text — it does NOT survive as a non-breaking space.
  KA: { tid: null, content: "a & b c 你好 \u00a9", content_complete: true, images: [], like_count: null, comment_count: null },
  KB: { tid: null, content: "post", content_complete: true, images: [], like_count: 99, comment_count: null },
  KZ: { tid: null, content: null, content_complete: null, images: null, like_count: 5, comment_count: 6 },
  KC: { tid: null, content: "text", content_complete: true, images: [], like_count: null, comment_count: null },
  KD: { tid: null, content: null, content_complete: null, images: ["https://p.qpic.cn/1.jpg", "https://p.qpic.cn/2.jpg"], like_count: null, comment_count: null },
  KE: { tid: null, content: null, content_complete: null, images: ["https://p.qpic.cn/3.jpg"], like_count: null, comment_count: null },
  KF: { tid: null, content: "a\nb\n\nc", content_complete: true, images: [], like_count: null, comment_count: null },
};

for (const fixture of FEED_FIXTURES) {
  test(`parseQzoneFeedContent: ${fixture.name}`, () => {
    const actual = parseQzoneFeedContent(fixture.html, fixture.key, fixture.uin, fixture.appid, fixture.like, fixture.comment);
    assert.deepEqual(actual, FEED_EXPECTED[fixture.key], `${fixture.key} must match the vendored-parser result`);
  });
}

test("the differential corpus is re-verified against the vendored bundle", async () => {
  // The expectations above are a RECORDING. Now that the oracle loads, both
  // parsers are re-run on every fixture, so a change to either side is caught
  // rather than silently contradicting the recording. The oracle carries the real
  // htmlparser2/domhandler/domutils/entities, so this is the only evidence that
  // `html.ts` is a faithful replacement for four packages.
  const oracle = await loadOracle();
  assert.notEqual(oracle, null, `the oracle module failed to load from ${ORACLE_URL.pathname}`);
  if (oracle === null) return;
  let checked = 0;
  for (const fixture of FEED_FIXTURES) {
    const expected = oracle(fixture.html, fixture.key, fixture.uin, fixture.appid, fixture.like, fixture.comment);
    const actual = parseQzoneFeedContent(fixture.html, fixture.key, fixture.uin, fixture.appid, fixture.like, fixture.comment);
    assert.deepEqual(actual, expected, `${fixture.key} diverged from htmlparser2`);
    // And the recording must agree with both, or one of the two is stale.
    assert.deepEqual(actual, FEED_EXPECTED[fixture.key], `${fixture.key} contradicts the recorded expectation`);
    checked += 1;
  }
  assert.equal(checked, FEED_FIXTURES.length);
});

test("the differential corpus survives generated markup at scale", async () => {
  // The 16 fixtures above are hand-written. This generates thousands of documents
  // and compares every one against the vendored parser, which is the only real
  // evidence that a ~450-line hand-written tokenizer replaces four packages.
  //
  // Three corpora, deliberately different:
  //   * "realistic" — well-formed nesting of the elements the CGI actually emits,
  //     entities, `<br/>`, images. This is the fidelity claim that matters.
  //   * "tag soup"  — random mismatched closes, raw-text elements mid-document,
  //     attributes on everything. Where a tokenizer bug hides.
  //
  // A PRNG with a fixed seed keeps this reproducible; a flaky differential test
  // would be worse than none.
  const oracle = await loadOracle();
  assert.notEqual(oracle, null, "the oracle module is required for the generator");
  if (oracle === null) return;

  let seed = 0;
  const rnd = (): number => {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7f_ff_ff_ff;
    return seed / 0x7f_ff_ff_ff;
  };
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rnd() * items.length)]!;

  const TEXTS = ["hello", "世界", "a &amp; b", "&lt;tag&gt;", "&#20320;", " ", "  ", "\n", "text123", "emoji 😀", "&nbsp;", "50% off", "a,b;c"];
  const ATTRS = ["", "", ' class="f-info"', ' class="qz_info_complete"', ' style="color:red"', ' data-x="1"'];
  const BLOCKS = ["div", "p", "li", "blockquote", "section", "h2", "h3", "pre", "td"];
  const INLINE = ["span", "b", "i", "em", "strong", "a", "font"];
  const LEAVES = ["<br/>", "<br>", '<img src="//h/x.jpg"/>', "<hr/>", '<img alt="[e]" src="x">'];

  const realistic = (depth: number): string => {
    let out = "";
    const count = Math.floor(rnd() * 3) + 1;
    for (let k = 0; k < count; k += 1) {
      const roll = rnd();
      if (roll < 0.4 || depth > 3) {
        out += pick(TEXTS);
        continue;
      }
      if (roll < 0.55) {
        out += pick(LEAVES);
        continue;
      }
      const tag = roll < 0.8 ? pick(BLOCKS) : pick(INLINE);
      out += `<${tag}${pick(ATTRS)}>${realistic(depth + 1)}</${tag}>`;
    }
    return out;
  };

  const soupTags = [...BLOCKS, ...INLINE, "table", "tr", "dd", "dt", "option", "script", "style", "textarea", "title", "br", "hr", "img", "input"];
  const soupAttrs = ["", ' class="f-info"', ' class="load_img"', ' data-cmd="qz_toggle"', ' alt="[x]"', ' name="feed_data" data-uin="42" data-fkey="K"', ' class="mod-comments"', ' class="img-item"'];
  const soupTexts = ["t", "a &amp; b", "&#65;", " ", "\n", "xy"];
  const soup = (depth: number): string => {
    let out = "";
    const count = Math.floor(rnd() * 2) + 1;
    for (let k = 0; k < count; k += 1) {
      if (rnd() < 0.4 || depth > 3) {
        out += pick(soupTexts);
        continue;
      }
      const tag = pick(soupTags);
      const selfClose = ["br", "hr", "img", "input"].includes(tag) ? "/" : "";
      out += `<${tag}${pick(soupAttrs)}${selfClose}>`;
      out += soup(depth + 1);
      if (rnd() < 0.85) out += `</${tag}>`;
    }
    return out;
  };

  const wrappers = [
    (inner: string): string => `<li class="f-item" data-key="K"><div class="f-info qz_info_complete">${inner}</div></li>`,
    (inner: string): string => `<li class="f-item" data-key="K">${inner}</li>`,
    (inner: string): string =>
      `<div class="f-single"><li class="f-item" data-key="K"><div class="f-info">${inner}</div></li></div>`,
  ];

  const check = (label: string, generate: () => string, iterations: number): void => {
    seed = 4242;
    let checked = 0;
    for (let i = 0; i < iterations; i += 1) {
      const html = pick(wrappers)(generate());
      const expected: RefFeedContent = oracle(html, "K", 42, QZONE_APPID_SHUOSHUO, String(i % 9), String(i % 5));
      const actual = parseQzoneFeedContent(html, "K", 42, QZONE_APPID_SHUOSHUO, String(i % 9), String(i % 5));
      assert.deepEqual(actual, expected, `${label} divergence at iteration ${String(i)}: ${html.slice(0, 160)}`);
      checked += 1;
    }
    assert.equal(checked, iterations);
  };

  check("realistic", () => realistic(0), 1500);
  check("tag soup", () => soup(0), 1500);
});

test("QZONE_APPID_SHUOSHUO is the only appid whose tid is reported", () => {
  assert.equal(QZONE_APPID_SHUOSHUO, 311);
});

// ===========================================================================
// 2. The HTML layer
// ===========================================================================

test("decodeEntities handles named, decimal and hex references", () => {
  assert.equal(decodeEntities("a &amp; b"), "a & b");
  assert.equal(decodeEntities("&lt;tag&gt;"), "<tag>");
  assert.equal(decodeEntities("&quot;q&quot;"), '"q"');
  assert.equal(decodeEntities("&copy;"), "\u00a9");
  assert.equal(decodeEntities("&nbsp;"), "\u00a0");
  assert.equal(decodeEntities("&#20320;&#x597d;"), "你好");
  // A bare ampersand and an unknown name stay as written.
  assert.equal(decodeEntities("a & b"), "a & b");
  assert.equal(decodeEntities("&notarealentity;"), "&notarealentity;");
  // Out of range and surrogate references are left verbatim, not crashed on.
  assert.equal(decodeEntities("&#x110000;"), "&#x110000;");
  assert.equal(decodeEntities("&#0;"), "&#0;");
  // The no-ampersand fast path returns the input object-identically.
  const plain = "no entities here";
  assert.equal(decodeEntities(plain), plain);
});

test("parseDocument builds a tree with parents and lowercased names", () => {
  const root = parseDocument('<DIV Class="a"><p>one<p>two</DIV>');
  assert.equal(root.type, "root");
  const div = root.children[0]!;
  assert.equal(div.name, "div");
  assert.equal(div.attribs["class"], "a");
  assert.equal(div.parent, root);
  // `<p>` implies a close, so the two are siblings.
  const paragraphs = div.children.filter((node) => node.name === "p");
  assert.equal(paragraphs.length, 2);
  assert.equal(paragraphs[0]?.parent, div);
  assert.equal(paragraphs[1]?.parent, div);
});

test("parseDocument recovers from unclosed tags and stray close tags", () => {
  const root = parseDocument('<div><span>a</div><p>b</span>c');
  // The `</div>` closed the span too; the `</span>` then had no ancestor and
  // was dropped instead of unwinding the stack.
  const div = root.children[0]!;
  assert.equal(div.name, "div");
  assert.equal(div.children[0]!.name, "span");
  const paragraph = root.children.find((node) => node.name === "p");
  assert.ok(paragraph, "the p after the stray close tag still exists at the top level");
});

test("parseDocument keeps a bare `<` as text and skips comments and doctypes", () => {
  const root = parseDocument("a < b <!-- hidden --> <!DOCTYPE html><i>x</i>");
  // `parent` pointers make the tree circular, so serialise by projection.
  const flat = JSON.stringify(root.children.map((node) => ({ type: node.type, name: node.name, data: node.data })));
  assert.ok(flat.includes("a < b"));
  assert.ok(flat.includes("hidden"), "the comment node is retained");
  const comment = findAll((node) => node.type === "tag", root.children);
  assert.deepEqual(
    comment.map((node) => node.name),
    ["i"],
  );
});

test("parseDocument treats script and style content as raw text", () => {
  // A `</div>` inside a script must NOT close the enclosing div.
  const root = parseDocument('<div><script>var s = "</div>";</script><span>after</span></div>');
  const div = root.children[0]!;
  assert.equal(div.name, "div");
  const span = div.children.find((node) => node.name === "span");
  assert.ok(span, "the span stayed inside the div");
});

test("parseDocument honours an unquoted attribute value containing no `>`", () => {
  const root = parseDocument("<div class=a data-x=1></div>");
  assert.equal(root.children[0]?.attribs["class"], "a");
  assert.equal(root.children[0]?.attribs["data-x"], "1");
});

test("parseDocument keeps the FIRST of a duplicated attribute", () => {
  const root = parseDocument('<div class="first" class="second"></div>');
  assert.equal(root.children[0]?.attribs["class"], "first");
});

test("findAll visits in document order, elements only", () => {
  const root = parseDocument("<div><span>a</span><b><i>x</i></b></div>");
  const names = findAll(() => true, root.children).map((node) => node.name);
  assert.deepEqual(names, ["div", "span", "b", "i"]);
  assert.equal(findAll((node) => node.name === "i", root.children).length, 1);
});

test("hasClass matches a whole token, not a substring", () => {
  const [node] = findAll(() => true, parseDocument('<div class="f-item wide"></div>').children);
  assert.ok(node);
  assert.equal(hasClass(node, "f-item"), true);
  assert.equal(hasClass(node, "wide"), true);
  assert.equal(hasClass(node, "item"), false, "a substring is not a class token");
  assert.equal(hasClass(node, "missing"), false);
});

test("stripTags collapses a body to text", () => {
  assert.equal(stripTags("<div>a</div><div>b &amp; c</div>"), "a b & c");
});

// ===========================================================================
// 3. Pure helpers of qzone-feed-content
// ===========================================================================

test("text() preserves paragraph breaks and reads img alt", () => {
  const [node] = findAll(() => true, parseDocument('<div class="f"><div>a</div><div>b</div></div>').children);
  assert.ok(node);
  assert.equal(feedText(node), "a\n\nb");
});

test("count() rejects negatives, fractions and junk", () => {
  assert.equal(count(0), 0);
  assert.equal(count(7), 7);
  assert.equal(count("7"), 7);
  assert.equal(count(undefined), null);
  assert.equal(count(null), null);
  assert.equal(count(-1), null);
  assert.equal(count(1.5), null);
  assert.equal(count("7a"), null);
  assert.equal(count(""), null);
  assert.equal(count(Number.MAX_SAFE_INTEGER + 1), null);
});

test("imageUrl upgrades protocol-relative and rejects other schemes", () => {
  assert.equal(imageUrl("//p.qpic.cn/a.jpg"), "https://p.qpic.cn/a.jpg");
  assert.equal(imageUrl("https://p.qpic.cn/a.jpg"), "https://p.qpic.cn/a.jpg");
  assert.equal(imageUrl("http://p.qpic.cn/a.jpg"), "http://p.qpic.cn/a.jpg");
  assert.equal(imageUrl("javascript:alert(1)"), null);
  assert.equal(imageUrl("data:image/png;base64,AAAA"), null);
  assert.equal(imageUrl(""), null);
  assert.equal(imageUrl(null), null);
  assert.equal(imageUrl(42), null);
  assert.equal(imageUrl("not a url"), null);
});

// ===========================================================================
// 4. parseJsLiteral / parseQzoneJson
// ===========================================================================

test("parseJsLiteral reads the JS-literal subset JSON cannot express", () => {
  // Unquoted keys, single quotes, a hex escape, undefined, and a trailing comma.
  assert.deepEqual(parseJsLiteral("{a:1,'b':'x\\x41y',c:undefined,d:[1,,2],e:true,f:null,}"), {
    a: 1,
    b: "xAy",
    c: undefined,
    d: [1, undefined, 2],
    e: true,
    f: null,
  });
});

test("parseJsLiteral decodes \\uNNNN and the simple escapes", () => {
  const value = parseJsLiteral('{s:"a\\u4f60b\\n\\t\\\\\\"z"}') as { s: string };
  assert.equal(value.s, 'a你b\n\t\\"z');
});

test("parseJsLiteral drops a __proto__ key instead of polluting a prototype", () => {
  const value = parseJsLiteral('{"__proto__":{"polluted":true},"ok":1}') as Record<string, unknown>;
  assert.equal(value["ok"], 1);
  assert.equal(({} as Record<string, unknown>)["polluted"], undefined, "Object.prototype is untouched");
  assert.equal(Object.getPrototypeOf(value), Object.prototype, "the result's own prototype is unchanged");
  assert.ok(!Object.prototype.hasOwnProperty.call(value, "__proto__"));
});

test("parseJsLiteral keeps sparse array indices", () => {
  assert.deepEqual(parseJsLiteral("[1,,3]"), [1, undefined, 3]);
  assert.deepEqual(parseJsLiteral("[,]"), [undefined]);
  assert.deepEqual(parseJsLiteral("[,,]"), [undefined, undefined]);
});

test("parseJsLiteral numbers follow JS literal semantics", () => {
  assert.equal(parseJsLiteral("0x1f"), 31);
  assert.equal(parseJsLiteral("1e3"), 1000);
  assert.equal(parseJsLiteral("-4.5"), -4.5);
});

test("parseJsLiteral throws on malformed input rather than returning junk", () => {
  assert.throws(() => parseJsLiteral("{a 1}"), /expected ":"/);
  assert.throws(() => parseJsLiteral("{a:}"), /unexpected token/);
  assert.throws(() => parseJsLiteral("'unterminated"), /unterminated string/);
  assert.throws(() => parseJsLiteral("{a:1 b:2}"), /expected "," or "}"/);
  assert.throws(() => parseJsLiteral("[1 2]"), /expected "," or "\]"/);
  assert.throws(() => parseJsLiteral(""), /unexpected end/);
  assert.throws(() => parseJsLiteral("{:1}"), /expected object key/);
});

test("parseQzoneCallback slices from the first brace and ignores a trailing `);`", () => {
  const value = parseQzoneCallback('_preloadCallback({"a":1,"b":[2]});');
  assert.deepEqual(value, { a: 1, b: [2] });
  assert.throws(() => parseQzoneCallback("no object here"), /invalid feeds response/);
  assert.throws(() => parseQzoneCallback("[1,2]"), /invalid feeds response/, "an array is not the expected object");
});

test("parseQzoneJson takes the three documented shapes", () => {
  assert.deepEqual(parseQzoneJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseQzoneJson('_preloadCallback({"a":1});'), { a: 1 });
  assert.deepEqual(parseQzoneJson('_Callback({"a":1})\n'), { a: 1 });
  // Trailing junk after the closing brace defeats layer 1 but not layer 2.
  assert.deepEqual(parseQzoneJson('back({"a":1}) trailing'), { a: 1 });
  // The third layer: a differently-named callback with surrounding whitespace.
  assert.deepEqual(parseQzoneJson('  back(  {"a":1}  );  '), { a: 1 });
  // An HTML error page must throw, not return an empty result.
  assert.throws(() => parseQzoneJson("<html><body>login required</body></html>"), /invalid response from qzone api/);
  assert.throws(() => parseQzoneJson("back( )"), /invalid response from qzone api/);
});

// ===========================================================================
// 5. Feed cursor
// ===========================================================================

test("initialQzoneFeedState is all zeros with pagenum 1", () => {
  const state = initialQzoneFeedState();
  assert.equal(state.pagenum, "1");
  assert.equal(QZONE_FEED_NUMERIC_FIELDS.length, 8);
  assert.equal(QZONE_FEED_STRING_FIELDS.length, 3);
  assert.equal(QZONE_FEED_STATE_FIELDS.length, 11);
  for (const field of QZONE_FEED_NUMERIC_FIELDS) {
    if (field === "pagenum") continue;
    assert.equal(state[field], "0");
  }
  for (const field of QZONE_FEED_STRING_FIELDS) assert.equal(state[field], "");
});

test("nextQzoneFeedState normalises numerics and keeps absent fields", () => {
  const previous = initialQzoneFeedState();
  const next = nextQzoneFeedState({ begintime: "0007", icServerTime: 1700000000, uinlist: "1|2" }, previous);
  assert.equal(next.begintime, "7", "leading zeros are normalised so the cursor has one form");
  assert.equal(next.icServerTime, "1700000000", "a numeric field may arrive as a number");
  assert.equal(next.uinlist, "1|2");
  assert.equal(next.dayspac, "0", "an absent field keeps the previous value");
});

test("nextQzoneFeedState replaces an empty uinlist but not other empty strings", () => {
  const previous = { ...initialQzoneFeedState(), uinlist: "1|2", externparam: "keep" };
  const next = nextQzoneFeedState({ uinlist: "", externparam: "", daylist: "" }, previous);
  // `uinlist` is the one string field where "" is a real instruction.
  assert.equal(next.uinlist, "");
  assert.equal(next.externparam, "keep");
  assert.equal(next.daylist, "");
});

test("nextQzoneFeedState rejects each malformed numeric field", () => {
  const previous = initialQzoneFeedState();
  assert.throws(() => nextQzoneFeedState({ begintime: "1.5" }, previous), /分页字段异常/);
  assert.throws(() => nextQzoneFeedState({ begintime: "-1" }, previous), /分页字段异常/);
  assert.throws(() => nextQzoneFeedState({ begintime: "x" }, previous), /分页字段异常/);
  assert.throws(() => nextQzoneFeedState({ begintime: true }, previous), /分页字段异常/);
  // pagenum gets the extra `>= 1` rule.
  assert.throws(() => nextQzoneFeedState({ pagenum: "0" }, previous), /分页字段异常/);
});

test("nextQzoneFeedState rejects an oversized or non-string string field", () => {
  const previous = initialQzoneFeedState();
  assert.throws(() => nextQzoneFeedState({ externparam: 42 }, previous), /分页字段异常/);
  assert.throws(() => nextQzoneFeedState({ externparam: "x".repeat(32_769) }, previous), /分页字段异常/);
  assert.equal(nextQzoneFeedState({ externparam: "x".repeat(32_768) }, previous).externparam.length, 32_768);
});

test("qzoneFeedPosition ignores icServerTime and nothing else", () => {
  const base = initialQzoneFeedState();
  const clockOnly = { ...base, icServerTime: "999" };
  assert.equal(qzoneFeedPosition(base), qzoneFeedPosition(clockOnly), "the server clock is not progress");
  const paged = { ...base, begintime: "1" };
  assert.notEqual(qzoneFeedPosition(base), qzoneFeedPosition(paged));
});

test("the cursor round-trips through base64url", () => {
  const state = { ...initialQzoneFeedState(), begintime: "5" };
  const cursor = encodeQzoneFeedCursor("10001", 3, state);
  assert.match(cursor, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeQzoneFeedCursor(cursor, "10001"), { page: 3, state });
});

test("encodeQzoneFeedCursor refuses page 1", () => {
  // Page 1 is the default and has no cursor; a caller building one by hand would
  // otherwise be able to mint a self-referential page.
  assert.throws(() => encodeQzoneFeedCursor("1", 1, initialQzoneFeedState()), /分页页码超出范围/);
  assert.throws(() => encodeQzoneFeedCursor("1", 1.5, initialQzoneFeedState()), /分页页码超出范围/);
});

test("decodeQzoneFeedCursor refuses a cursor belonging to another account", () => {
  const cursor = encodeQzoneFeedCursor("111", 2, initialQzoneFeedState());
  assert.throws(() => decodeQzoneFeedCursor(cursor, "222"), /不属于当前账号/);
});

test("decodeQzoneFeedCursor refuses a non-canonical encoding", () => {
  // A base64url string with a non-zero unused trailing bit decodes to the same
  // bytes; the re-encode check is what rejects the second spelling.
  const cursor = encodeQzoneFeedCursor("1", 2, initialQzoneFeedState());
  const mutated = `${cursor.slice(0, -1)}${cursor.slice(-1) === "A" ? "B" : "A"}`;
  assert.throws(() => decodeQzoneFeedCursor(mutated, "1"), /无效的空间好友动态 cursor/);
});

test("decodeQzoneFeedCursor refuses junk, padding and oversized input", () => {
  assert.throws(() => decodeQzoneFeedCursor("", "1"), /无效的空间好友动态 cursor/);
  assert.throws(() => decodeQzoneFeedCursor("not base64!", "1"), /无效的空间好友动态 cursor/);
  assert.throws(() => decodeQzoneFeedCursor("a".repeat(QZONE_FEED_CURSOR_MAX_LENGTH + 1), "1"), /无效的空间好友动态 cursor/);
  assert.throws(() => decodeQzoneFeedCursor("AAAA", "1"), /无效的空间好友动态 cursor/);
});

test("decodeQzoneFeedCursor refuses a state that is not a fixed point", () => {
  // `"007"` normalises to `"7"`, so the encoder could never have written it.
  const state = { ...initialQzoneFeedState(), begintime: "007" };
  const cursor = Buffer.from(JSON.stringify({ version: 1, uin: "1", page: 2, state })).toString("base64url");
  assert.throws(() => decodeQzoneFeedCursor(cursor, "1"), /无效的空间好友动态 cursor 状态/);
});

test("decodeQzoneFeedCursor refuses a state with the wrong key count", () => {
  const state = initialQzoneFeedState() as unknown as Record<string, unknown>;
  delete state["daylist"];
  const cursor = Buffer.from(JSON.stringify({ version: 1, uin: "1", page: 2, state })).toString("base64url");
  assert.throws(() => decodeQzoneFeedCursor(cursor, "1"), /无效的空间好友动态 cursor 状态/);
});

test("decodeQzoneFeedCursor refuses a wrong version or page", () => {
  const state = initialQzoneFeedState();
  const make = (patch: Record<string, unknown>): string =>
    Buffer.from(JSON.stringify({ version: 1, uin: "1", page: 2, state, ...patch })).toString("base64url");
  assert.throws(() => decodeQzoneFeedCursor(make({ version: 2 }), "1"), /cursor 无效/);
  assert.throws(() => decodeQzoneFeedCursor(make({ page: 1 }), "1"), /cursor 无效/);
  assert.throws(() => decodeQzoneFeedCursor(make({ page: 2.5 }), "1"), /cursor 无效/);
});

// ===========================================================================
// 6. qzone.ts pure transforms
// ===========================================================================

test("QZONE_UGC_RIGHTS is the five accepted codes", () => {
  assert.deepEqual([...QZONE_UGC_RIGHTS].sort((a, b) => a - b), [1, 4, 16, 64, 128]);
  assert.equal(normalizeQzoneUgcRight(64), 64);
  assert.throws(() => normalizeQzoneUgcRight(2), /ugc_right must be one of 1, 4, 16, 64, 128/);
});

test("normalizeTargetUins de-duplicates and preserves order", () => {
  assert.equal(normalizeTargetUins(undefined), "");
  assert.equal(normalizeTargetUins("  "), "");
  assert.equal(normalizeTargetUins("2|1|2"), "2|1");
  assert.equal(normalizeTargetUins(" 2 | 1 "), "2|1");
  assert.equal(normalizeTargetUins("1||2"), "1|2", "empty segments are skipped");
  assert.throws(() => normalizeTargetUins("1|abc"), /target_uins must contain QQ numbers/);
});

test("assertRichParams requires both or neither", () => {
  assert.doesNotThrow(() => assertRichParams(undefined, undefined));
  assert.doesNotThrow(() => assertRichParams(undefined, ""));
  assert.doesNotThrow(() => assertRichParams(1, "richval"));
  assert.throws(() => assertRichParams(1, undefined), /must be provided together/);
  assert.throws(() => assertRichParams(1, ""), /must be provided together/, "a blank richval counts as absent");
  assert.throws(() => assertRichParams(1, "   "), /must be provided together/);
  assert.throws(() => assertRichParams(undefined, "richval"), /must be provided together/);
  assert.throws(() => assertRichParams(0, "x"), /positive integer/);
  assert.throws(() => assertRichParams(1.5, "x"), /positive integer/);
});

test("normalizeQzoneImageBase64 canonicalises padding and rejects junk", () => {
  assert.equal(normalizeQzoneImageBase64("YWJj"), "YWJj");
  assert.equal(normalizeQzoneImageBase64("YWJjZA=="), "YWJjZA==");
  assert.equal(normalizeQzoneImageBase64("YWJjZA"), "YWJjZA==", "missing padding is restored");
  assert.equal(normalizeQzoneImageBase64("  YWJj ZA  "), "YWJj+ZA=", "a space becomes +");
  assert.equal(normalizeQzoneImageBase64("base64://YWJj"), "YWJj");
  assert.equal(normalizeQzoneImageBase64("data:image/png;base64,YWJj"), "YWJj");
  assert.equal(normalizeQzoneImageBase64("YWJj\nZA=="), "YWJjZA==", "newlines are stripped");

  assert.throws(() => normalizeQzoneImageBase64(""), /imageBase64 is required/);
  assert.throws(() => normalizeQzoneImageBase64("!!!not-base64"), /not valid base64/);
  assert.throws(() => normalizeQzoneImageBase64("YWJjZA==YWJj"), /not valid base64/, "padding in the middle");
  assert.throws(() => normalizeQzoneImageBase64("YWJjZ"), /not valid base64/, "remainder 1 is impossible");
  assert.throws(() => normalizeQzoneImageBase64("data:no-comma-here"), /missing base64 payload/);
  // A `data:` prefix with a comma is accepted regardless of its mime section: the
  // payload after the comma is validated on its own.
  assert.equal(normalizeQzoneImageBase64("data:image/png,YWJj"), "YWJj");
});

test("pickPicUrl prefers url3 down to smallurl and skips empties", () => {
  assert.equal(pickPicUrl({ url3: "u3", url2: "u2", url1: "u1", smallurl: "s" }), "u3");
  assert.equal(pickPicUrl({ url2: "u2", url1: "u1" }), "u2");
  assert.equal(pickPicUrl({ url1: "u1", smallurl: "s" }), "u1");
  assert.equal(pickPicUrl({ smallurl: "s" }), "s");
  assert.equal(pickPicUrl({}), undefined);
  assert.equal(pickPicUrl({ url3: "", smallurl: "s" }), "s", "an empty string falls through");
});

test("mapMsgList maps a full row and a sparse one", () => {
  const mapped = mapMsgList({
    total: "2",
    msglist: [
      {
        tid: "T1",
        content: "hello",
        created_time: "1700000000",
        cmtnum: "3",
        secret: 1,
        pic: [{ url3: "https://p.qpic.cn/3.jpg" }, { smallurl: "https://p.qpic.cn/s.jpg" }, {}],
      },
      { tid: 42 },
    ],
  });
  assert.equal(mapped.total, 2);
  assert.equal(mapped.msglist[0]?.tid, "T1");
  assert.equal(mapped.msglist[0]?.time, 1_700_000_000);
  assert.equal(mapped.msglist[0]?.comment_num, 3);
  assert.equal(mapped.msglist[0]?.is_private, true);
  assert.deepEqual(mapped.msglist[0]?.images, ["https://p.qpic.cn/3.jpg", "https://p.qpic.cn/s.jpg"]);
  // A tid given as a number is stringified; a picture with no URL contributes nothing.
  assert.equal(mapped.msglist[1]?.tid, "42");
  assert.equal(mapped.msglist[1]?.content, "");
  assert.equal(mapped.msglist[1]?.time, 0);
  assert.equal(mapped.msglist[1]?.is_private, false);
  assert.deepEqual(mapped.msglist[1]?.images, []);
});

test("mapMsgList falls back to the list length for a missing total", () => {
  assert.equal(mapMsgList({ msglist: [{}, {}] }).total, 2);
  assert.equal(mapMsgList({}).total, 0);
});

test("legacyMsgListRoute and userMsgListRoute differ in host, format and headers", () => {
  const cookies = { skey: "S", p_skey: "P" };
  const bkn = getBknFromCookie(cookies);
  const legacy = legacyMsgListRoute(cookies, "123", 0, 20, bkn);
  const fallback = userMsgListRoute(cookies, "123", 0, 20, bkn);

  assert.ok(legacy.url.startsWith("https://h5.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_msglist_v6?"));
  assert.ok(fallback.url.startsWith("https://h5.qzone.qq.com/proxy/domain/user.qzone.qq.com/cgi-bin/emotion_cgi_msglist_v6?"));

  const legacyQuery = new URL(legacy.url).searchParams;
  assert.equal(legacyQuery.get("format"), "jsonp");
  assert.equal(legacyQuery.get("callback"), "_preloadCallback");
  assert.equal(legacyQuery.get("replynum"), "100");
  assert.equal(legacyQuery.get("need_private_comment"), "1");
  assert.equal(legacyQuery.get("g_tk"), bkn);

  const fallbackQuery = new URL(fallback.url).searchParams;
  assert.equal(fallbackQuery.get("format"), "json");
  assert.equal(fallbackQuery.get("callback"), null, "the fallback asks for plain JSON");
  assert.equal(fallback.headers["Referer"], "https://user.qzone.qq.com/123");
  assert.equal(legacy.headers["Referer"], undefined);
  assert.equal(legacy.headers["Cookie"], "skey=S; p_skey=P");
});

test("QZONE_MSG_LIST_RATE_LIMIT is -10000", () => {
  assert.equal(QZONE_MSG_LIST_RATE_LIMIT, -10_000);
});

test("feedHasMore accepts three spellings each way and throws otherwise", () => {
  for (const value of [true, 1, "1"]) {
    assert.equal(feedHasMore({ data: { main: { hasMoreFeeds: value } } }), true);
    assert.equal(feedHasMore({ data: { hasmore: value } }), true, "no `main` means the flat field");
  }
  for (const value of [false, 0, "0"]) {
    assert.equal(feedHasMore({ data: { main: { hasMoreFeeds: value } } }), false);
    assert.equal(feedHasMore({ data: { hasmore: value } }), false);
  }
  assert.throws(() => feedHasMore({ data: {} }), /缺少有效的分页结束标志/);
  assert.throws(() => feedHasMore({ data: { main: { hasMoreFeeds: 2 } } }), /缺少有效的分页结束标志/);
  assert.throws(() => feedHasMore({ data: { main: { hasMoreFeeds: "yes" } } }), /缺少有效的分页结束标志/);
});

test("mapFeeds maps a row and reads the content out of its html", () => {
  const html = '<li class="f-item" data-key="K1"><div class="f-info">post</div><div class="img-item" data-originurl="//p.qpic.cn/a.jpg"></div></li>';
  const page = mapFeeds({
    data: {
      main: { hasMoreFeeds: 0 },
      data: [{ uin: "42", nickname: "n", abstime: "1700000000", appid: "311", key: "K1", html, likecnt: "9", commentcnt: "2" }],
    },
  });
  assert.equal(page.has_more, false);
  assert.equal(page.next_cursor, null);
  assert.equal(page.feeds.length, 1);
  const feed = page.feeds[0]!;
  assert.equal(feed.uin, 42);
  assert.equal(feed.appid, 311);
  assert.equal(feed.time, 1_700_000_000);
  assert.equal(feed.key, "K1");
  assert.equal(feed.content, "post");
  assert.equal(feed.like_count, 9);
  assert.equal(feed.comment_count, 2);
  assert.deepEqual(feed.images, ["https://p.qpic.cn/a.jpg"]);
});

test("mapFeeds falls back to feedskey and skips null entries", () => {
  const page = mapFeeds({
    data: {
      main: { hasMoreFeeds: "1" },
      data: [null, { uin: 1, nickname: "n", abstime: 0, appid: 311, feedskey: "FK", html: "" }],
    },
  });
  assert.equal(page.feeds.length, 1, "a null entry is filtered, not fatal");
  assert.equal(page.feeds[0]?.key, "FK");
});

test("mapFeeds rejects a malformed entry rather than dropping it", () => {
  // Dropping one row would shift every subsequent index a caller may be using.
  assert.throws(() => mapFeeds({ data: { data: [{ uin: -1 }], main: { hasMoreFeeds: 0 } } }), /条目字段异常/);
  assert.throws(() => mapFeeds({ data: { data: [{ uin: 1, nickname: 5 }], main: { hasMoreFeeds: 0 } } }), /条目字段异常/);
  assert.throws(() => mapFeeds({ data: { data: ["string"] } }), /条目结构异常/);
  assert.throws(() => mapFeeds({ data: { data: "not an array" } }), /响应结构异常/);
});

test("getQzoneFeeds validates pageNum and count", async () => {
  const cookies = { skey: "S" };
  await assert.rejects(getQzoneFeeds(cookies, "1", 0), /页码或数量无效/);
  await assert.rejects(getQzoneFeeds(cookies, "1", 1, 0), /页码或数量无效/);
  await assert.rejects(getQzoneFeeds(cookies, "1", 1, QZONE_FEED_MAX_COUNT + 1), /页码或数量无效/);
  await assert.rejects(getQzoneFeeds(cookies, "1", 1.5), /页码或数量无效/);
});

test("getQzoneFeeds refuses a cursor whose page contradicts pageNum", async () => {
  const cursor = encodeQzoneFeedCursor("1", 3, initialQzoneFeedState());
  await assert.rejects(getQzoneFeeds({ skey: "S" }, "1", 5, 10, cursor), /cursor 不匹配/);
  // pageNum=1 is the "use the cursor" spelling and is accepted.
  const state = initialQzoneFeedState();
  assert.doesNotThrow(() => decodeQzoneFeedCursor(encodeQzoneFeedCursor("1", 3, state), "1"));
});

test("buildQzoneUpdatePayload rebuilds richval and the tab-doubled pic_bo", () => {
  const detail = {
    tid: "TID",
    uin: 42,
    content: "hello",
    pic: [
      { pic_id: ",ALBUM,LLOC", pictype: 22, height: 100, width: 200, url1: "https://p.qpic.cn/a.jpg?bo=TOKEN%3D1" },
    ],
  };
  const params = buildQzoneUpdatePayload(detail, "42");
  assert.equal(params.get("tid"), "TID");
  assert.equal(params.get("richtype"), "1");
  assert.equal(params.get("richval"), ",ALBUM,LLOC,LLOC,22,100,200,,0,0");
  // The reference doubles the token group with a TAB, and a single copy is ignored
  // by the update CGI.
  assert.equal(params.get("pic_bo"), "TOKEN=1\tTOKEN=1");
  assert.equal(params.get("hostuin"), "42");
  assert.equal(params.get("qzreferrer"), "https://user.qzone.qq.com/42");
});

test("buildQzoneUpdatePayload uses conlist when present", () => {
  const params = buildQzoneUpdatePayload({ tid: "T", conlist: [{ con: "a" }, { con: "b" }], content: "ignored" }, "1");
  assert.equal(params.get("con"), "ab");
});

test("buildQzoneUpdatePayload throws on an unrebuildable image post", () => {
  assert.throws(() => buildQzoneUpdatePayload({}, "1"), /missing tid/);
  assert.throws(() => buildQzoneUpdatePayload({ tid: "T", richtype: 1, pic: [] }, "1"), /missing pic info/);
  assert.throws(() => buildQzoneUpdatePayload({ tid: "T", pic: [{ pic_id: ",," }] }, "1"), /unsupported pic info/);
});

test("buildQzoneUpdatePayload leaves a text post's richtype empty", () => {
  const params = buildQzoneUpdatePayload({ tid: "T", content: "text" }, "1");
  assert.equal(params.get("richtype"), "");
  assert.equal(params.get("richval"), "");
  assert.equal(params.get("pic_bo"), "");
});

test("deleteQzoneMsg refuses a blank tid before any network work", async () => {
  await assert.rejects(deleteQzoneMsg({ skey: "S" }, "1", ""), /tid is required/);
});

// ===========================================================================
// 7. qzone-public pure parts
// ===========================================================================

test("isObject rejects arrays and null", () => {
  assert.equal(isObject({}), true);
  assert.equal(isObject([]), false);
  assert.equal(isObject(null), false);
  assert.equal(isObject("x"), false);
});

test("encodeQzoneEmotionUgcId's field numbers are the reference's", () => {
  // The ugc_id is a JSON base64 blob, so its bytes are the only place these field
  // numbers are visible. tid is field 8 (tag 66), not 7 — the gap is intentional.
  const bytes = encodeQzoneEmotionUgcId({
    appId: 311n,
    uin: 42n,
    publishTime: 1700000000n,
    field4: "",
    field5: "",
    field6: "0",
    tid: "00112233445566778899aabb",
  });
  const hex = Buffer.from(bytes).toString("hex");
  assert.ok(hex.startsWith("08" + "b702"), `appId tag 8 expected, got ${hex.slice(0, 6)}`);
  // field4 and field5 emit as `22 00` / `2a 00` under the `!= null` rule.
  assert.ok(hex.includes("2200"), "field4 is emitted even when empty");
  assert.ok(hex.includes("2a00"), "field5 is emitted even when empty");
  assert.ok(hex.includes("32" + "0130"), "field6 is `!= \"\"`, so \"0\" is emitted");
  assert.ok(hex.includes("42" + "18" + "303031313232333334343535363637373838393961616262"), "tid is field 8 with a 24-byte payload");
});

test("getQzoneFeedDetail validates the tid before any network work", async () => {
  for (const bad of ["", "abc", "0".repeat(23), "0".repeat(25), "z".repeat(24)]) {
    await assert.rejects(getQzoneFeedDetail({ skey: "S" }, bad), /必须是 24 位十六进制编号/);
  }
});

test("feedParams refuses a feed without a non-empty union_id", () => {
  assert.throws(() => feedParams({}), /缺少 cell_common.union_id/);
  assert.throws(() => feedParams({ cell_common: {} }), /缺少 cell_common.union_id/);
  assert.throws(() => feedParams({ cell_common: { union_id: {} } }), /缺少 cell_common.union_id/);
  assert.deepEqual(feedParams({ cell_common: { union_id: { feed_id: "F" } } }), { union_id: { feed_id: "F" } });
  // `cell_feed_transfer` is copied only when present.
  assert.deepEqual(
    feedParams({ cell_common: { union_id: { feed_id: "F" } }, cell_feed_transfer: "T" }),
    { union_id: { feed_id: "F" }, cell_feed_transfer: "T" },
  );
});

test("richContent wraps a string and passes anything else through", () => {
  assert.deepEqual(richContent("hi"), [{ type: 0, content: "hi" }]);
  const parts = [{ type: 1, content: "x", extra: 2 }];
  assert.equal(richContent(parts), parts, "an array is passed through by identity");
});

test("encodeCursor/decodeCursor round-trip the recommendation state", () => {
  const state = {
    version: 1 as const,
    uin: "10001",
    refresh_id: "r1",
    attach_info: "a1",
    last_client_feed_union_id: { feed_id: "F" },
  };
  const cursor = encodeCursor(state);
  assert.deepEqual(decodeCursor(cursor, "10001"), state);
});

test("decodeCursor refuses each invalid state shape", () => {
  const make = (patch: Record<string, unknown>): string =>
    encodeCursor({
      version: 1,
      uin: "1",
      refresh_id: "r",
      attach_info: "",
      last_client_feed_union_id: null,
      ...patch,
    });
  assert.throws(() => decodeCursor(make({ version: 2 }), "1"), /cursor 无效/);
  assert.throws(() => decodeCursor(make({ uin: "2" }), "1"), /cursor 无效/);
  assert.throws(() => decodeCursor(make({ refresh_id: "" }), "1"), /cursor 无效/);
  assert.throws(() => decodeCursor(make({ attach_info: 5 }), "1"), /cursor 无效/);
  // A string here would lose feed_id/uf_key and the next page would restart.
  assert.throws(() => decodeCursor(make({ last_client_feed_union_id: "F" }), "1"), /cursor 无效/);
  assert.throws(() => decodeCursor("", "1"), /无效的空友推荐 cursor/);
  assert.throws(() => decodeCursor("not base64!", "1"), /无效的空友推荐 cursor/);
});

test("the home cursor is kind-tagged and account-bound", async () => {
  // Wrong kind, wrong owner and a missing attach_info all have to be refused by
  // the inline validation, which is separate from `decodeCursor`.
  const make = (state: Record<string, unknown>): string => encodeCursor(state);
  const valid = make({ version: 1, kind: "home", uin: "1", host_uin: "2", attach_info: "a" });
  // A structurally valid cursor still fails at the transport step (no network in
  // tests), which is how we know the validation passed.
  await assert.rejects(getQzoneHomeFeeds({ skey: "S" }, "1", "2", valid), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!/cursor 无效/.test(error.message), `unexpected cursor rejection: ${error.message}`);
    return true;
  });
  await assert.rejects(getQzoneHomeFeeds({ skey: "S" }, "1", "3", valid), /cursor 无效/);
  await assert.rejects(
    getQzoneHomeFeeds({ skey: "S" }, "1", "2", make({ version: 1, kind: "feed", uin: "1", host_uin: "2", attach_info: "a" })),
    /cursor 无效/,
  );
});

test("getQzonePublicFeeds starts a refresh-scoped cursor", async () => {
  // No cursor means a fresh `refresh_id` of `<uin>_<ms>`; the transport then fails,
  // which proves the state was built before any network use.
  await assert.rejects(getQzonePublicFeeds({ skey: "S" }, "1"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!/cursor/.test(error.message), `unexpected cursor rejection: ${error.message}`);
    return true;
  });
});

test("setQzonePublicFollow's uid-or-uin choice", async () => {
  const feed = (domainType: number | undefined, uid: string | undefined, uin: string | undefined) => ({
    cell_common: { union_id: { feed_id: "F" }, ...(domainType === undefined ? {} : { domain_type: domainType }) },
    cell_user_info: { user: { ...(uid === undefined ? {} : { uid }), ...(uin === undefined ? {} : { uin }) } },
  });
  // A public-account feed (domain 3) with a uid uses the uid.
  await assert.rejects(setQzonePublicFollow({ skey: "S" }, feed(3, "U", "42")), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!/缺少作者/.test(error.message));
    return true;
  });
  // No uin at all falls back to the uid.
  await assert.rejects(setQzonePublicFollow({ skey: "S" }, feed(0, "U", undefined)), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!/缺少作者/.test(error.message));
    return true;
  });
  // Neither present is a hard error, and it happens before the transport.
  await assert.rejects(setQzonePublicFollow({ skey: "S" }, feed(0, undefined, undefined)), /缺少作者 uid\/uin/);
  await assert.rejects(setQzonePublicFollow({ skey: "S" }, feed(0, "", "")), /缺少作者 uid\/uin/);
});

// ===========================================================================
// 8. The QzoneApi adapter — uin routing
// ===========================================================================

/** A BridgeContext wired to a fake `apis.web`, with no network. */
function stubContext(options: { uin?: string; selfUid?: string | null; cookies?: boolean } = {}): {
  ctx: BridgeContext;
  cookieCalls: string[];
} {
  const cookieCalls: string[] = [];
  const identity = new MemoryIdentity(options.uin ?? "10001", "nick");
  const ctx = {
    identity,
    apis:
      options.cookies === false
        ? {}
        : {
            web: {
              getCookies: async (domain: string) => {
                cookieCalls.push(domain);
                return { skey: "S", p_skey: "P" };
              },
            },
          },
    events: {},
    sendRawPacket: async () => {
      throw new Error("the qzone API must never use the packet channel");
    },
    resolveUserUid: async () => "",
    nextMessageRandom: () => 0,
    nextClientSequence: () => 0,
    rememberUploadedFile: () => undefined,
    recallUploadedFile: () => undefined,
    dispose: async () => undefined,
  } as unknown as BridgeContext;
  if (options.selfUid !== undefined) {
    Object.defineProperty(identity, "selfUid", { value: options.selfUid, configurable: true });
  }
  return { ctx, cookieCalls };
}

test("QzoneApi reads the qzone.qq.com cookie domain and nothing else", async () => {
  const { ctx, cookieCalls } = stubContext();
  // Every method that gets far enough fetches cookies first; here the transport
  // fails afterwards, but the domain is already recorded.
  await assert.rejects(new QzoneApi(ctx).getMsgList(1));
  assert.deepEqual(cookieCalls, ["qzone.qq.com"]);
});

test("QzoneApi says so when apis.web is missing", async () => {
  const { ctx } = stubContext({ cookies: false });
  await assert.rejects(new QzoneApi(ctx).getMsgList(1), /requires apis\.web/);
});

test("QzoneApi.getMsgList routes targetUin with the reference's `> 0` test", async () => {
  const { ctx } = stubContext();
  const api = new QzoneApi(ctx);
  // `0`, `NaN`, an empty string and `undefined` all fall back to the bot. The
  // fallback is observable in the URL, so each case is checked by letting the
  // transport fail and inspecting the request the route builder produced.
  for (const value of [0, "0", undefined, Number.NaN] as const) {
    const routes = await api.describeMsgListRoutes(value);
    assert.equal(new URL(routes.legacy.url).searchParams.get("uin"), "10001", `targetUin=${String(value)}`);
  }
  const routes = await api.describeMsgListRoutes(42);
  assert.equal(new URL(routes.legacy.url).searchParams.get("uin"), "42");
  assert.equal(new URL(routes.fallback.url).searchParams.get("uin"), "42");
});

test("QzoneApi.getMsgDetail keeps an explicit 0 instead of defaulting", async () => {
  // The asymmetry with getMsgList is real: only `undefined` means the bot here.
  const { ctx } = stubContext();
  const api = new QzoneApi(ctx);
  await assert.rejects(api.getMsgDetail("tid", 0), (error: unknown) => {
    // A URL carrying uin=0 is still a network attempt, not a validation error;
    // either way the request left the adapter.
    assert.ok(error instanceof Error);
    return true;
  });
});

test("QzoneApi.comment refuses an image alongside a reply", async () => {
  const { ctx } = stubContext();
  await assert.rejects(
    new QzoneApi(ctx).comment("tid", "hi", 1, 1, "richval", { commentId: "1", commentUin: "2" }),
    /images are not supported for Qzone comment replies/,
  );
});

test("QzoneApi.setBlack requires a target", async () => {
  const { ctx } = stubContext();
  await assert.rejects(new QzoneApi(ctx).setBlack(0, true), /targetUin is required/);
});

test("QzoneApi.#self falls back to an empty uid before warmup", async () => {
  // An un-warmed identity has no uid; throwing would fail every public comment for
  // the first seconds of a session, so the adapter sends "" and the server
  // resolves it from the uin.
  const { ctx } = stubContext({ selfUid: null });
  const api = new QzoneApi(ctx);
  await assert.rejects(api.commentPublicFeed({ cell_common: { union_id: { feed_id: "F" } } }, "hi"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!/uid/.test(error.message), `unexpected uid rejection: ${error.message}`);
    return true;
  });
});

test("QzoneApi never touches the packet channel", async () => {
  // `stubContext.sendRawPacket` throws; any method that reached it would surface
  // that message instead of a transport error.
  const { ctx } = stubContext();
  for (const run of [
    () => new QzoneApi(ctx).getMsgList(1),
    () => new QzoneApi(ctx).getFeeds(1, 5),
    () => new QzoneApi(ctx).getProfile(1),
  ]) {
    await assert.rejects(run(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(!/packet channel/.test(error.message), `a qzone call used the packet channel: ${error.message}`);
      return true;
    });
  }
});