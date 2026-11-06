// Converts the HTML of the Lua 5.2 reference manual's library entries into
// Markdown and plain text, keeping the manual's wording and formatting.
// Pure: no I/O. Used by generate.mts, and by scripts/luajit-manual/ for the
// LuaJIT documentation (with `ConvertOptions.luajit`).
//
// The manual (lua-5.2.4/doc/manual.html) is hand-written HTML 4 with a small
// vocabulary. This converter accepts exactly the subset the library entries
// use and throws on anything else, so a manual that changes shape fails the
// generator instead of producing silently wrong text:
//
//   <p>                        starts a paragraph (it is never closed in the manual)
//   <pre>…</pre>               a code block, kept verbatim (an <em> inside is shown
//                              without emphasis: code blocks cannot show it)
//   <ul><li>…</li></ul>        a list; items hold paragraphs and code blocks
//   <code> <em> <b>            code span, emphasis, strong emphasis (an <em> inside
//                              <code> becomes an emphasized code span of its own)
//   <a href="#x">              link into the manual, made absolute
//   <a name="x">               anchor, unwrapped
//   <sup>                      superscript, as Unicode superscript characters
//                              (hovers render Markdown without HTML)
//
// Entities: only those the entries use, plus &amp; and &quot; (and &copy;, for
// the copyright line).
//
// The LuaJIT documentation (luajit.org, bitop.luajit.org) is XHTML with a few more
// elements, accepted only with `ConvertOptions.luajit`, so that the Lua manual stays
// held to its own subset:
//
//   </p>                       closes a paragraph
//   <tt> <i>                   code span and emphasis, like <code> and <em>
//   <br>                       a line break inside a paragraph
//   <table><tr><td>            a table; its first row is the header
//   <a href="page.html#x">     links to other pages, resolved against the page's URL
//   <span class="ext">         the external-link marker (`»`), kept as text
//   <span style="…"> in <pre>  colored code, kept without its color (Markdown code blocks
//                              cannot show it; ffi.cdef's text refers to "the part in green")
//   &mdash; &plusmn; &raquo;   more entities
//   a bare `>` in text         (HTML allows it; a `<` that starts no tag is still refused)

/** Thrown for HTML outside the supported subset; the message says what and where. */
export class UnsupportedHtmlError extends Error {}

/** How a fragment is converted. */
export interface ConvertOptions {
  /** Accept the LuaJIT documentation's elements (see above). */
  readonly luajit?: boolean;
}

/** Entities only the LuaJIT documentation uses. */
const LUAJIT_ENTITIES: Readonly<Record<string, string>> = {
  mdash: '\u2014',
  plusmn: '\u00b1',
  raquo: '\u00bb',
};

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  quot: '"',
  lt: '<',
  gt: '>',
  nbsp: '\u00a0',
  middot: '\u00b7',
  ndash: '\u2013',
  sect: '\u00a7',
  pi: '\u03c0',
  // Only in the manual's copyright line, which generate.mts records.
  copy: '\u00a9',
};

// Unicode has superscript forms for digits and some letters; only the
// characters the manual puts in <sup> are listed (2^32, 2^51, e^x, x^y, m2^e).
const SUPERSCRIPTS: Readonly<Record<string, string>> = {
  '0': '\u2070', '1': '\u00b9', '2': '\u00b2', '3': '\u00b3', '4': '\u2074',
  '5': '\u2075', '6': '\u2076', '7': '\u2077', '8': '\u2078', '9': '\u2079',
  e: '\u1d49', x: '\u02e3', y: '\u02b8',
};

/** Replaces the supported character entities; throws on any other `&…;`. */
export function decodeEntities(text: string, options: ConvertOptions = {}): string {
  return text.replace(/&([a-zA-Z0-9#]+);/g, (match, name: string) => {
    const decoded = ENTITIES[name] ?? (options.luajit === true ? LUAJIT_ENTITIES[name] : undefined);
    if (decoded === undefined) {
      throw new UnsupportedHtmlError(`Unsupported HTML entity ${match}.`);
    }
    return decoded;
  });
}

// ------------------------------------------------------------------ tokens

type Token =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'open'; readonly name: string; readonly attributes: Readonly<Record<string, string>>; readonly source: string }
  | { readonly type: 'close'; readonly name: string; readonly source: string };

function tokenize(html: string, options: ConvertOptions): Token[] {
  const tokens: Token[] = [];
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z]+="[^"]*")*)\s*>/g;
  let last = 0;
  for (let match = tag.exec(html); match; match = tag.exec(html)) {
    if (match.index > last) tokens.push({ type: 'text', text: html.slice(last, match.index) });
    const [source, slash, rawName = '', rawAttributes = ''] = match;
    const name = rawName.toLowerCase();
    if (slash) {
      tokens.push({ type: 'close', name, source });
    } else {
      const attributes: Record<string, string> = {};
      for (const [, key = '', value = ''] of rawAttributes.matchAll(/([a-zA-Z]+)="([^"]*)"/g)) attributes[key.toLowerCase()] = value;
      tokens.push({ type: 'open', name, attributes, source });
    }
    last = match.index + source.length;
  }
  if (last < html.length) tokens.push({ type: 'text', text: html.slice(last) });
  for (const token of tokens) {
    // HTML allows a bare `>` in text, which the LuaJIT documentation uses (`until n >= len`).
    if (token.type === 'text' && (options.luajit === true ? /</ : /[<>]/).test(token.text)) {
      throw new UnsupportedHtmlError(`Unparsed markup in text: ${JSON.stringify(token.text.trim().slice(0, 60))}.`);
    }
  }
  return tokens;
}

// ------------------------------------------------------------------ tree

type Inline =
  | { readonly kind: 'text'; readonly text: string }
  /** Code; `emphasized` parts are placeholders (`%<em>d</em>` in `string.gsub`). */
  | { readonly kind: 'code'; readonly parts: readonly { readonly text: string; readonly emphasized: boolean }[] }
  | { readonly kind: 'em' | 'strong' | 'sup'; readonly children: readonly Inline[] }
  /** `href` as written: `#fragment` (into the same page) or a relative or absolute URL. */
  | { readonly kind: 'link'; readonly href: string; readonly children: readonly Inline[] }
  | { readonly kind: 'break' };

type Block =
  | { readonly kind: 'paragraph'; readonly children: readonly Inline[] }
  | { readonly kind: 'pre'; readonly text: string }
  | { readonly kind: 'list'; readonly items: readonly (readonly Block[])[] }
  /** Rows of cells; the first row is the header. */
  | { readonly kind: 'table'; readonly rows: readonly (readonly (readonly Inline[])[])[] };

class Parser {
  private index = 0;
  private readonly tokens: readonly Token[];
  private readonly options: ConvertOptions;
  constructor(tokens: readonly Token[], options: ConvertOptions) {
    this.tokens = tokens;
    this.options = options;
  }

  private get luajit(): boolean {
    return this.options.luajit === true;
  }

  private decode(text: string): string {
    return decodeEntities(text, this.options);
  }

  /** Blocks until the end of input, or until `</until>` (consumed). */
  blocks(until?: string): Block[] {
    const blocks: Block[] = [];
    let paragraph: Inline[] = [];
    const flush = (): void => {
      if (paragraph.some((inline) => inline.kind !== 'text' || inline.text.trim() !== '')) {
        blocks.push({ kind: 'paragraph', children: paragraph });
      }
      paragraph = [];
    };
    for (;;) {
      const token = this.tokens[this.index];
      if (!token) {
        if (until) throw new UnsupportedHtmlError(`Missing </${until}>.`);
        break;
      }
      if (token.type === 'close' && token.name === until) {
        this.index++;
        break;
      }
      if (token.type === 'open' && token.name === 'p') {
        this.index++;
        flush();
      } else if (this.luajit && token.type === 'close' && token.name === 'p') {
        this.index++;
        flush();
      } else if (this.luajit && token.type === 'open' && token.name === 'table') {
        this.index++;
        flush();
        blocks.push({ kind: 'table', rows: this.tableRows() });
      } else if (token.type === 'open' && token.name === 'pre') {
        this.index++;
        flush();
        blocks.push({ kind: 'pre', text: this.pre() });
      } else if (token.type === 'open' && token.name === 'ul') {
        this.index++;
        flush();
        blocks.push({ kind: 'list', items: this.listItems() });
      } else {
        paragraph.push(...this.inline(token));
      }
    }
    flush();
    return blocks;
  }

  /**
   * The text of a `<pre>`. `<em>` marks placeholders in two examples
   * (`for i,v in ipairs(t) do <em>body</em> end`); a code block cannot show
   * emphasis, so its text is kept and the emphasis dropped.
   */
  private pre(): string {
    let text = '';
    for (;;) {
      const token = this.tokens[this.index++];
      if (token?.type === 'close' && token.name === 'pre') break;
      if (token?.type === 'text') {
        text += token.text;
      } else if ((token?.type === 'open' && token.name === 'em') || (this.luajit && token?.type === 'open' && token.name === 'span' && token.attributes['style'] !== undefined)) {
        // `<span style="color:…">` (LuaJIT): colored code, shown without its color like `<em>`.
        const [inner, close] = [this.tokens[this.index], this.tokens[this.index + 1]];
        if (inner?.type !== 'text' || close?.type !== 'close' || close.name !== token.name) {
          throw new UnsupportedHtmlError(`<${token.name}> in <pre> must contain only text.`);
        }
        text += inner.text;
        this.index += 2;
      } else {
        throw new UnsupportedHtmlError(`<pre> must contain only text and <em>, found ${token ? describe(token) : 'the end of input'}.`);
      }
    }
    // HTML ignores a newline right after <pre>; the one before </pre> ends the last line.
    return this.decode(text).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
  }

  /** The rows of a `<table>` (LuaJIT only): `<tr>` elements of `<td>` cells holding inline content. */
  private tableRows(): Inline[][][] {
    const rows: Inline[][][] = [];
    for (;;) {
      const token = this.tokens[this.index++];
      if (!token) throw new UnsupportedHtmlError('Missing </table>.');
      if (token.type === 'text' && token.text.trim() === '') continue;
      if (token.type === 'close' && token.name === 'table') return rows;
      if (token.type !== 'open' || token.name !== 'tr') throw new UnsupportedHtmlError(`Unexpected ${describe(token)} in <table>.`);
      const cells: Inline[][] = [];
      for (;;) {
        const cell = this.tokens[this.index++];
        if (!cell) throw new UnsupportedHtmlError('Missing </tr>.');
        if (cell.type === 'text' && cell.text.trim() === '') continue;
        if (cell.type === 'close' && cell.name === 'tr') break;
        if (cell.type !== 'open' || cell.name !== 'td') throw new UnsupportedHtmlError(`Unexpected ${describe(cell)} in <tr>.`);
        cells.push(this.inlines('td'));
      }
      rows.push(cells);
    }
  }

  private listItems(): Block[][] {
    const items: Block[][] = [];
    for (;;) {
      const token = this.tokens[this.index];
      if (!token) throw new UnsupportedHtmlError('Missing </ul>.');
      this.index++;
      if (token.type === 'text' && token.text.trim() === '') continue;
      if (token.type === 'close' && token.name === 'ul') return items;
      if (token.type === 'open' && token.name === 'li') {
        const item = this.blocks('li');
        if (item.some((block) => block.kind === 'list')) throw new UnsupportedHtmlError('Nested lists are not supported.');
        items.push(item);
        continue;
      }
      throw new UnsupportedHtmlError(`Unexpected ${describe(token)} in <ul>.`);
    }
  }

  /** One inline element; an anchor (`<a name>`) yields its children. */
  private inline(token: Token): Inline[] {
    this.index++;
    if (token.type === 'text') return [{ kind: 'text', text: this.decode(token.text) }];
    if (token.type === 'close') throw new UnsupportedHtmlError(`Unexpected ${token.source}.`);
    switch (token.name === 'tt' && this.luajit ? 'code' : token.name === 'i' && this.luajit ? 'em' : token.name) {
      case 'br':
        if (!this.luajit) throw new UnsupportedHtmlError(`Unsupported tag ${token.source}.`);
        return [{ kind: 'break' }];
      case 'span':
        if (!this.luajit || token.attributes['class'] !== 'ext') throw new UnsupportedHtmlError(`Unsupported tag ${token.source}.`);
        return this.inlines('span');
      case 'code': {
        const parts = this.inlines(token.name).map((child) => {
          if (child.kind === 'text') return { text: child.text, emphasized: false };
          const [only] = child.kind === 'em' ? child.children : [];
          if (child.kind === 'em' && child.children.length === 1 && only?.kind === 'text') return { text: only.text, emphasized: true };
          throw new UnsupportedHtmlError('Markup inside <code> other than <em> around text is not supported.');
        });
        return [{ kind: 'code', parts }];
      }
      case 'em':
        return [{ kind: 'em', children: this.inlines(token.name) }];
      case 'b':
        return [{ kind: 'strong', children: this.inlines('b') }];
      case 'sup':
        return [{ kind: 'sup', children: this.inlines('sup') }];
      case 'a': {
        const { href, name } = token.attributes;
        if (href !== undefined) {
          if (!this.luajit && (!href.startsWith('#') || href.length === 1)) {
            throw new UnsupportedHtmlError(`Only links into the manual are supported, found href="${href}".`);
          }
          return [{ kind: 'link', href, children: this.inlines('a') }];
        }
        if (name !== undefined) {
          // An anchor only marks a position; its content is ordinary text.
          return this.inlines('a');
        }
        throw new UnsupportedHtmlError(`<a> without href or name: ${token.source}.`);
      }
      default:
        throw new UnsupportedHtmlError(`Unsupported tag ${token.source}.`);
    }
  }

  private inlines(until: string): Inline[] {
    const children: Inline[] = [];
    for (;;) {
      const token = this.tokens[this.index];
      if (!token) throw new UnsupportedHtmlError(`Missing </${until}>.`);
      if (token.type === 'close' && token.name === until) {
        this.index++;
        return children;
      }
      if (token.type === 'open' && ['p', 'pre', 'ul', 'li', 'table'].includes(token.name)) {
        throw new UnsupportedHtmlError(`Block ${token.source} inside <${until}>.`);
      }
      children.push(...this.inline(token));
    }
  }
}

function describe(token: Token): string {
  return token.type === 'text' ? `text ${JSON.stringify(token.text.trim().slice(0, 40))}` : token.source;
}

// ------------------------------------------------------------------ output

export interface Converted {
  readonly markdown: string;
  readonly plaintext: string;
}

/** HTML collapses runs of ASCII whitespace; U+00A0 (&nbsp;) is not whitespace. */
const collapse = (text: string): string => text.replace(/[ \t\r\n]+/g, ' ');

/**
 * Stands for a `<br>` until a paragraph's white space is collapsed (a line break would be
 * collapsed with it); U+0000 never occurs in the documentation's text.
 */
const BREAK = '\u0000';

/** The URL a link points to: a `#fragment` into the page at `baseUrl`, or a URL resolved against it. */
function linkUrl(href: string, baseUrl: string, encode: boolean): string {
  if (href.startsWith('#')) return `${baseUrl}#${encode ? encodeURI(href.slice(1)) : href.slice(1)}`;
  return new URL(href, baseUrl).href;
}

/**
 * Backslash-escapes the characters that Markdown (CommonMark + GFM) would
 * interpret in text; `!` too, which would turn a following link into an image.
 */
function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]<>&~|!]/g, '\\$&');
}

/** Escapes a paragraph or list item start that Markdown would read as a heading, list, quote or rule. */
function escapeLineStart(line: string): string {
  return line.replace(/^(#|>|[-+=]|\d+(?=[.)]))/, (start) => (/^\d/.test(start) ? `${start}\\` : `\\${start}`));
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map(([run]) => run.length));
  const fence = '`'.repeat(longest + 1);
  // CommonMark strips one space from each side when both are present, and a
  // backtick next to the fence would merge with it: pad in those cases.
  const pad = text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function superscript(text: string): string {
  return text.replace(/./gsu, (character) => {
    const mapped = SUPERSCRIPTS[character];
    if (mapped === undefined) throw new UnsupportedHtmlError(`No Unicode superscript for ${JSON.stringify(character)}.`);
    return mapped;
  });
}

function plainInlines(children: readonly Inline[], baseUrl: string): string {
  return children.map((child): string => {
    switch (child.kind) {
      case 'text':
        return collapse(child.text);
      case 'code':
        return collapse(child.parts.map((part) => part.text).join(''));
      case 'em':
      case 'strong':
        return plainInlines(child.children, baseUrl);
      case 'sup':
        return superscript(plainInlines(child.children, baseUrl));
      case 'link':
        return `${plainInlines(child.children, baseUrl)} (${linkUrl(child.href, baseUrl, false)})`;
      case 'break':
        return BREAK;
    }
  }).join('');
}

/** Wraps `inner` in `marker`, moving surrounding spaces outside so the delimiters stay flanking. */
function delimit(marker: string, inner: string): string {
  const match = /^( *)(.*?)( *)$/s.exec(inner);
  const [, before = '', core = '', after = ''] = match ?? [];
  return core === '' ? inner : `${before}${marker}${core}${marker}${after}`;
}

function markdownInlines(children: readonly Inline[], baseUrl: string): string {
  return children.map((child): string => {
    switch (child.kind) {
      case 'text':
        return escapeMarkdown(collapse(child.text));
      case 'code':
        // A code span cannot contain emphasis: an emphasized part becomes an emphasized code span of its own.
        return child.parts.map((part) => (part.emphasized ? `*${codeSpan(collapse(part.text))}*` : codeSpan(collapse(part.text)))).join('');
      case 'em':
        return delimit('*', markdownInlines(child.children, baseUrl));
      case 'strong':
        return delimit('**', markdownInlines(child.children, baseUrl));
      case 'sup':
        return superscript(plainInlines(child.children, baseUrl));
      case 'link':
        return `[${markdownInlines(child.children, baseUrl)}](${linkUrl(child.href, baseUrl, true)})`;
      case 'break':
        return BREAK;
    }
  }).join('');
}

function fenced(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map(([run]) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}\n${text}\n${fence}`;
}

const indent = (text: string, prefix: string): string => text.split('\n').map((line) => (line === '' ? line : prefix + line)).join('\n');

function render(blocks: readonly Block[], baseUrl: string, markdown: boolean): string {
  return blocks.map((block): string => {
    switch (block.kind) {
      case 'paragraph': {
        // HTML also collapses whitespace across element boundaries (`<b>x: </b>\nmore`).
        const text = collapse(markdown ? markdownInlines(block.children, baseUrl) : plainInlines(block.children, baseUrl)).trim();
        // A `<br>`: a hard line break (a backslash at the end of the line in Markdown), without the spaces around it.
        const lines = text.split(new RegExp(` ?${BREAK} ?`)).map((line) => (markdown ? escapeLineStart(line) : line));
        return lines.join(markdown ? '\\\n' : '\n');
      }
      case 'table': {
        const cell = (inlines: readonly Inline[]): string =>
          collapse(markdown ? markdownInlines(inlines, baseUrl) : plainInlines(inlines, baseUrl)).trim();
        const rows = block.rows.map((row) => row.map(cell));
        if (!markdown) return rows.map((row) => row.join('\t')).join('\n');
        // GitHub-flavored Markdown table; `|` in a cell is already escaped by `escapeMarkdown`.
        const [header = [], ...body] = rows;
        return [header, header.map(() => '---'), ...body].map((row) => `| ${row.join(' | ')} |`).join('\n');
      }
      case 'pre':
        return markdown ? fenced(block.text) : block.text;
      case 'list': {
        const loose = block.items.some((item) => item.length > 1);
        return block.items
          .map((item) => {
            const body = indent(render(item, baseUrl, markdown), '  ');
            return `- ${body.slice(2)}`;
          })
          .join(loose ? '\n\n' : '\n');
      }
    }
  }).join('\n\n');
}

/**
 * Markdown and plain text of a fragment of the manual (the HTML between an
 * entry's heading and the next one). `baseUrl` makes `#fragment` links absolute.
 * Throws `UnsupportedHtmlError` for anything outside the supported subset.
 */
export function convertFragment(html: string, baseUrl: string, options: ConvertOptions = {}): Converted {
  const blocks = new Parser(tokenize(html, options), options).blocks();
  return { markdown: render(blocks, baseUrl, true), plaintext: render(blocks, baseUrl, false) };
}
