import assert from 'node:assert/strict';
import { convertFragment, decodeEntities, UnsupportedHtmlError } from '../../../../scripts/lua-manual/convert.mts';

const BASE = 'https://www.lua.org/manual/5.2/manual.html';
const convert = (html: string): { markdown: string; plaintext: string } => convertFragment(html, BASE);

describe('scripts/lua-manual/convert', () => {
  it('decodes exactly the supported entities', () => {
    assert.equal(decodeEntities('a&nbsp;b &middot;&middot;&middot; &sect;2 &ndash; &pi; &lt;&gt; &amp;&quot;'), 'a\u00a0b ··· §2 – π <> &"');
    assert.throws(() => decodeEntities('&eacute;'), UnsupportedHtmlError);
    assert.throws(() => decodeEntities('&#233;'), UnsupportedHtmlError);
  });

  it('splits paragraphs at <p>, collapses whitespace and drops empty paragraphs', () => {
    const { markdown, plaintext } = convert('\nFirst\nline   here.\n\n\n<p>\n<p>\nSecond.\n\n<p>\n');
    assert.equal(markdown, 'First line here.\n\nSecond.');
    assert.equal(plaintext, 'First line here.\n\nSecond.');
  });

  it('keeps a non-breaking space, which HTML does not collapse', () => {
    assert.equal(convert('position&nbsp;1').markdown, 'position\u00a01');
  });

  it('collapses whitespace across element boundaries', () => {
    assert.equal(convert('<b>"<code>x</code>": </b>\ndoes').markdown, '**"`x`":** does');
  });

  it('renders code spans, using a longer fence when the code contains backticks', () => {
    assert.equal(convert('call <code>f(x)</code> now').markdown, 'call `f(x)` now');
    assert.equal(convert('<code>a`b</code>').markdown, '``a`b``');
    assert.equal(convert('<code>`</code>').markdown, '`` ` ``');
    assert.equal(convert('call <code>f(x)</code> now').plaintext, 'call f(x) now');
  });

  it('renders a placeholder marked <em> inside code as an emphasized code span', () => {
    assert.equal(convert('form <code>%<em>d</em></code>, with').markdown, 'form `%`*`d`*, with');
    assert.equal(convert('form <code>%<em>d</em></code>, with').plaintext, 'form %d, with');
  });

  it('renders emphasis, keeping spaces outside the delimiters', () => {
    assert.equal(convert('the <em>pause</em> of').markdown, 'the *pause* of');
    assert.equal(convert('is <b>nil</b> or <b>false </b>x').markdown, 'is **nil** or **false** x');
    assert.equal(convert('is <b>nil</b>').plaintext, 'is nil');
  });

  it('makes links into the manual absolute and unwraps anchors', () => {
    const { markdown, plaintext } = convert('see <a href="#2.5">&sect;2.5</a> and <a href="#pdf-tostring"><code>tostring</code></a>; <a name="pdf-string"><code>string</code></a>');
    assert.equal(markdown, `see [§2.5](${BASE}#2.5) and [\`tostring\`](${BASE}#pdf-tostring); \`string\``);
    assert.equal(plaintext, `see §2.5 (${BASE}#2.5) and tostring (${BASE}#pdf-tostring); string`);
  });

  it('renders superscripts as Unicode superscript characters', () => {
    assert.equal(convert('2<sup>32</sup> and <em>e<sup>x</sup></em>').markdown, '2³² and *eˣ*');
    assert.equal(convert('x<sup>y</sup>').plaintext, 'xʸ');
    assert.throws(() => convert('<sup>z</sup>'), /No Unicode superscript for "z"/);
  });

  it('keeps preformatted text verbatim in a fenced block', () => {
    const html = 'For instance\n\n<pre>\n     f("a &lt; b")\n       --   indented\n</pre><p>\nAfter.';
    assert.equal(convert(html).markdown, 'For instance\n\n```\n     f("a < b")\n       --   indented\n```\n\nAfter.');
    assert.equal(convert(html).plaintext, 'For instance\n\n     f("a < b")\n       --   indented\n\nAfter.');
    assert.equal(convert('<pre>\nx = ```\n</pre>').markdown, '````\nx = ```\n````');
   });

  it('keeps the text of placeholders marked <em> in preformatted text', () => {
    assert.equal(convert('<pre>\n     for i,v in ipairs(t) do <em>body</em> end\n</pre>').markdown, '```\n     for i,v in ipairs(t) do body end\n```');
  });

  it('renders lists, indenting the blocks of an item', () => {
    assert.equal(convert('<ul>\n<li>one</li>\n<li>two</li>\n</ul>').markdown, '- one\n- two');
    const loose = convert('<ul>\n<li>one\n<pre>\ncode\n</pre><p>\nmore\n</li>\n<li>two</li>\n</ul>');
    assert.equal(loose.markdown, '- one\n\n  ```\n  code\n  ```\n\n  more\n\n- two');
    assert.equal(loose.plaintext, '- one\n\n  code\n\n  more\n\n- two');
  });

  it('escapes text Markdown would interpret', () => {
    assert.equal(convert('a*b_c [d] &lt;e&gt; &amp; ~f~ \\ `').markdown, 'a\\*b\\_c \\[d\\] \\<e\\> \\& \\~f\\~ \\\\ \\`');
    assert.equal(convert('Wow! <a href="#x">link</a>').markdown, `Wow\\! [link](${BASE}#x)`);
    assert.equal(convert('Wow!<a href="#x">link</a>').markdown, `Wow\\![link](${BASE}#x)`);
    assert.equal(convert('# not a heading').markdown, '\\# not a heading');
    assert.equal(convert('- not a list').markdown, '\\- not a list');
    assert.equal(convert('1. not a list').markdown, '1\\. not a list');
    assert.equal(convert('a*b').plaintext, 'a*b');
  });

  it('rejects HTML outside the supported subset', () => {
    assert.throws(() => convert('<h4>Title</h4>'), /Unsupported tag <h4>/);
    assert.throws(() => convert('<table><tr><td>x</td></tr></table>'), UnsupportedHtmlError);
    assert.throws(() => convert('<a href="http://example.com/">x</a>'), /Only links into the manual/);
    assert.throws(() => convert('<code><b>d</b></code>'), /Markup inside <code>/);
    assert.throws(() => convert('<pre>\n<b>x</b>\n</pre>'), /<pre> must contain only text/);
    assert.throws(() => convert('<pre>\n<em><b>x</b></em>\n</pre>'), /<em> in <pre> must contain only text/);
    assert.throws(() => convert('<ul><li>a<ul><li>b</li></ul></li></ul>'), /Nested lists/);
    assert.throws(() => convert('<em>open'), /Missing <\/em>/);
    assert.throws(() => convert('a < b'), /Unparsed markup/);
  });

  describe('LuaJIT mode', () => {
    const PAGE = 'https://luajit.org/ext_buffer.html';
    const luajit = (html: string): { markdown: string; plaintext: string } => convertFragment(html, PAGE, { luajit: true });

    it('accepts the LuaJIT elements only when asked to', () => {
      for (const html of ['<p>a</p>', '<p><tt>x</tt>', '<p>a<br>b', '<p><i>x</i>', '<p><a href="x.html">x</a>', '<table><tr><td>a</td></tr></table>']) {
        assert.throws(() => convert(html), UnsupportedHtmlError, html);
        assert.doesNotThrow(() => luajit(html), html);
      }
      assert.throws(() => decodeEntities('&mdash;'), UnsupportedHtmlError);
      assert.equal(decodeEntities('&mdash; &plusmn; &raquo;', { luajit: true }), '\u2014 \u00b1 \u00bb');
    });

    it('closes paragraphs at </p> and renders <tt> and <i> like <code> and <em>', () => {
      assert.deepEqual(luajit('<p>\nUse <tt>buf:put()</tt>, <i>not</i> this.\n</p>\n<p>\nNext.\n</p>'), {
        markdown: 'Use `buf:put()`, *not* this.\n\nNext.',
        plaintext: 'Use buf:put(), not this.\n\nNext.',
      });
    });

    it('renders <br> as a line break without the spaces around it', () => {
      assert.deepEqual(luajit('<p>one <br>\ntwo</p>'), { markdown: 'one\\\ntwo', plaintext: 'one\ntwo' });
    });

    it('resolves links to other pages against the page URL', () => {
      assert.equal(luajit('<p><a href="ext_ffi.html#x">FFI</a></p>').markdown, '[FFI](https://luajit.org/ext_ffi.html#x)');
      assert.equal(luajit('<p><a href="#serialize">s</a></p>').markdown, '[s](https://luajit.org/ext_buffer.html#serialize)');
      assert.equal(luajit('<p><a href="https://luajit.org/x.html"><span class="ext">&raquo;</span>&nbsp;x</a></p>').plaintext, '»\u00a0x (https://luajit.org/x.html)');
    });

    it('renders tables with their first row as the header', () => {
      assert.deepEqual(luajit('<table>\n<tr><td>A</td><td>B</td></tr>\n<tr><td><tt>x</tt></td><td>y|z</td></tr>\n</table>'), {
        markdown: '| A | B |\n| --- | --- |\n| `x` | y\\|z |',
        plaintext: 'A\tB\nx\ty|z',
      });
    });

    it('keeps a bare `>` and the text of colored code in <pre>, and still refuses a stray `<`', () => {
      assert.equal(luajit('<pre class="code">\nuntil n >= len\n<span style="color:#00a000;">int a;</span>\n</pre>').plaintext, 'until n >= len\nint a;');
      assert.throws(() => luajit('<p>a < b</p>'), UnsupportedHtmlError);
      assert.throws(() => luajit('<p><span class="other">x</span></p>'), UnsupportedHtmlError);
    });
  });
});
