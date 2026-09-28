-- Studio playtest: walk up to the nearest belt satellite and hold its Buy prompt.
-- Needs cash first (Debug:Invoke(player, {cash = 1e6}) on the server).
local player = game:GetService("Players").LocalPlayer
local root = player.Character:WaitForChild("HumanoidRootPart") :: BasePart
local before = player:GetAttribute("Used")
local best, bestDist = nil, math.huge
for _, m in workspace.BeltSatellites:GetChildren() do
	local x = m:GetPivot().Position.X
	if x > -120 and x < 100 and math.abs(x) < bestDist then
		best, bestDist = m, math.abs(x)
	end
end
assert(best, "no belt satellite")
local prompt = best:FindFirstChild("Buy", true) :: ProximityPrompt
assert(prompt, "no Buy prompt")
root.CFrame = CFrame.new(best:GetPivot().Position + Vector3.new(0, -1, 6))
task.wait(0.3)
root.CFrame = CFrame.new(best:GetPivot().Position + Vector3.new(0, -1, 6))
task.wait(0.1)
prompt:InputHoldBegin()
task.wait(prompt.HoldDuration + 0.2)
prompt:InputHoldEnd()
task.wait(1)
return `bought {best:GetAttribute("SatId")}: used {before} -> {player:GetAttribute("Used")}, cash {player:GetAttribute("Cash")}`
