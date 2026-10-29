-- Original fixture: completion.
local function tally(items)
	local total = 0
	for _, item in ipairs(items) do
		total = total + item
	end
	return total
end

CompletionCounter = 0

function CompletionReport(prefix)
	local line = prefix .. tostring(CompletionCounter)
	local width = string.len(line)
	C:AddGold(width)
	-- A comment mentioning prefix.
	Infinity_DisplayString("prefix " .. line)
end
