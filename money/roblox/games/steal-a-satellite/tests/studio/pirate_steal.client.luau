-- Studio playtest: steal from a space pirate base and carry it home.
local player = game:GetService("Players").LocalPlayer
local root = player.Character:WaitForChild("HumanoidRootPart") :: BasePart
local used0 = player:GetAttribute("Used")
local target: Model? = nil
for _, m in workspace.Map:GetDescendants() do
	if m:IsA("Model") and m:GetAttribute("OwnerId") == -1 then
		target = m
		break
	end
end
assert(target, "no pirate loot found")
local base = target:FindFirstAncestorOfClass("Model")
while base and not string.match(base.Name, "^Base%d") do
	base = base:FindFirstAncestorOfClass("Model")
end
local label = (base :: Model):FindFirstChild("LockPlate", true):FindFirstChildOfClass("BillboardGui"):FindFirstChildOfClass("TextLabel")
-- Wait for the shield to be open with enough time left.
local waited = 0
while not string.find(label.Text, "OPEN") or tonumber(string.match(label.Text, "(%d+)s")) < 8 do
	task.wait(1)
	waited += 1
	assert(waited < 70, "pirate base never opened: " .. label.Text)
end
local prompt = target:FindFirstChild("Steal", true) :: ProximityPrompt
root.CFrame = CFrame.new(target:GetPivot().Position + Vector3.new(0, -3, 4))
task.wait(0.3)
prompt:InputHoldBegin()
task.wait(prompt.HoldDuration + 0.3)
prompt:InputHoldEnd()
task.wait(0.5)
local carrying = player:GetAttribute("Carrying")
assert(carrying ~= "", "not carrying after steal")
local speed = player.Character:FindFirstChildOfClass("Humanoid").WalkSpeed
local home = workspace.Map:FindFirstChild("Base" .. player:GetAttribute("BaseIndex"))
root.CFrame = CFrame.new(home:GetPivot().Position + Vector3.new(0, 0, 0))
task.wait(1)
return `waited {waited}s, stole {carrying} (speed {speed}), used {used0} -> {player:GetAttribute("Used")}, carrying now '{player:GetAttribute("Carrying")}'`
