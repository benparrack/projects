-- Studio playtest (after buy.client.luau): step on slot 1's collect plate, then on the lock plate.
local player = game:GetService("Players").LocalPlayer
local root = player.Character:WaitForChild("HumanoidRootPart") :: BasePart
local base = workspace.Map:FindFirstChild("Base" .. player:GetAttribute("BaseIndex"))
local plates = {}
for _, d in base:GetDescendants() do
	if d.Name == "Collect" then
		table.insert(plates, d)
	end
end
table.sort(plates, function(a, b)
	return (a :: BasePart).Position.X < (b :: BasePart).Position.X
end)
task.wait(3)
local cash0 = player:GetAttribute("Cash")
local out = {}
for _, plate in plates do
	root.CFrame = (plate :: BasePart).CFrame + Vector3.new(0, 3, 0)
	task.wait(0.4)
	local c = player:GetAttribute("Cash")
	if c ~= cash0 then
		table.insert(out, `collect +{c - cash0}`)
		break
	end
end
if #out == 0 then
	table.insert(out, "collect: no cash change")
end
local lock = base:FindFirstChild("LockPlate", true) :: BasePart
root.CFrame = lock.CFrame + Vector3.new(0, 3, 0)
task.wait(1)
table.insert(out, `lockedUntil={player:GetAttribute("LockedUntil")} now={workspace:GetServerTimeNow()}`)
root.CFrame = CFrame.new(base:GetPivot().Position + Vector3.new(0, 4, 0))
return table.concat(out, "; ")
