-- Method calls, varargs and nested functions.
local Obj = {}
function Obj:new(...)
  local o = setmetatable({ n = select('#', ...) }, { __index = self })
  return o
end
function Obj.static(x) return function(y) return x + y end end
return Obj:new(1, 2):static()(3)
