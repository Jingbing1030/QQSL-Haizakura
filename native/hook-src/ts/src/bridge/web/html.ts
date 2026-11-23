// A small, tree-building HTML parser — the stand-in for htmlparser2/domhandler/domutils.
//
// ---------------------------------------------------------------------------
// Why this exists instead of a dependency
// ---------------------------------------------------------------------------
// The reference's `parseQzoneFeedContent` reads QQ Zone's feed HTML with
// `htmlparser2@10` → `domhandler@5` → `domutils@3` → `entities@6`, four packages
// that `ts/package.json` does not have and that this package has no runtime
// dependencies to host. The choice was: add four dependencies, vendor 2,090 lines
// of their bundled output, or write the subset the one consumer actually uses.
//
// The third option wins here because the surface is small and STATIC: the
// consumer reads `.name`, `.attribs`, `.children`, `.parent`, `.type` and
// `.data`, and calls one traversal (`findAll`). No CSS selectors, no streaming,
// no encoding detection, no foreign content (SVG/MathML), no `noscript`
// special-casing. What it DOES need to match exactly is the *lenient* recovery
// htmlparser2 applies to the real payload — unclosed `<p>`, stray `</div>`,
// attribute values without quotes — because a stricter parser would build a
// different tree and change which node `parseQzoneFeedContent` picks.
//
// Fidelity was checked by differential test against the vendored bundle
// (`work/bridge-parts/ref/qzone-feed-content.mjs`), which carries all four
// packages: `test/bridge-qzone.test.ts` runs both parsers over the same
// fixtures and compares the extracted content, images and tid. That is the
// real acceptance bar — the tree only has to be right where it is read.
//
// ---------------------------------------------------------------------------
// What is deliberately NOT implemented
// ---------------------------------------------------------------------------
// * Entity decoding beyond the basic named set plus numeric references. The
//   feed HTML uses `&nbsp;`, `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;` and
//   decimal/hex references; the full HTML5 table is 2,231 entries and none of
//   the rest appear in a QQ Zone feed.
// * `<template>`, `<noscript>`, CDATA, foreign content, and the "adoption
//   agency" algorithm for misnested formatting tags. QQ Zone emits none of them.
// * Implied `<tbody>`. htmlparser2 does not insert it either (that is a browser
//   behaviour, not a parser one), so omitting it matches.
//
// Reference modules replaced: `htmlparser2@10` (Tokenizer/Parser/index),
// `domhandler@5`, `domutils@3` (querying), `entities@6` (decode) —
// reference/index.mjs:330535–330596 and 335470–335541.

/**
 * A DOM node: an element (`"tag"`), text (`"text"`), a comment (`"comment"`), a
 * doctype/PI (`"directive"`), or the document root.
 *
 * `directive` exists because domhandler keeps `<！DOCTYPE html>` as a node carrying
 * `!DOCTYPE html`, and dropping it entirely would lose text that `stripTags`
 * should have seen.
 */
export interface HtmlNode {
  type: "tag" | "script" | "style" | "text" | "comment" | "directive" | "root";
  /** Tag name, lowercased. Empty for non-element nodes. */
  name: string;
  /** Attribute map. Names lowercased, values entity-decoded. */
  attribs: Record<string, string>;
  children: HtmlNode[];
  parent: HtmlNode | null;
  /** Text content for `type: "text"`. */
  data: string;
}

function createNode(type: HtmlNode["type"], name = ""): HtmlNode {
  return { type, name, attribs: {}, children: [], parent: null, data: "" };
}

function appendChild(parent: HtmlNode, child: HtmlNode): void {
  child.parent = parent;
  parent.children.push(child);
}

/**
 * `domhandler`'s `isTag` — which is deliberately NOT `type === "tag"`:
 *
 *     elem.type === ElementType.Tag || elem.type === ElementType.Script ||
 *     elem.type === ElementType.Style
 *
 * `script` and `style` are their own node types in domhandler but still answer
 * `isTag`, so a query sees them. The reference's own text walker tests
 * `next.type === "tag"` directly and therefore does NOT descend into them — which
 * is exactly why `<script>` content never reaches extracted feed text. Both rules
 * are reproduced here, separately, because conflating them changes the output.
 */
export function isTag(node: HtmlNode): boolean {
  return node.type === "tag" || node.type === "script" || node.type === "style";
}

/** `domhandler`'s `hasChildren`. */
export function hasChildren(node: HtmlNode): boolean {
  return node.children.length > 0;
}

/**
 * `domutils.findAll` — pre-order, elements only, iterative.
 *
 * Copied rather than reimplemented because the ORDER is load-bearing:
 * `parseQzoneFeedContent` takes `.find(...)` over the result, so a depth-first
 * order that differed from domutils' would select a different `f-item` when a
 * feed nests one. The stack-of-stacks shape below is domutils' own.
 */
export function findAll(test: (node: HtmlNode) => boolean, nodes: readonly HtmlNode[]): HtmlNode[] {
  const result: HtmlNode[] = [];
  const nodeStack: HtmlNode[][] = [nodes as HtmlNode[]];
  const indexStack: number[] = [0];
  for (;;) {
    const top = indexStack[0]!;
    const frame = nodeStack[0]!;
    if (top >= frame.length) {
      if (nodeStack.length === 1) return result;
      nodeStack.shift();
      indexStack.shift();
      continue;
    }
    const element = frame[top]!;
    indexStack[0] = top + 1;
    if (isTag(element) && test(element)) result.push(element);
    if (hasChildren(element) && element.children.length > 0) {
      indexStack.unshift(0);
      nodeStack.unshift(element.children);
    }
  }
}

// ===========================================================================
// Entities
// ===========================================================================

/**
 * The named entities QQ Zone actually emits, plus the XML five.
 *
 * U+00A0 for `nbsp` is the one that matters: `parseQzoneFeedContent`'s
 * `text()` collapses `\s+` to a single space, and JS `\s` DOES match U+00A0, so
 * decoding it (rather than leaving the literal `&nbsp;`) is what makes the
 * whitespace collapse behave.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  ensp: "\u2002",
  emsp: "\u2003",
  thinsp: "\u2009",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  hellip: "\u2026",
  mdash: "\u2014",
  ndash: "\u2013",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  middot: "\u00b7",
  times: "\u00d7",
  divide: "\u00f7",
  deg: "\u00b0",
  plusmn: "\u00b1",
  frac12: "\u00bd",
  sup2: "\u00b2",
  sup3: "\u00b3",
  micro: "\u00b5",
  para: "\u00b6",
  sect: "\u00a7",
  laquo: "\u00ab",
  raquo: "\u00bb",
  bull: "\u2022",
  star: "\u2606",
  hearts: "\u2665",
  larr: "\u2190",
  rarr: "\u2192",
  uarr: "\u2191",
  darr: "\u2193",
  harr: "\u2194",
  minus: "\u2212",
  le: "\u2264",
  ge: "\u2265",
  ne: "\u2260",
  infin: "\u221e",
  radic: "\u221a",
  asymp: "\u2248",
  equiv: "\u2261",
  sum: "\u2211",
  prod: "\u220f",
  part: "\u2202",
  int: "\u222b",
  there4: "\u2234",
  sim: "\u223c",
  cong: "\u2245",
  alpha: "\u03b1",
  beta: "\u03b2",
  gamma: "\u03b3",
  delta: "\u03b4",
  epsilon: "\u03b5",
  lambda: "\u03bb",
  mu: "\u03bc",
  pi: "\u03c0",
  sigma: "\u03c3",
  omega: "\u03c9",
};

/**
 * Decode HTML character references.
 *
 * Numeric references go through `String.fromCodePoint`, which THROWS on a
 * surrogate or an out-of-range value; an HTML5 parser would instead substitute
 * U+FFFD. A malformed reference in remote HTML must not crash a request, so the
 * throw is caught and the reference is left verbatim — matching what the
 * browser-visible text would look like for the one case that is unreachable in
 * practice.
 */
export function decodeEntities(input: string): string {
  if (!input.includes("&")) return input;
  return input.replace(/&(#[Xx][0-9A-Fa-f]+|#\d+|[A-Za-z][A-Za-z0-9]*);?/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = NAMED_ENTITIES[body];
    // A bare `&xyz;` that is not in the table stays as written, like htmlparser2
    // in its default (non-`decodeEntities: false`) mode for an unknown name.
    return named === undefined ? whole : named;
  });
}

// ===========================================================================
// Parsing
// ===========================================================================

/** Elements that never take a closing tag. */
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "basefont",
  "br",
  "col",
  "command",
  "embed",
  "frame",
  "hr",
  "img",
  "input",
  "isindex",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * Elements whose content is raw text: no tags are recognised until the matching
 * close tag.
 *
 * `script`/`style` matter for correctness — a `</div>` inside a string in a
 * script would otherwise close the enclosing div and shift every subsequent
 * node. `textarea`/`title` also decode entities; the pair below do not.
 */
const RAW_TEXT_ELEMENTS = new Set(["script", "style"]);
const ESCAPABLE_RAW_TEXT_ELEMENTS = new Set(["textarea", "title"]);

/**
 * The subset of `ESCAPABLE_RAW_TEXT_ELEMENTS` that decodes entities.
 *
 * `title` only. `textarea` uses the same tokenizer state but does not start an
 * entity decoder, so its content is completely literal.
 */
const ENTITY_DECODING_RAW_TEXT = new Set(["title"]);

/**
 * `openImpliesClose` — htmlparser2's table of start tags that implicitly close
 * an open ancestor.
 *
 * Transcribed VERBATIM from the vendored `Parser.js`
 * (reference/index.mjs:334598). Read as: when the key starts, the nearest open
 * element is closed while its name is in the value set.
 *
 * The table looks redundant and is not. `pTag` is `{"p"}` only — so a `<div>`
 * closes an open `<p>` but a `<p>` does NOT close an open `<div>`, which is why
 * `text()` emits one newline between `<p>a<p>b` paragraphs but two between
 * `<div>` blocks that each contain a `<p>`. Getting this table "tidier" than the
 * source changes the whitespace of every multi-paragraph post.
 *
 * `formTags`/`tableSectionTags`/`ddtTags`/`rtpTags` are the shared sets the
 * table reuses; they are inlined here because each is referenced from several
 * keys and a mistyped copy is the easy mistake.
 */
const FORM_TAGS: readonly string[] = ["input", "option", "optgroup", "select", "button", "datalist", "textarea"];
const TABLE_SECTION_TAGS: readonly string[] = ["thead", "tbody"];
const DDT_TAGS: readonly string[] = ["dd", "dt"];
const RTP_TAGS: readonly string[] = ["rt", "rp"];
const P_TAG: readonly string[] = ["p"];

const OPEN_IMPLIES_CLOSE: Record<string, readonly string[]> = {
  tr: ["tr", "th", "td"],
  th: ["th"],
  td: ["thead", "th", "td"],
  body: ["head", "link", "script"],
  li: ["li"],
  p: P_TAG,
  h1: P_TAG,
  h2: P_TAG,
  h3: P_TAG,
  h4: P_TAG,
  h5: P_TAG,
  h6: P_TAG,
  select: FORM_TAGS,
  input: FORM_TAGS,
  output: FORM_TAGS,
  button: FORM_TAGS,
  datalist: FORM_TAGS,
  textarea: FORM_TAGS,
  option: ["option"],
  optgroup: ["optgroup", "option"],
  dd: DDT_TAGS,
  dt: DDT_TAGS,
  address: P_TAG,
  article: P_TAG,
  aside: P_TAG,
  blockquote: P_TAG,
  details: P_TAG,
  div: P_TAG,
  dl: P_TAG,
  fieldset: P_TAG,
  figcaption: P_TAG,
  figure: P_TAG,
  footer: P_TAG,
  form: P_TAG,
  header: P_TAG,
  hr: P_TAG,
  main: P_TAG,
  nav: P_TAG,
  ol: P_TAG,
  pre: P_TAG,
  section: P_TAG,
  table: P_TAG,
  ul: P_TAG,
  rt: RTP_TAGS,
  rp: RTP_TAGS,
  tbody: TABLE_SECTION_TAGS,
  tfoot: TABLE_SECTION_TAGS,
};



/**
 * Parse an HTML document into a root node.
 *
 * A single forward scan with a stack of open elements. On a close tag that does
 * not match the top of the stack, the intervening elements are popped — the
 * "close what you can" recovery htmlparser2 also applies. A close tag with no
 * matching ancestor is DROPPED rather than unwinding the whole stack, which is
 * what makes a stray `</div>` in a feed harmless instead of reshuffling the
 * document.
 */
export function parseDocument(html: string): HtmlNode {
  const root = createNode("root");
  const stack: HtmlNode[] = [root];
  let index = 0;

  const current = (): HtmlNode => stack[stack.length - 1]!;

  while (index < html.length) {
    const next = html.indexOf("<", index);
    if (next === -1) {
      pushText(current(), html.slice(index));
      break;
    }
    if (next > index) pushText(current(), html.slice(index, next));
    index = next;

    if (html.startsWith("<!--", index)) {
      const end = html.indexOf("-->", index + 4);
      const body = html.slice(index + 4, end === -1 ? html.length : end);
      const comment = createNode("comment");
      comment.data = body;
      appendChild(current(), comment);
      index = end === -1 ? html.length : end + 3;
      continue;
    }

    if (html.startsWith("<!", index) || html.startsWith("<?", index)) {
      // Doctype / processing instruction. domhandler keeps these as `directive`
      // nodes carrying the inner text (`!DOCTYPE html`), not element nodes, so
      // `findAll(isTag)` skips them but the payload survives — which matters for
      // `stripTags`, where dropping the text would silently lose content.
      const end = html.indexOf(">", index);
      const directive = createNode("directive");
      directive.data = html.slice(index + 1, end === -1 ? html.length : end);
      appendChild(current(), directive);
      index = end === -1 ? html.length : end + 1;
      continue;
    }

    const close = html[index + 1] === "/";
    const nameStart = index + (close ? 2 : 1);
    let nameEnd = nameStart;
    // Two DIFFERENT rules, and conflating them is observable:
    //
    //   * the first character must be an ASCII letter — `isTagStartChar` returns
    //     `isASCIIAlpha` in HTML mode — else the `<` is literal text, so `<1>`
    //     and a lone `<` are text;
    //   * once started, the name runs to whitespace, `/` or `>` with no further
    //     restriction, so `<y=1>` is an element named `y=1`.
    if (/[A-Za-z]/.test(html[nameStart] ?? "")) {
      nameEnd = nameStart + 1;
      while (nameEnd < html.length && !/[\s/>]/.test(html[nameEnd]!)) nameEnd += 1;
    }
    const tagName = html.slice(nameStart, nameEnd).toLowerCase();

    if (close && (nameStart >= html.length || /[\s>]/.test(html[nameStart] ?? ""))) {
      // `</` followed by whitespace or `>`, or ending the input: the `<` is literal
      // text. htmlparser2 routes this through `stateBeforeClosingTagName` and back
      // to `Text`, so the whole `</` (and whatever follows, if it ends the input)
      // survives as text.
      let run = "<";
      index += 1;
      const again = html.indexOf("<", index);
      const stop = again === -1 ? html.length : again;
      run += html.slice(index, stop);
      index = stop;
      pushText(current(), run);
      continue;
    }

    if (nameEnd === nameStart) {
      // A bare `<` that does not start a tag is literal text, per the spec. It
      // must EXTEND the run rather than start a new one: htmlparser2 keeps
      // `a < b` as a single text node, and splitting it would change how
      // adjacent-text merging and whitespace collapse behave downstream.
      let run = "<";
      index += 1;
      const again = html.indexOf("<", index);
      const stop = again === -1 ? html.length : again;
      run += html.slice(index, stop);
      index = stop;
      pushText(current(), run);
      continue;
    }

    if (close) {
      const end = html.indexOf(">", nameEnd);
      index = end === -1 ? html.length : end + 1;
      if (VOID_ELEMENTS.has(tagName)) {
        // A close tag for a VOID element: htmlparser2's `onclosetag` skips the
        // stack entirely, with ONE exception — `htmlMode && name === "br"` emits a
        // synthetic `<br>`. So `</br>` inserts a line break while `</hr>` does
        // nothing. The rule exists because `</br>` was a common authoring idiom.
        if (tagName === "br") appendChild(current(), createNode("tag", "br"));
        continue;
      }
      let depth = -1;
      for (let k = stack.length - 1; k > 0; k -= 1) {
        if (stack[k]!.name === tagName) {
          depth = k;
          break;
        }
      }
      if (depth === -1) {
        // A close tag with no matching open element. For `p` specifically,
        // htmlparser2 synthesises an EMPTY `<p>` (`emitOpenTag` + `closeCurrentTag`)
        // rather than dropping the tag — which is why a stray `</p>` between two
        // paragraphs still produces the paragraph break, and why reproducing the
        // drop would silently join two blocks.
        if (tagName === "p") appendChild(current(), createNode("tag", "p"));
        continue;
      }
      stack.length = depth;
      continue;
    }

    // Start tag.
    const { attribs, end } = readAttributes(html, nameEnd);
    index = end;
    // A start tag cut off by EOF produces NO node: htmlparser2's
    // `handleTrailingData` emits nothing for InTagName / BeforeAttributeName /
    // InAttributeValue*, so `<div class="a"` yields an empty document rather than
    // a half-built element. (One unreachable exception: a name of exactly one
    // character at EOF, where the tokenizer leaks that character as text. No
    // Qzone payload truncates mid-tag, so this is documented rather than
    // reproduced.)
    if (index >= html.length && html[index - 1] !== ">") break;
    // The implied close must run BEFORE the element is attached: popping after
    // `appendChild` would leave the new `<p>` nested inside the old one and
    // reverse the outcome the table is there to produce.
    const closes = OPEN_IMPLIES_CLOSE[tagName];
    if (closes !== undefined) {
      while (stack.length > 1 && closes.includes(current().name)) stack.pop();
    }

    const element = createNode(
      tagName === "script" ? "script" : tagName === "style" ? "style" : "tag",
      tagName,
    );
    element.attribs = attribs;
    appendChild(current(), element);

    // `/>` on a normal element is IGNORED in HTML mode. htmlparser2 sets
    // `recognizeSelfClosing = !htmlMode` (false here), so its `onselfclosingtag`
    // falls through to `onopentagend` and the element stays OPEN — `<span/>t`
    // puts `t` inside the span. Honouring `/>` would make every feed with an XHTML
    // `<br/>`-style habit lose the rest of its text.
    if (VOID_ELEMENTS.has(tagName)) continue;

    if (RAW_TEXT_ELEMENTS.has(tagName) || ESCAPABLE_RAW_TEXT_ELEMENTS.has(tagName)) {
      const closer = new RegExp(`</${tagName}\\s*>`, "i");
      const match = closer.exec(html.slice(index));
      const body = match ? html.slice(index, index + match.index) : html.slice(index);
      // Only `<title>` decodes entities while this is raw: htmlparser2's
      // `stateInSpecialTag` starts an entity solely for `Sequences.TitleEnd`, and
      // `textarea` shares the state WITHOUT that branch. So `<textarea>&amp;`
      // keeps its `&amp;` literally, which is observable in extracted feed text
      // and is why `ESCAPABLE_RAW_TEXT_ELEMENTS` cannot be used as the test.
      const text = createNode("text");
      text.data = ENTITY_DECODING_RAW_TEXT.has(tagName) ? decodeEntities(body) : body;
      appendChild(element, text);
      index += match ? match.index + match[0].length : body.length;
      continue;
    }

    stack.push(element);
  }

  return root;
}

function pushText(parent: HtmlNode, raw: string): void {
  if (!raw) return;
  const data = decodeEntities(raw);
  if (!data) return;
  // Adjacent runs merge into one text node, matching htmlparser2 (and needed for
  // correct whitespace collapse, which treats each text NODE as a unit).
  const last = parent.children[parent.children.length - 1];
  if (last !== undefined && last.type === "text") {
    last.data += data;
    return;
  }
  const node = createNode("text");
  node.data = data;
  appendChild(parent, node);
}

/**
 * Read a start tag's attributes from just after its name.
 *
 * Returns the position of the character after the closing `>`, plus whether the
 * tag was self-closing. An unquoted value ends at whitespace or `>`; a quoted
 * one ends at its own quote and may contain `>`, which is why this cannot be a
 * regex. A duplicate attribute keeps the FIRST occurrence, matching
 * htmlparser2.
 */
function readAttributes(
  html: string,
  start: number,
): { attribs: Record<string, string>; selfClosing: boolean; end: number } {
  const attribs: Record<string, string> = {};
  let index = start;
  // Mirrors htmlparser2's states: BeforeAttributeName -> InAttributeName ->
  // AfterAttributeName -> BeforeAttributeValue -> InAttributeValue{Dq,Sq,Nq}.
  // Writing it as a machine rather than a loop is what makes the odd inputs agree:
  // `=` terminates a NAME (`<a b=c=d>` gives `b` = `c=d`), a `/` that is not
  // followed by `>` demotes to an ordinary name character, and a name with no
  // value records `""`.
  type State = "before" | "name" | "afterName" | "beforeValue" | "dq" | "sq" | "nq";
  let state: State = "before";
  let nameStart = 0;
  let name = "";
  let value = "";
  let valueStart = 0;

  const commitAttribute = (): void => {
    // The FIRST occurrence wins, matching htmlparser2's `hasOwnProperty` guard.
    if (name && !(name in attribs)) attribs[name] = decodeEntities(value);
    name = "";
    value = "";
  };
  const endOfTagSection = (c: string | undefined): boolean => c === "/" || c === ">" || c === undefined || /\s/.test(c);

  while (index < html.length) {
    const c = html[index]!;
    switch (state) {
      case "before": {
        if (c === ">") return { attribs, selfClosing: false, end: index + 1 };
        if (c === "/") {
          // `stateInSelfClosingTag`: only `/>` closes; anything else falls back to
          // reading attributes, so `<div / >` is still an open tag.
          if (html[index + 1] === ">") return { attribs, selfClosing: true, end: index + 2 };
          state = "before";
          index += 1;
          continue;
        }
        if (/\s/.test(c)) {
          index += 1;
          continue;
        }
        state = "name";
        nameStart = index;
        index += 1;
        continue;
      }
      case "name": {
        if (c === "=" || endOfTagSection(c)) {
          name = html.slice(nameStart, index).toLowerCase();
          state = "afterName";
          continue;
        }
        index += 1;
        continue;
      }
      case "afterName": {
        if (c === "=") {
          state = "beforeValue";
          index += 1;
          continue;
        }
        if (c === "/" || c === ">") {
          commitAttribute();
          state = "before";
          continue;
        }
        if (/\s/.test(c)) {
          index += 1;
          continue;
        }
        // A new name starts with no `=` between: the previous one has no value.
        commitAttribute();
        state = "name";
        nameStart = index;
        index += 1;
        continue;
      }
      case "beforeValue": {
        if (c === '"') {
          state = "dq";
          valueStart = index + 1;
          index += 1;
          continue;
        }
        if (c === "'") {
          state = "sq";
          valueStart = index + 1;
          index += 1;
          continue;
        }
        if (/\s/.test(c)) {
          index += 1;
          continue;
        }
        state = "nq";
        valueStart = index;
        continue;
      }
      case "dq":
      case "sq": {
        const quote = state === "dq" ? '"' : "'";
        if (c === quote) {
          value = html.slice(valueStart, index);
          commitAttribute();
          state = "before";
          index += 1;
          continue;
        }
        index += 1;
        continue;
      }
      case "nq": {
        if (/\s/.test(c) || c === ">") {
          value = html.slice(valueStart, index);
          commitAttribute();
          state = "before";
          continue;
        }
        index += 1;
        continue;
      }
    }
  }
  // An unterminated tag: whatever was pending is committed, matching the
  // tokenizer's `onend` flush.
  if (state === "name" || state === "afterName") {
    if (state === "name") name = html.slice(nameStart).toLowerCase();
    commitAttribute();
  } else if (state === "nq") {
    value = html.slice(valueStart);
    commitAttribute();
  }
  return { attribs, selfClosing: false, end: html.length };
}

/**
 * Strip tags and collapse whitespace — the cheap helper the reference's own
 * `text()` is a careful, structure-preserving version of.
 *
 * Not used by `qzone-feed-content.ts`; kept because a feed body's `html` is
 * sometimes logged and a raw payload is both noisy and private.
 */
export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}