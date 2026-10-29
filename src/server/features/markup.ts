import { MarkupKind } from 'vscode-languageserver/node';
import type { HoverFormat } from '../hover/render.ts';

/**
 * The format to answer in, from a client's list of supported formats in order
 * of preference (`hover.contentFormat`, `completionItem.documentationFormat`):
 * the first one the server can produce; plain text when the client lists none,
 * which every client can display.
 */
export function markupFormat(formats: readonly string[] | undefined): HoverFormat {
  const supported = formats?.find((kind) => kind === MarkupKind.Markdown || kind === MarkupKind.PlainText);
  return supported === MarkupKind.Markdown ? 'markdown' : 'plaintext';
}
