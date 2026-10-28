import type { CancellationToken, Connection, Diagnostic, TextDocuments } from 'vscode-languageserver/node';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { DIAGNOSTIC_SOURCE, ValidateDocumentRequest, type ValidateDocumentResult } from '../../shared/protocol.ts';
import { validatesOnSave, validatesOnType } from '../../shared/settings.ts';
import type { SettingsStore } from '../settingsStore.ts';
import { Debouncer, type Timers } from '../validation/debouncer.ts';
import type { Lua52Checker } from '../validation/lua52.ts';
import { documentKind, validateText } from '../validation/validateText.ts';

export interface DiagnosticsDeps {
  readonly lua: Promise<Lua52Checker>;
  readonly settings: SettingsStore;
  readonly timers: Timers;
}

/**
 * Publishes syntax diagnostics according to `ieLua.validate.mode`:
 *
 * | mode          | on open/edit (debounced) | on save | `ieLua/validateDocument` |
 * | ------------- | ------------------------ | ------- | ------------------------ |
 * | `manual`      |                          |         | ✓                        |
 * | `save`        |                          | ✓       | ✓                        |
 * | `type`        | ✓                        |         | ✓                        |
 * | `saveAndType` | ✓                        | ✓       | ✓                        |
 */
export function register(connection: Connection, documents: TextDocuments<TextDocument>, deps: DiagnosticsDeps): void {
  const debouncer = new Debouncer<string>(deps.timers);
  /** Document version whose diagnostics were last published, per URI. */
  const published = new Map<string, number>();

  const publish = async (uri: string, token?: CancellationToken): Promise<ValidateDocumentResult> => {
    const lua = await deps.lua;
    const document = documents.get(uri);
    if (!document || token?.isCancellationRequested) {
      return { validated: false, diagnosticCount: 0 };
    }
    const diagnostics: Diagnostic[] = validateText(document.getText(), documentKind(uri, document.languageId), lua).map((problem) => ({
      range: { start: document.positionAt(problem.start), end: document.positionAt(problem.end) },
      severity: DiagnosticSeverity.Error,
      source: DIAGNOSTIC_SOURCE,
      code: problem.code,
      message: problem.message,
    }));
    // The document may have been closed while awaiting; don't resurrect its diagnostics.
    if (documents.get(uri) !== document) {
      return { validated: false, diagnosticCount: 0 };
    }
    published.set(uri, document.version);
    await connection.sendDiagnostics({ uri, version: document.version, diagnostics });
    return { validated: true, diagnosticCount: diagnostics.length };
  };

  const report = (uri: string) => (error: unknown) => {
    connection.console.error(`Validating ${uri} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  };

  documents.onDidChangeContent(({ document }) => {
    const { uri } = document;
    deps.settings
      .get(uri)
      .then(({ validate }) => {
        if (validatesOnType(validate.mode)) {
          debouncer.schedule(uri, validate.debounce, () => {
            publish(uri).catch(report(uri));
          });
        }
      })
      .catch(report(uri));
  });

  documents.onDidSave(({ document }) => {
    const { uri } = document;
    deps.settings
      .get(uri)
      .then(async ({ validate }) => {
        if (validatesOnSave(validate.mode) && published.get(uri) !== document.version) {
          debouncer.cancel(uri);
          await publish(uri);
        }
      })
      .catch(report(uri));
  });

  documents.onDidClose(({ document }) => {
    const { uri } = document;
    debouncer.cancel(uri);
    published.delete(uri);
    deps.settings.forget(uri);
    connection.sendDiagnostics({ uri, diagnostics: [] }).catch(report(uri));
  });

  connection.onRequest(ValidateDocumentRequest, async ({ uri }, token) => {
    try {
      debouncer.cancel(uri);
      return await publish(uri, token);
    } catch (error) {
      report(uri)(error);
      return { validated: false, diagnosticCount: 0 };
    }
  });

  connection.onDidChangeConfiguration(({ settings }) => {
    deps.settings.changed(settings);
    // A switch to a `type` mode should take effect without waiting for the next edit.
    for (const document of documents.all()) {
      const { uri } = document;
      deps.settings
        .get(uri)
        .then(({ validate }) => {
          if (validatesOnType(validate.mode) && published.get(uri) !== document.version) {
            debouncer.schedule(uri, validate.debounce, () => {
              publish(uri).catch(report(uri));
            });
          }
        })
        .catch(report(uri));
    }
  });

  connection.onShutdown(() => {
    debouncer.dispose();
  });
}
