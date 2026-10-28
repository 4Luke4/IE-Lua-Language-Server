# Security Policy

## Supported versions

Security fixes go only into the **latest stable release** and the **latest
pre-release** published on
[GitHub Releases](https://github.com/4Luke4/IE-Lua-Language-Server/releases).
Older versions are not patched; please upgrade.

| Version                     | Supported          |
| --------------------------- | ------------------ |
| Latest stable (even minor)  | :white_check_mark: |
| Latest pre-release (odd minor) | :white_check_mark: |
| Anything older              | :x:                |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub's
[private vulnerability reporting](https://github.com/4Luke4/IE-Lua-Language-Server/security/advisories/new)
(*Security* tab → *Report a vulnerability*). Include:

- the affected version (see *Extensions* view → *IE Lua Language Server*);
- your editor and operating system;
- steps to reproduce, ideally with a minimal `.lua` or `.menu` file;
- the impact you observed or expect.

### What to expect

- **Acknowledgement** of your report within 7 days.
- **Status updates** at least every 14 days until it is resolved.
- If the report is **accepted**, a fix ships in a new release and the advisory
  is published with credit to you, unless you ask to stay anonymous.
- If the report is **declined**, you get an explanation of why.

## Scope

The extension runs a local language server that reads files in your workspace.
It makes no network requests at runtime. Problems in third-party components
(see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)) should also be reported
upstream.
