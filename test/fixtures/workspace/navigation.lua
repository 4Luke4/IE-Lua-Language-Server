-- Original fixture: go to definition, find references and rename.
local counter = 0

function increment(step)
	counter = counter + step
	return counter
end

local Panel = {}

function Panel:open()
	return self
end

increment(1)
print(counter)
