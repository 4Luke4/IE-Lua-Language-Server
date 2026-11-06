-- goto, labels and the empty statement (LUAJIT_ENABLE_LUA52COMPAT).
for i = 1, 3 do
  if i == 2 then goto continue end
  ;;
  ::continue::
end
local t = { 1, 2, 3 }
return #t, "\z
          continued", "\x41"
