-- Original fixture: hover and completion of method calls.
local title = "menu"
local loud = title:upper()

---@class Counter
local Counter = {}

---Adds one and returns the new count.
function Counter:bump(step)
	return step
end

function Counter:twice()
	self:bump(1)
end

local w = worldScreen
w:CheckIfPaused()
return loud, Counter
