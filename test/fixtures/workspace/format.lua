-- Original fixture: formatting. Deliberately unformatted.
local function fmtScale(value,factor)
local result=value*factor
      if result>10 then
return - result
    else
return result
end
end

FmtTable={1,2 ;name="n",[ "k" ]=fmtScale(2,3)}
