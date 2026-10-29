import assert from 'node:assert/strict';
import { hoverFormat } from '../../../../src/server/features/hover.ts';

describe('server/features/hover hoverFormat', () => {
  it('answers in the first format the client prefers that the server produces', () => {
    assert.equal(hoverFormat(['markdown', 'plaintext']), 'markdown');
    assert.equal(hoverFormat(['plaintext', 'markdown']), 'plaintext');
    assert.equal(hoverFormat(['html', 'markdown']), 'markdown');
  });

  it('answers in plain text when the client lists no format it knows', () => {
    assert.equal(hoverFormat(undefined), 'plaintext');
    assert.equal(hoverFormat([]), 'plaintext');
    assert.equal(hoverFormat(['html']), 'plaintext');
  });
});
