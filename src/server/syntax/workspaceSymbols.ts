// Query matching for workspace symbols. Pure: no LSP or `vscode` imports.

/**
 * Whether `name` matches a `workspace/symbol` query. LSP 3.17 asks servers to
 * interpret the query "in a relaxed way as editors will apply their own
 * highlighting and scoring on the results", and gives the rule of thumb used here:
 * match case-insensitively, and check that the characters of the query appear in
 * their order in the name. An empty query matches everything.
 */
export function matchesQuery(name: string, query: string): boolean {
  if (query === '') return true;
  const haystack = name.toLowerCase();
  let from = 0;
  for (const c of query.toLowerCase()) {
    const at = haystack.indexOf(c, from);
    if (at < 0) return false;
    from = at + c.length;
  }
  return true;
}
