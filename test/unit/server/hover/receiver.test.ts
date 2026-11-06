import assert from 'node:assert/strict';
import { LUA52, LUAJIT, type Library } from '../../../../src/server/hover/knowledge.ts';
import { definitionAt, literalText, membersOf, tableKey, Types, type ValueType } from '../../../../src/server/hover/receiver.ts';
import { parseDocument } from '../../../../src/server/syntax/document.ts';

/** The type of the receiver of the outermost call of the last statement: `x` in a final `x:f()` or `x.f()`. */
function typeOfLastReceiver(text: string, library: Library = LUA52): string | undefined {
  const document = parseDocument(text, 'lua');
  const last = document.chunks[0]?.tree.body.body.at(-1);
  assert.ok(last?.kind === 'CallStatement', 'the last statement is not a call');
  const { call } = last;
  const receiver = call.kind === 'MethodCallExpression' ? call.base : call.base.kind === 'MemberExpression' ? call.base.base : undefined;
  assert.ok(receiver, 'no receiver');
  return summary(new Types(document, library).of(0, receiver));
}

function summary(type: ValueType | undefined): string | undefined {
  switch (type?.kind) {
    case undefined:
      return undefined;
    case 'string':
      return 'string';
    case 'object':
      return `object ${type.type}`;
    case 'module':
      return `module ${type.module}`;
    case 'table':
      return type.table.root === 'global' ? `global ${type.table.path.join('.')}` : `local ${[type.table.declaration.name, ...type.table.fields].join('.')}`;
  }
}

describe('server/hover/receiver', () => {
  it('reads the text of string literals without escapes', () => {
    assert.equal(literalText('"ffi"'), 'ffi');
    assert.equal(literalText("'string.buffer'"), 'string.buffer');
    assert.equal(literalText('[[ffi]]'), 'ffi');
    assert.equal(literalText('[==[\nffi]==]'), 'ffi');
    assert.equal(literalText('"f\\102i"'), undefined, 'escapes are not decoded');
    assert.equal(literalText('"a\'b"'), "a'b");
  });

  it('types values only when the code or an annotation proves it', () => {
    assert.equal(typeOfLastReceiver('local s = "x" s:f()'), 'string');
    assert.equal(typeOfLastReceiver('local s = "x" local t = s t:f()'), 'string');
    assert.equal(typeOfLastReceiver('local s = "x" s = 2 s:f()'), undefined);
    assert.equal(typeOfLastReceiver('local M = {} M:f()'), 'local M');
    assert.equal(typeOfLastReceiver('local M = {} M.sub:f()'), 'local M.sub');
    assert.equal(typeOfLastReceiver('Obj.sub:f()'), 'global Obj.sub');
    assert.equal(typeOfLastReceiver('local a = b local b = a b:f()'), 'global b', 'the first a reads the global b');
    assert.equal(typeOfLastReceiver('local x = f() x:f()'), undefined);
  });

  it('types require results and documented constructors with LuaJIT only', () => {
    const buffer = 'local b = require("string.buffer") local o = b.new() ';
    assert.equal(typeOfLastReceiver(`${buffer}o:put()`, LUAJIT), 'object string.buffer');
    assert.equal(typeOfLastReceiver(`${buffer}o:put():put()`, LUAJIT), 'object string.buffer');
    assert.equal(typeOfLastReceiver(`${buffer}o:get():put()`, LUAJIT), undefined, 'get returns strings');
    assert.equal(typeOfLastReceiver('local f = require("ffi") f.new()', LUAJIT), 'module ffi');
    assert.equal(typeOfLastReceiver('local f = require("ffi") f.new()'), undefined);
    assert.equal(typeOfLastReceiver('local f = require("io") f.write()', LUAJIT), undefined, 'not documented');
  });

  it('identifies a table by its root and fields', () => {
    const document = parseDocument('local M = {} function M:a() end function M.b() end M.c = function() end', 'lua');
    const members = membersOf(document, LUA52, { root: 'global', path: ['_G', 'X'] });
    assert.deepEqual(members, []);
    assert.equal(tableKey({ root: 'global', path: ['_G', 'X'] }), tableKey({ root: 'global', path: ['X'] }));
    const declaration = document.chunks[0]?.scopes.declarations[0];
    assert.ok(declaration);
    assert.deepEqual(
      membersOf(document, LUA52, { root: 'local', declaration, fields: [] }).map((m) => `${m.owner}${m.method ? ':' : '.'}${m.name}`),
      ['M:a', 'M.b', 'M.c'],
    );
    const text = document.text;
    assert.equal(definitionAt(document, LUA52, text.indexOf('b()') + 1)?.definition.name, 'b');
    assert.equal(definitionAt(document, LUA52, text.indexOf('local')), undefined);
  });
});
