import type { CodeAction, CodeActionClientCapabilities, CodeActionParams, Connection, Diagnostic, Range, TextDocuments } from 'vscode-languageserver/node';
import { CodeActionKind } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { DIAGNOSTIC_SOURCE, FIX_ALL_KIND } from '../../shared/protocol.ts';
import { analyzeMenu, applyChecked, isFixableCode, type FixAction, type MenuFix, type MenuFixAnalysis, type TextChange } from '../codeActions/quickFixes.ts';
import type { Messages } from '../l10n.ts';
import { documentKind } from '../validation/validateText.ts';
import { toWorkspaceEdit } from './rename.ts';

export interface CodeActionDeps {
  readonly messages: Messages;
  /** `workspace.workspaceEdit.documentChanges` of the client: send versioned edits. */
  readonly documentChanges: boolean;
}

/** The kinds this server returns, as advertised in `codeActionProvider.codeActionKinds`. */
export const CODE_ACTION_KINDS = [CodeActionKind.QuickFix, FIX_ALL_KIND] as const;

/**
 * Whether the client accepts `CodeAction` literals. Without them a server can
 * only return `Command`s, which this server does not implement, so the
 * capability is not advertised.
 */
export function supportsCodeActionLiterals(literalSupport: CodeActionClientCapabilities['codeActionLiteralSupport']): boolean {
  return literalSupport !== undefined;
}

/**
 * Whether actions of `kind` are wanted. LSP: `only` filters by kind, and a
 * requested kind includes its sub-kinds (`source` includes `source.fixAll.ieLua`).
 * Without `only`, quick fixes are returned and source actions are not: clients
 * ask for source actions by kind (`editor.codeActionsOnSave`, *Source Action…*).
 */
export function wanted(kind: string, only: readonly string[] | undefined): boolean {
  if (only === undefined) return kind === CodeActionKind.QuickFix;
  return only.some((requested) => kind === requested || kind.startsWith(`${requested}.`));
}

const TITLE_KEYS: Readonly<Record<FixAction, 'codeAction.quote' | 'codeAction.insertSpace'>> = {
  quote: 'codeAction.quote',
  insertSpace: 'codeAction.insertSpace',
};

/**
 * Resolves `true` when the request should stop. Called between the diagnostics
 * of a request, each of which lexes the document again for its safety check.
 */
export type Pause = () => Promise<boolean>;

/**
 * The code actions for a .menu document (none for Lua files, which have no
 * fixable diagnostics), or a reason they were refused, for the log.
 *
 * - A quick fix for each diagnostic of `context.diagnostics` from this server
 *   whose code has a fix and whose problem is still in the current text, at
 *   exactly that range: a diagnostic of an older version (published on save,
 *   before later edits) gets none rather than an edit at the wrong place.
 * - With it, when the current text has more than one problem of that code, a
 *   quick fix for all of them.
 * - `source.fixAll.ieLua`: every fixable problem of the current text, whether
 *   or not its diagnostics were published (`ieLua.validate.mode` `manual`).
 *
 * Every set of changes passes the safety check of `applyChecked` first, which
 * lexes the edited document: `pause` is awaited before each further diagnostic,
 * so that a request for a selection with many diagnostics can be cancelled.
 * `undefined` when `pause` stopped the request.
 */
export async function codeActions(
  document: TextDocument,
  params: Pick<CodeActionParams, 'context'>,
  deps: CodeActionDeps,
  pause: Pause = () => Promise.resolve(false),
): Promise<{ actions: CodeAction[]; refused: string[] } | undefined> {
  const actions: CodeAction[] = [];
  const refused: string[] = [];
  if (documentKind(document.uri, document.languageId) !== 'menu') return { actions, refused };
  const { only } = params.context;
  const quickFixes = wanted(CodeActionKind.QuickFix, only);
  const fixAll = wanted(FIX_ALL_KIND, only);
  if (!quickFixes && !fixAll) return { actions, refused };

  const text = document.getText();
  const analysis: MenuFixAnalysis = analyzeMenu(text);
  const rangeOf = (start: number, end: number): Range => ({ start: document.positionAt(start), end: document.positionAt(end) });
  const edit = (changes: TextChange[]) =>
    toWorkspaceEdit(
      document,
      changes.map(({ start, end, newText }) => ({ range: rangeOf(start, end), newText })),
      deps.documentChanges,
    );
  const checked = (fixes: readonly MenuFix[], what: string): TextChange[] | undefined => {
    const changes = applyChecked(text, analysis, fixes);
    if (!changes) refused.push(what);
    return changes;
  };

  if (quickFixes) {
    /** The fixes by code and problem offsets, the identity of a diagnostic. */
    const byProblem = new Map(analysis.fixes.map((fix) => [problemKey(fix.problem.code, fix.problem.start, fix.problem.end), fix]));
    /** The fixes of each code, for its "fix all" action. */
    const byCode = new Map<string, MenuFix[]>();
    for (const fix of analysis.fixes) {
      const group = byCode.get(fix.problem.code);
      if (group) group.push(fix);
      else byCode.set(fix.problem.code, [fix]);
    }
    /** Codes whose "fix all" action was already added. */
    const allOffered = new Set<string>();
    let first = true;
    for (const diagnostic of params.context.diagnostics) {
      if (diagnostic.source !== DIAGNOSTIC_SOURCE || !isFixableCode(diagnostic.code)) continue;
      const fix = byProblem.get(problemKey(diagnostic.code, ...offsetsOf(document, diagnostic.range)));
      if (!fix) continue;
      if (!first && (await pause())) return undefined;
      first = false;
      const changes = checked([fix], `the ${fix.problem.code} fix at offset ${String(fix.problem.start)}`);
      if (changes) {
        actions.push({
          title: deps.messages.t(TITLE_KEYS[fix.action]),
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          isPreferred: true,
          edit: edit(changes),
        });
      }
      const sameCode = byCode.get(fix.problem.code) ?? [];
      if (sameCode.length > 1 && !allOffered.has(fix.problem.code)) {
        allOffered.add(fix.problem.code);
        const all = checked(sameCode, `the fixes of every ${fix.problem.code} problem`);
        if (all) {
          const diagnostics: Diagnostic[] = params.context.diagnostics.filter(
            (other) => other.source === DIAGNOSTIC_SOURCE && other.code === fix.problem.code,
          );
          actions.push({
            title: deps.messages.t('codeAction.fixAllOfCode', fix.problem.code),
            kind: CodeActionKind.QuickFix,
            diagnostics,
            edit: edit(all),
          });
        }
      }
    }
  }

  if (fixAll && analysis.fixes.length > 0) {
    const changes = checked(analysis.fixes, 'the fixes of every fixable problem');
    if (changes) {
      actions.push({ title: deps.messages.t('codeAction.fixAll'), kind: FIX_ALL_KIND, edit: edit(changes) });
    }
  }
  return { actions, refused };
}

function problemKey(code: string, start: number, end: number): string {
  return `${code}:${String(start)}:${String(end)}`;
}

/**
 * The offsets of a diagnostic's range, or `[-1, -1]` (matching no problem) when
 * the range is not a range of the current text, such as positions past the end
 * of a line, which `offsetAt` would clamp.
 */
function offsetsOf(document: TextDocument, range: Range): [number, number] {
  const start = document.offsetAt(range.start);
  const end = document.offsetAt(range.end);
  const exact = (offset: number, position: Range['start']) => {
    const back = document.positionAt(offset);
    return back.line === position.line && back.character === position.character;
  };
  return exact(start, range.start) && exact(end, range.end) ? [start, end] : [-1, -1];
}

/** `textDocument/codeAction` (see `codeActions`). */
export function register(connection: Connection, documents: TextDocuments<TextDocument>, deps: CodeActionDeps): void {
  connection.onCodeAction(async (params, token): Promise<CodeAction[] | null> => {
    try {
      const document = documents.get(params.textDocument.uri);
      if (!document || token.isCancellationRequested) {
        return null;
      }
      // Between diagnostics, let the cancellation (and edits) arrive. `TextDocuments`
      // updates a document in place, so an edit meanwhile shows as a new version, and
      // the actions computed for the old text are dropped.
      const { version } = document;
      const stale = (): boolean => token.isCancellationRequested || documents.get(document.uri)?.version !== version;
      const pause: Pause = () =>
        new Promise((resolve) => {
          setImmediate(() => {
            resolve(stale());
          });
        });
      const result = await codeActions(document, params, deps, pause);
      if (!result || stale()) {
        return null;
      }
      const { actions, refused } = result;
      for (const what of refused) {
        connection.console.error(`Code actions for ${params.textDocument.uri}: ${what} would change problems it does not fix; not offered.`);
      }
      return actions;
    } catch (error) {
      connection.console.error(`Code actions for ${params.textDocument.uri} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      return null;
    }
  });
}
