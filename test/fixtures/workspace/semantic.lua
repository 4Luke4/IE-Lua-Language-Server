-- Original fixture: semantic tokens.
local function scale(value, factor)
	local result = value * factor
	return result
end

SemanticTotal = scale(2, 3)
local label = string.format("%d", SemanticTotal)
Infinity_DisplayString(label)
