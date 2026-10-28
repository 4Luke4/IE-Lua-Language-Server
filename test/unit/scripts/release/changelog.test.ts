import assert from 'node:assert/strict';
import { promoteUnreleased, releaseBody, unreleasedBody } from '../../../../scripts/release/changelog.mts';

const REPO = 'https://github.com/o/r';
const FIRST = `# Changelog

## [Unreleased]

### Added

- Syntax diagnostics.

[Unreleased]: ${REPO}/commits/main
`;

describe('scripts/release/changelog', () => {
  it('reads the Unreleased body', () => {
    assert.equal(unreleasedBody(FIRST), '### Added\n\n- Syntax diagnostics.');
    assert.equal(unreleasedBody('# Changelog\n'), undefined);
    assert.equal(unreleasedBody('## [Unreleased]\n\n## [0.1.0] - 2026-01-01\n- x\n'), '');
  });

  it('promotes Unreleased for a first release', () => {
    const promoted = promoteUnreleased(FIRST, '0.1.0', '2026-10-28', REPO, undefined);
    assert.equal(
      promoted,
      `# Changelog

## [Unreleased]

## [0.1.0] - 2026-10-28

### Added

- Syntax diagnostics.

[Unreleased]: ${REPO}/compare/v0.1.0...HEAD
[0.1.0]: ${REPO}/releases/tag/v0.1.0
`,
    );
    assert.equal(unreleasedBody(promoted), '');
    assert.equal(releaseBody(promoted, '0.1.0'), '### Added\n\n- Syntax diagnostics.');
  });

  it('keeps older sections and links in order on later releases', () => {
    const first = promoteUnreleased(FIRST, '0.1.0', '2026-10-28', REPO, undefined).replace(
      '## [Unreleased]\n',
      '## [Unreleased]\n\n### Fixed\n\n- A crash.\n',
    );
    const second = promoteUnreleased(first, '0.1.1', '2026-11-02', REPO, 'v0.1.0');
    assert.equal(releaseBody(second, '0.1.1'), '### Fixed\n\n- A crash.');
    assert.equal(releaseBody(second, '0.1.0'), '### Added\n\n- Syntax diagnostics.');
    assert.match(
      second,
      new RegExp(`\\[Unreleased\\]: ${REPO}/compare/v0\\.1\\.1\\.\\.\\.HEAD\\n\\[0\\.1\\.1\\]: ${REPO}/compare/v0\\.1\\.0\\.\\.\\.v0\\.1\\.1\\n\\[0\\.1\\.0\\]: ${REPO}/releases/tag/v0\\.1\\.0\\n$`),
    );
  });

  it('refuses a changelog without an Unreleased heading', () => {
    assert.throws(() => promoteUnreleased('# Changelog\n', '1.0.0', '2026-01-01', REPO, undefined), /Unreleased/);
  });
});
