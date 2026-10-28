// https://commitlint.js.org — enforces Conventional Commits 1.0.0 (see .gitmessage).
/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Bodies may contain long URLs and wrapped lists; keep the 100-column guidance in .gitmessage.
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
