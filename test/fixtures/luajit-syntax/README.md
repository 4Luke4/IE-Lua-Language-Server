# LuaJIT syntax corpus

Original fixtures for `third_party/luajit/differential.mts`, which checks every file here (and
the boundary cases it generates) with a native x64 LuaJIT built from the pinned sources and with
the WebAssembly module, and fails on any difference. Valid and invalid chunks alike: what matters
is that both builds answer the same.
