import assert from 'node:assert/strict';
import { markupFormat } from '../../../../src/server/features/markup.ts';

describe('server/features/markup markupFormat', () => {
  it('answers in the first format the client prefers that the server produces', () => {
    assert.equal(markupFormat(['markdown', 'plaintext']), 'markdown');
    assert.equal(markupFormat(['plaintext', 'markdown']), 'plaintext');
    assert.equal(markupFormat(['html', 'markdown']), 'markdown');
  });

  it('answers in plain text when the client lists no format it knows', () => {
    assert.equal(markupFormat(undefined), 'plaintext');
    assert.equal(markupFormat([]), 'plaintext');
    assert.equal(markupFormat(['html']), 'plaintext');
  });
});
