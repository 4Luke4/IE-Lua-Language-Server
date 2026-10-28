# Emacs

Uses **Eglot**, built into Emacs 29 and later
([Eglot manual](https://www.gnu.org/software/emacs/manual/html_mono/eglot.html)).
First complete [the common steps](README.md) to get `server.js`.

Add to your init file:

```elisp
;; A minimal major mode for Infinity Engine .menu files.
(define-derived-mode ie-menu-mode prog-mode "IE-Menu"
  "Major mode for Infinity Engine .menu files.")
(add-to-list 'auto-mode-alist '("\\.menu\\'" . ie-menu-mode))

(with-eval-after-load 'eglot
  (add-to-list 'eglot-server-programs
               '((lua-mode lua-ts-mode ie-menu-mode)
                 . ("node" "/path/to/server.js" "--stdio"))))

;; Optional: settings sent to the server (workspace/configuration).
(setq-default eglot-workspace-configuration
              '(:ieLua (:validate (:mode "saveAndType"))))
```

`lua-ts-mode` is built into Emacs 30; `lua-mode` is available from MELPA. Start the server in
a buffer with `M-x eglot`, or add `(add-hook 'lua-ts-mode-hook #'eglot-ensure)` (and the same for
your other modes) to start it automatically. Diagnostics are shown with Flymake
(`M-x flymake-show-buffer-diagnostics`).
