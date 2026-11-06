/*
 * Parse-only entry point around LuaJIT's own lexer and parser, as built by EEex's
 * "Use LuaJIT" component (Bubb13/InfinityLoader's LuaJIT, see build.mts).
 *
 * `ie_validate` compiles a chunk with luaL_loadbufferx() and never runs it. Only text
 * chunks are accepted, so precompiled bytecode cannot be loaded.
 *
 * LuaJIT's interpreter is generated assembly (buildvm + vm_*.dasc), which has no
 * WebAssembly target. Every LuaJIT C file is compiled unchanged; this file replaces the
 * assembly part (lj_vm.o) with C, and only to the extent loading a chunk needs:
 *
 * - lj_vm_cpcall and lj_vm_unwind_c are implemented with setjmp/longjmp, following
 *   ->vm_cpcall, ->vm_leave_cp, ->vm_unwind_c and ->vm_unwind_c_eh of vm_x86.dasc. The C
 *   frame is written only through lj_frame.h's own cframe_* macros, so err_unwind() in
 *   lj_err.c reads it exactly as it reads the assembly's.
 * - The other entry points run Lua code or FFI calls, which never happens while a chunk
 *   is loaded. They stop the module with a message instead of guessing a behavior.
 * - lj_vm_asm_begin is only used as a base address (lj_dispatch.c, lj_lib.c); nothing
 *   jumps to it here.
 *
 * Copyright (c) 2026 4Luke4. All rights reserved. See LICENSE.md.
 * LuaJIT itself: Copyright (C) 2005-2025 Mike Pall (MIT, see THIRD_PARTY_NOTICES.md).
 */
#include <setjmp.h>
#include <stddef.h>
#include <stdint.h>
#include <math.h>
#include <stdlib.h>
#include <emscripten/console.h>
#include <emscripten/emscripten.h>

#include "lj_obj.h"
#include "lj_frame.h"
#include "lj_state.h"
#include "lj_vm.h"
#include "lj_ccall.h"
#include "lj_ccallback.h"
#include "lauxlib.h"
#include "lualib.h"

/* The words vm_x86.dasc keeps from esp upwards (SAVE_* defines, non-Windows ABI):
 * CFRAME_OFS_ERRF is the highest offset used. */
#define SHIM_CFRAME_WORDS (CFRAME_OFS_ERRF / 4 + 1)

typedef struct ShimFrame {
  /* What esp points at in the assembly. 8-aligned: lj_frame.h keeps flags in the two
   * low bits of a C frame pointer (CFRAME_RESUME, CFRAME_UNWIND_FF). */
  _Alignas(8) uint32_t words[SHIM_CFRAME_WORDS];
  jmp_buf unwind;
  int status;
} ShimFrame;

_Noreturn static void shim_unreachable(const char *what) {
  emscripten_console_error(what);
  abort();
}

/* ->vm_cpcall: set up a protected C frame and call cp(L, func, ud). */
int lj_vm_cpcall(lua_State *L, lua_CFunction func, void *ud, lua_CPFunction cp) {
  /* volatile: read again after longjmp (C11 7.13.2.1). */
  ShimFrame frame;
  void *volatile cf = frame.words;
  lua_State *volatile state = L;
  TValue *base;
  setcframe_L(cf, L);
  setcframe_pc(cf, L);             /* SAVE_PC: "Any value outside of bytecode is ok." */
  cframe_errfunc(cf) = 0;           /* SAVE_ERRF: no error function. */
  cframe_nres(cf) = (int32_t)-savestack(L, L->top); /* "Neg. delta means cframe w/o frame." */
  cframe_prev(cf) = L->cframe;      /* SAVE_CFRAME: add our C frame to the chain. */
  L->cframe = cf;
  setgcref(G(L)->cur_L, obj2gco(L));
  if (setjmp(frame.unwind) == 0) {
    base = cp(L, func, ud);
    if (base != NULL) {
      /* The assembly would now call the Lua function at `base` (FRAME_CP). */
      shim_unreachable("LuaJIT shim: lj_vm_cpcall would run Lua code");
    }
    /* ->vm_leave_cp: restore the previous C frame; status 0. */
    L->cframe = cframe_prev(cf);
    return 0;
  }
  /* ->vm_unwind_c_eh. err_unwind() has already restored L->cframe and L->base. */
  G(state)->vmstate = ~LJ_VMST_C;
  return ((ShimFrame *)cf)->status;
}

/* ->vm_unwind_c: unwind the C stack to `cframe` and return `errcode` from its cpcall. */
void LJ_FASTCALL lj_vm_unwind_c(void *cframe, int errcode) {
  ShimFrame *frame = (ShimFrame *)((char *)cframe - offsetof(ShimFrame, words));
  frame->status = errcode;
  longjmp(frame->unwind, 1);
}

/* ->vm_unwind_ff: return from a fast-function pcall() frame; only Lua code has one. */
void LJ_FASTCALL lj_vm_unwind_ff(void *cframe) {
  (void)cframe;
  shim_unreachable("LuaJIT shim: lj_vm_unwind_ff needs the interpreter");
}

void lj_vm_call(lua_State *L, TValue *base, int nres1) {
  (void)L, (void)base, (void)nres1;
  shim_unreachable("LuaJIT shim: lj_vm_call needs the interpreter");
}

int lj_vm_pcall(lua_State *L, TValue *base, int nres1, ptrdiff_t ef) {
  (void)L, (void)base, (void)nres1, (void)ef;
  shim_unreachable("LuaJIT shim: lj_vm_pcall needs the interpreter");
  return 0;
}

void LJ_FASTCALL lj_vm_ffi_call(CCallState *cc) {
  (void)cc;
  shim_unreachable("LuaJIT shim: lj_vm_ffi_call needs the interpreter");
}

void lj_vm_ffi_callback(void) {
  shim_unreachable("LuaJIT shim: lj_vm_ffi_callback needs the interpreter");
}

void lj_vm_IITERN(void) {
  shim_unreachable("LuaJIT shim: lj_vm_IITERN needs the interpreter");
}

/* Metamethod continuations: lj_meta.c stores their address in a frame for the
 * interpreter to jump to when the metamethod returns. Loading runs no metamethod. */
void lj_cont_ra(void) {
  shim_unreachable("LuaJIT shim: lj_cont_ra needs the interpreter");
}

void lj_cont_nop(void) {
  shim_unreachable("LuaJIT shim: lj_cont_nop needs the interpreter");
}

/* ->vm_floor: IEEE 754 roundToIntegralTowardNegative, which C99 floor() is (F.9.6.2).
 * lj_vm.h itself maps lj_vm_floor to floor on PPC and ARM64. Used by constant folding
 * (lj_vmmath.c lj_vm_foldarith, for %). */
double lj_vm_floor(double x) {
  return floor(x);
}

/* Base address of the assembly; lj_bcdef.h's lj_bc_ofs are offsets from it. */
char lj_vm_asm_begin[1];

static lua_State *state = NULL;

/*
 * Opens the FFI library once and anchors it in the registry.
 *
 * The lexer needs the FFI's C type state for 64-bit integer and imaginary literals
 * (lj_lex.c lex_number, ctype_loadffi in lj_ctype.h). Opened on demand there, the
 * module is left unreferenced, and collecting its ffi.C userdata runs a __gc
 * metamethod (lj_gc.c gc_call_finalizer -> lj_vm_pcall), which needs the interpreter.
 * With the module kept alive, no object with a finalizer is ever collected, and
 * ctype_loadffi finds the C type state already set up. Which literals are accepted, and
 * the messages, do not change: lex_number reaches the same code either way. Runs in a
 * protected C frame, like cpparser in lj_load.c, and returns NULL, so nothing is called
 * afterwards.
 */
static TValue *cpopenffi(lua_State *L, lua_CFunction dummy, void *ud) {
  (void)dummy, (void)ud;
  luaopen_ffi(L);
  lua_setfield(L, LUA_REGISTRYINDEX, "ie_validate.ffi");
  return NULL;
}

static lua_State *newstate(void) {
  lua_State *L = luaL_newstate();
  if (L != NULL && lj_vm_cpcall(L, NULL, NULL, cpopenffi) != LUA_OK) {
    return NULL; /* Out of memory: report "<state>"; the state is not used. */
  }
  return L;
}

/*
 * Returns NULL when `source` is syntactically valid for LuaJIT. Otherwise returns the
 * parser's message, e.g. `chunk:3: 'end' expected near '<eof>'`. The string is owned by
 * the Lua state and stays valid until the next call. Returns the literal "<state>" if
 * the Lua state cannot be created.
 *
 * Mode "tX": `t` accepts text only. `X` makes the parser lay out frames in two slots,
 * as the x64 GC64 build that EEex installs does; this build is 32-bit, with one-slot
 * frames otherwise. lj_load.c cpparser: `if (c == (LJ_FR2 ? 'W' : 'X')) ls->fr2 =
 * !LJ_FR2;` (the `luajit -b -X` mechanism; `W` is the opposite switch, for builds with
 * two-slot frames). The register limits depend on it: `f(` with 248 arguments needs
 * one slot too many with two-slot frames only. The prototype is discarded.
 */
EMSCRIPTEN_KEEPALIVE
const char *ie_validate(const char *source, size_t length, const char *chunkname) {
  if (state == NULL) {
    state = newstate();
    if (state == NULL) {
      return "<state>";
    }
  }
  lua_settop(state, 0);
  if (luaL_loadbufferx(state, source, length, chunkname, "tX") == LUA_OK) {
    lua_settop(state, 0);
    return NULL;
  }
  return lua_tostring(state, -1);
}
