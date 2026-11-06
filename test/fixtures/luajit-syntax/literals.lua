-- LuaJIT number and string syntax that Lua 5.2 does not have.
local a, b, c = 1LL, 0x10ULL, 18446744073709551615ULL
local i = 3i + 2.5I
local bin = 0b1011
local s = "\u{48}\u{20AC}\u{10FFFF}"
local h = 0x1.8p4
return a, b, c, i, bin, s, h
