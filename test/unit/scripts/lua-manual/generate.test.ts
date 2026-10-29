import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extract, type ManualData } from '../../../../scripts/lua-manual/generate.mts';

// The committed data file; CI (`npm run lua-manual -- --check`) proves it is
// what the generator makes from the official tarball.
const data = JSON.parse(readFileSync(new URL('../../../../data/lua52/manual.json', import.meta.url), 'utf8')) as ManualData;
const entry = (name: string): ManualData['entries'][number] => {
  const found = data.entries.find((candidate) => candidate.name === name);
  assert.ok(found, `no entry "${name}"`);
  return found;
};
const BASE = 'https://www.lua.org/manual/5.2/manual.html';

describe('scripts/lua-manual/generate', () => {
  describe('data/lua52/manual.json', () => {
    it('records its verified source and the manual copyright', () => {
      assert.deepEqual(data.source, {
        url: 'https://www.lua.org/ftp/lua-5.2.4.tar.gz',
        sha256: 'b9e2e4aad6789b3b63a056d442f7b39f0ecfca3ae0f1fc0ae4e9614401b69f4b',
        member: 'lua-5.2.4/doc/manual.html',
        encoding: 'iso-8859-1',
      });
      assert.equal(data.title, 'Lua 5.2 Reference Manual');
      assert.equal(data.copyright, 'Copyright © 2011–2015 Lua.org, PUC-Rio. Freely available under the terms of the Lua license.');
      assert.equal(data.baseUrl, BASE);
    });

    it('holds exactly the libraries the game engine opens', () => {
      assert.deepEqual(data.sections, [
        { number: '6.1', title: 'Basic Functions' },
        { number: '6.4', title: 'String Manipulation', module: 'string' },
        { number: '6.5', title: 'Table Manipulation', module: 'table' },
        { number: '6.6', title: 'Mathematical Functions', module: 'math' },
        { number: '6.7', title: 'Bitwise Operations', module: 'bit32' },
        { number: '6.10', title: 'The Debug Library', module: 'debug' },
      ]);
      const perSection = new Map<string, number>();
      for (const { section } of data.entries) perSection.set(section, (perSection.get(section) ?? 0) + 1);
      // Entries per section, module table included (counted in the manual's HTML).
      assert.deepEqual(Object.fromEntries(perSection), { '6.1': 24, '6.4': 15, '6.5': 7, '6.6': 30, '6.7': 13, '6.10': 17 });
      for (const { name } of data.entries) {
        assert.doesNotMatch(name, /^(coroutine|io|os|package)\b/, `${name} is not opened by the engine`);
      }
      for (const absent of ['require', 'module', 'unpack', 'loadstring']) {
        assert.equal(data.entries.some((candidate) => candidate.name === absent), false, absent);
      }
    });

    it('gives each entry a kind, anchor and verbatim heading', () => {
      assert.deepEqual(
        data.entries.filter((candidate) => candidate.kind === 'value').map((candidate) => candidate.name),
        ['_G', '_VERSION', 'math.huge', 'math.pi'],
      );
      assert.deepEqual(
        data.entries.filter((candidate) => candidate.kind === 'module').map((candidate) => [candidate.name, candidate.anchor]),
        [['string', '6.4'], ['table', '6.5'], ['math', '6.6'], ['bit32', '6.7'], ['debug', '6.10']],
      );
      assert.equal(entry('string.format').heading, 'string.format (formatstring, ···)');
      assert.equal(entry('string.format').anchor, 'pdf-string.format');
      assert.equal(entry('debug.sethook').heading, 'debug.sethook ([thread,] hook, mask [, count])');
    });

    it('keeps the manual text of entries', () => {
      assert.equal(entry('math.huge').markdown, 'The value `HUGE_VAL`, a value larger than or equal to any other numerical value.');
      assert.equal(entry('math.exp').markdown, 'Returns the value *eˣ*.');
      assert.equal(entry('math.exp').plaintext, 'Returns the value eˣ.');
      assert.equal(
        entry('select').markdown,
        'If `index` is a number, returns all arguments after argument number `index`; a negative number indexes from the end (-1 is the last argument). ' +
          'Otherwise, `index` must be the string `"#"`, and `select` returns the total number of extra arguments it received.',
      );
      assert.equal(
        entry('bit32.extract').markdown,
        'Returns the unsigned number formed by the bits `field` to `field + width - 1` from `n`. ' +
          'Bits are numbered from 0 (least significant) to 31 (most significant). All accessed bits must be in the range *\\[0, 31\\]*.\n\n' +
          'The default for `width` is 1.',
      );
      assert.equal(
        entry('table.sort').markdown,
        'Sorts list elements in a given order, *in-place*, from `list[1]` to `list[#list]`. If `comp` is given, then it must be a function that receives two list elements ' +
          'and returns true when the first element must come before the second in the final order (so that `not comp(list[i+1],list[i])` will be true after the sort). ' +
          'If `comp` is not given, then the standard Lua operator `<` is used instead.\n\n' +
          'The sort algorithm is not stable; that is, elements considered equal by the given order may have their relative positions changed by the sort.',
      );
    });

    it('keeps lists, code blocks and links of entries', () => {
      const sethook = entry('debug.sethook').markdown;
      assert.ok(sethook.includes("\n\n- **'`c`':** the hook is called every time Lua calls a function;\n- **'`r`':**"), sethook);
      assert.ok(sethook.includes(`[\`debug.sethook\`](${BASE}#pdf-debug.sethook) turns off the hook.`), sethook);
      const collectgarbage = entry('collectgarbage').markdown;
      assert.ok(
        collectgarbage.includes('so the following equality is always true:\n\n  ```\n       k, b = collectgarbage("count")\n       assert(k*1024 == math.floor(k)*1024 + b)\n  ```\n\n  (The second result'),
        collectgarbage,
      );
      assert.ok(entry('string.gsub').markdown.includes('of the form `%`*`d`*, with *d* between 1 and 9'));
      assert.ok(entry('string').markdown.startsWith('This library provides generic functions for string manipulation,'));
    });
  });

  describe('extract', () => {
    const page = (sections: string): string =>
      `<title>Manual</title><small>\nCopyright &copy; 2015 X.\n<a href="l">License</a>.\n</small>${sections}<h1>7 &ndash; <a name="7">End</a></h1>`;
    const section = (number: string, title: string, body: string): string => `<h2>${number} &ndash; <a name="${number}">${title}</a></h2>${body}`;
    const minimal = (overrides: Record<string, string> = {}): string =>
      page(
        [
          ['6.1', '<p>\nIntro.\n<p>\n<hr><h3><a name="pdf-f"><code>f (x)</code></a></h3>\nDoes <code>x</code>.\n'],
          ...['6.4:string', '6.5:table', '6.6:math', '6.7:bit32', '6.10:debug'].map((spec) => {
            const [number = '', module = ''] = spec.split(':');
            return [number, `<p>\nTable <a name="pdf-${module}"><code>${module}</code></a>.\n<p>\n<hr><h3><a name="pdf-${module}.g"><code>${module}.g</code></a></h3>\nA value.\n`];
          }),
        ]
          .map(([number = '', body = '']) => section(number, `S${number}`, overrides[number] ?? body))
          .join(''),
      );

    it('reads sections, module introductions and entries', () => {
      const result = extract(minimal());
      assert.equal(result.title, 'Manual');
      assert.equal(result.copyright, 'Copyright © 2015 X. License.');
      assert.equal(result.entries.length, 11);
      assert.deepEqual(result.entries[0], { name: 'f', kind: 'function', section: '6.1', anchor: 'pdf-f', heading: 'f (x)', markdown: 'Does `x`.', plaintext: 'Does x.' });
      assert.deepEqual(result.entries[1], { name: 'string', kind: 'module', section: '6.4', anchor: '6.4', heading: 'string', markdown: 'Table `string`.', plaintext: 'Table string.' });
      assert.equal(result.entries[2]?.kind, 'value');
    });

    it('fails on a missing section, a foreign entry, an unexpected heading or unsupported HTML', () => {
      assert.throws(() => extract(page('')), /The heading of §6\.1 was not found/);
      assert.throws(() => extract(minimal({ '6.4': '<p>\n<a name="pdf-string">s</a><hr><h3><a name="pdf-os.time"><code>os.time ()</code></a></h3>\n' })), /entry "os\.time": the name does not belong/);
      assert.throws(() => extract(minimal({ '6.4': '<p>\nNo anchor.<hr><h3><a name="pdf-string.g"><code>string.g</code></a></h3>\n' })), /no anchor "pdf-string"/);
      assert.throws(() => extract(minimal({ '6.1': '<p>\n<hr><h3><a name="pdf-f"><code>f</code></a></h3>\nx\n<hr><h3>Other</h3>\n' })), /2 entry headings, but only 1/);
      assert.throws(() => extract(minimal({ '6.1': '<p>\n<hr><h3><a name="pdf-f"><code>f</code></a></h3>\n<table></table>\n' })), /entry "f": Unsupported tag <table>/);
    });
  });
});
