/*
 * Parse-only entry point around the official Lua 5.2.4 compiler front end.
 *
 * `ie_validate` compiles a chunk with luaL_loadbufferx() exactly as `luac -p`
 * does, and never runs it: no standard library is opened and the compiled
 * function is popped straight away. Only text chunks are accepted ("t" mode),
 * so precompiled bytecode cannot be loaded.
 *
 * Copyright (c) 2026 4Luke4. All rights reserved. See LICENSE.md.
 * Lua itself: Copyright (C) 1994-2015 Lua.org, PUC-Rio (MIT, see THIRD_PARTY_NOTICES.md).
 */
#include <stddef.h>
#include <emscripten/emscripten.h>

#include "lua.h"
#include "lauxlib.h"

static lua_State *state = NULL;

/*
 * Returns NULL when `source` is syntactically valid Lua 5.2. Otherwise returns
 * the compiler message, e.g. `chunk:3: 'end' expected near <eof>`. The string
 * is owned by the Lua state and stays valid until the next call.
 * Returns the literal "<state>" if the Lua state cannot be created.
 */
EMSCRIPTEN_KEEPALIVE
const char *ie_validate(const char *source, size_t length, const char *chunkname) {
  if (state == NULL) {
    state = luaL_newstate();
    if (state == NULL) {
      return "<state>";
    }
  }
  lua_settop(state, 0);
  if (luaL_loadbufferx(state, source, length, chunkname, "t") == LUA_OK) {
    lua_settop(state, 0);
    return NULL;
  }
  return lua_tostring(state, -1);
}
