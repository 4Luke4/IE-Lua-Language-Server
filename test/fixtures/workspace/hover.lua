-- Original fixture: hover.
local function greet(name, ...)
	local message = string.format("Hello, %s", name)
	print(message)
	return message
end

for index = 1, 3 do
	greet(tostring(index))
end

function Refresh(force)
	Infinity_DisplayString("refresh")
end

local function shadowed()
	local string = { format = greet }
	return string.format("x")
end
