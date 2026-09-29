-- Studio playtest: take the elevator, then walk the real triggers.
-- Goes forward through the EXIT once, then turns back to the STAIRS once. Each choice
-- must move the floor, either up by one or back to 0.
local player = game:GetService("Players").LocalPlayer
local root = player.Character:WaitForChild("HumanoidRootPart") :: BasePart
local function at(x: number, z: number, o: CFrame?)
	root.CFrame = (o or CFrame.identity) * CFrame.new(x, 3.2, z)
	task.wait(0.4)
end
local function waitFloorChange(before: number): number
	local t = os.clock()
	while player:GetAttribute("Floor") == before and os.clock() - t < 5 do
		task.wait(0.1)
	end
	task.wait(1.6) -- blackout + re-dress
	return player:GetAttribute("Floor") :: number
end

if player:GetAttribute("InShift") ~= true then
	at(0, -30.5)
	local t = os.clock()
	while player:GetAttribute("InShift") ~= true and os.clock() - t < 5 do
		task.wait(0.1)
	end
	task.wait(1.6)
end
assert(player:GetAttribute("InShift") == true, "elevator didn't start a shift")
local o = CFrame.new(1200 + ((player:GetAttribute("Corridor") :: number) - 1) * 260, 0, 0)
local log = {}

local f0 = player:GetAttribute("Floor") :: number
at(0, 60, o)
at(0, 157, o)
at(27, 157, o)
local f1 = waitFloorChange(f0)
table.insert(log, `forward {f0}->{f1}`)
assert(f1 == f0 + 1 or f1 == 0, "forward didn't change floor")

at(0, 40, o)
at(0, 0, o)
local f2 = waitFloorChange(f1)
table.insert(log, `back {f1}->{f2}`)
assert(f2 == f1 + 1 or f2 == 0, "back didn't change floor")
return table.concat(log, ", ")
