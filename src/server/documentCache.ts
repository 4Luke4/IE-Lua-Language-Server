import { parseDocument, type ParsedDocument } from './syntax/document.ts';
import { documentKind } from './validation/validateText.ts';

/** The parts of an LSP `TextDocument` the cache needs. */
export interface VersionedDocument {
  readonly uri: string;
  readonly languageId: string;
  readonly version: number;
  getText(): string;
}

/**
 * Parse results per document, keyed by URI and reused while the version is
 * unchanged, so that every feature parses a document version at most once.
 * Call `delete` when the document is closed.
 */
export class ParsedDocumentCache {
  private readonly entries = new Map<string, { readonly version: number; readonly parsed: ParsedDocument }>();

  get(document: VersionedDocument): ParsedDocument {
    const cached = this.entries.get(document.uri);
    if (cached?.version === document.version) {
      return cached.parsed;
    }
    const parsed = parseDocument(document.getText(), documentKind(document.uri, document.languageId));
    this.entries.set(document.uri, { version: document.version, parsed });
    return parsed;
  }

  delete(uri: string): void {
    this.entries.delete(uri);
  }

  /** Number of cached documents (for logging and tests). */
  get size(): number {
    return this.entries.size;
  }
}
