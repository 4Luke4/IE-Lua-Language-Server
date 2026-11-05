-- Original fixture: LuaCATS doc comments.

--- Builds a greeting.
---@param name string Who to greet.
---@param times? integer
---@return string greeting # The text.
local function greet(name, times)
	return string.rep("Hello, " .. name .. "! ", times or 1)
end

---@type integer
DocCounter = 0

---@param missing string
---@param name string
---@param name string
---@return
function DocRefresh(name)
	DocCounter = DocCounter + 1
	return greet(name)
end
