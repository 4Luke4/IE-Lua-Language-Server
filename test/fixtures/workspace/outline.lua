-- Original fixture: document symbols and folding.
local settings = {
	speed = 2,
	reset = function() end,
}

--[[
Block comment
spanning lines.
]]
function Panel:open(id)
	if id then
		return id
	else
		return 0
	end
end
