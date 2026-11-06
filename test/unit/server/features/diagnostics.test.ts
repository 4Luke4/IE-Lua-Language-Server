import assert from 'node:assert/strict';
import type { Connection, PublishDiagnosticsParams, TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ValidateDocumentRequest, type ValidateDocumentResult } from '../../../../src/shared/protocol.ts';
import { DEFAULT_SETTINGS, type IeLuaSettings, type Runtime, type ValidateMode } from '../../../../src/shared/settings.ts';
import { ParsedDocumentCache } from '../../../../src/server/documentCache.ts';
import { register, type DiagnosticsDeps } from '../../../../src/server/features/diagnostics.ts';
import { createMessages } from '../../../../src/server/l10n.ts';
import type { SettingsStore } from '../../../../src/server/settingsStore.ts';
import type { LuaChecker } from '../../../../src/server/validation/checker.ts';
import { loadLua52 } from '../../../../src/server/validation/lua52.ts';
import { loadLuaJit } from '../../../../src/server/validation/luajit.ts';

type Handler = (params: { uri: string }, token: undefined) => Promise<ValidateDocumentResult>;

/** The members of Connection and TextDocuments that diagnostics.register uses, recorded. */
class Harness {
  readonly sent: PublishDiagnosticsParams[] = [];
  private waiting: ((params: PublishDiagnosticsParams) => void)[] = [];
  private request: Handler | undefined;
  readonly documents = new Map<string, TextDocument>();
  settings: IeLuaSettings = DEFAULT_SETTINGS;
  readonly requestedRuntimes: Runtime[] = [];

  readonly connection = {
    sendDiagnostics: (params: PublishDiagnosticsParams): Promise<void> => {
      this.sent.push(params);
      const waiting = this.waiting;
      this.waiting = [];
      for (const resolve of waiting) resolve(params);
      return Promise.resolve();
    },
    onRequest: (type: unknown, handler: Handler): void => {
      assert.equal(type, ValidateDocumentRequest);
      this.request = handler;
    },
    onShutdown: (): void => undefined,
    console: { error: (message: string): void => { assert.fail(message); } },
  };

  readonly textDocuments = {
    get: (uri: string): TextDocument | undefined => this.documents.get(uri),
    all: (): TextDocument[] => [...this.documents.values()],
    onDidChangeContent: (): void => undefined,
    onDidSave: (): void => undefined,
    onDidClose: (): void => undefined,
  };

  readonly store = {
    get: (): Promise<IeLuaSettings> => Promise.resolve(this.settings),
    changed: (): void => undefined,
    forget: (): void => undefined,
  };

  /** The diagnostics the next sendDiagnostics call publishes. */
  next(): Promise<PublishDiagnosticsParams> {
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  validate(uri: string): Promise<ValidateDocumentResult> {
    assert.ok(this.request, 'ieLua/validateDocument handler registered');
    return this.request({ uri }, undefined);
  }
}

describe('server/features/diagnostics', () => {
  let lua52: LuaChecker;
  let luajit: LuaChecker;
  before(async () => {
    [lua52, luajit] = await Promise.all([loadLua52(), loadLuaJit()]);
  });

  const setup = (mode: ValidateMode, runtime: Runtime) => {
    const harness = new Harness();
    harness.settings = { validate: { mode, debounce: 300 }, runtime: { lua: runtime } };
    const deps: DiagnosticsDeps = {
      checker: (requested) => {
        harness.requestedRuntimes.push(requested);
        return Promise.resolve(requested === 'luajit' ? luajit : lua52);
      },
      cache: new ParsedDocumentCache(),
      messages: createMessages('en'),
      settings: harness.store as unknown as SettingsStore,
      // Debounced checks never fire: these tests drive publishing explicitly.
      timers: { setTimeout: () => 0, clearTimeout: () => undefined },
    };
    const feature = register(harness.connection as unknown as Connection, harness.textDocuments as unknown as TextDocuments<TextDocument>, deps);
    return { harness, feature };
  };

  const open = (harness: Harness, text: string): string => {
    const uri = 'file:///w/a.lua';
    harness.documents.set(uri, TextDocument.create(uri, 'lua', 1, text));
    return uri;
  };

  it('checks syntax with the compiler of the document’s ieLua.runtime.lua', async () => {
    const asLua52 = setup('save', 'lua52');
    const uri = open(asLua52.harness, 'local n = 1LL\n');
    assert.deepEqual(await asLua52.harness.validate(uri), { validated: true, diagnosticCount: 1 });
    assert.deepEqual(asLua52.harness.requestedRuntimes, ['lua52']);

    const asLuaJit = setup('save', 'luajit');
    open(asLuaJit.harness, 'local n = 1LL\n');
    assert.deepEqual(await asLuaJit.harness.validate(uri), { validated: true, diagnosticCount: 0 });
    assert.deepEqual(asLuaJit.harness.requestedRuntimes, ['luajit']);
  });

  it('reports LuaJIT’s message, with its end of chunk at the end of the document', async () => {
    const { harness } = setup('save', 'luajit');
    const text = 'function f()\n  return 1\n';
    const uri = open(harness, text);
    await harness.validate(uri);
    const [diagnostic] = harness.sent.at(-1)?.diagnostics ?? [];
    assert.equal(diagnostic?.message, "'end' expected (to close 'function' at line 1) near '<eof>'");
    assert.deepEqual(diagnostic.range, { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } });
  });

  for (const mode of ['manual', 'save', 'type', 'saveAndType'] as const) {
    it(`checks a published document again when the runtime changes (${mode} mode)`, async () => {
      const { harness, feature } = setup(mode, 'lua52');
      const uri = open(harness, 'local n = 1LL\n');
      await harness.validate(uri);
      assert.equal(harness.sent.at(-1)?.diagnostics.length, 1);
      harness.settings = { ...harness.settings, runtime: { lua: 'luajit' } };
      const republished = harness.next();
      feature.configurationChanged({});
      assert.deepEqual((await republished).diagnostics, []);
      assert.deepEqual(harness.requestedRuntimes, ['lua52', 'luajit']);
    });
  }

  it('does not check a document again when the runtime stays the same (save mode)', async () => {
    const { harness, feature } = setup('save', 'lua52');
    const uri = open(harness, 'local n = 1LL\n');
    await harness.validate(uri);
    feature.configurationChanged({});
    // Let the settings lookups and any publish they start run.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.sent.length, 1);
  });

  it('does not check a document that was never published when the runtime changes (save mode)', async () => {
    const { harness, feature } = setup('save', 'lua52');
    open(harness, 'local n = 1LL\n');
    harness.settings = { ...harness.settings, runtime: { lua: 'luajit' } };
    feature.configurationChanged({});
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(harness.sent, []);
    assert.deepEqual(harness.requestedRuntimes, []);
  });
});
