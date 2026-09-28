--!strict
-- One-way ledges: a ledge only collides once your feet are above its top, so you can jump up
-- through the ledge overhead and land on it. The client simulates its own character, so
-- toggling CanCollide locally is enough. Win pads stay solid (they sit on top of the caps).

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local player = Players.LocalPlayer
local map = Workspace:WaitForChild("Map")

local ledges: { { part: BasePart, top: number } } = {}
local function scan()
	table.clear(ledges)
	for _, d in map:GetDescendants() do
		local top = d:GetAttribute("LedgeTop")
		if d:IsA("BasePart") and type(top) == "number" then
			table.insert(ledges, { part = d, top = top })
		end
	end
end
scan()
map.DescendantAdded:Connect(function(d)
	if d:GetAttribute("LedgeTop") then
		scan()
	end
end)

RunService.Stepped:Connect(function()
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not root or not humanoid then
		return
	end
	-- Feet height: root centre minus hip height minus half the root's height.
	local feet = root.Position.Y - humanoid.HipHeight - root.Size.Y / 2
	for _, l in ledges do
		l.part.CanCollide = feet >= l.top - 0.75
	end
end)
