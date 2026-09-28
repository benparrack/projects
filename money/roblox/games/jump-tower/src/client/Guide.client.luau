--!strict
-- Wayfinding: ledge requirement labels turn green when your jump is enough and red when it
-- isn't, a bouncing arrow marks the next ledge you can reach, and brand-new players get a hint.

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local Ui = require(script.Parent.Ui)

local player = Players.LocalPlayer
local map = Workspace:WaitForChild("Map")

local CAN = Color3.fromRGB(120, 255, 140)
local CANT = Color3.fromRGB(255, 110, 110)

type Ledge = { cap: BasePart, need: number, top: number, labels: { TextLabel } }
local ledges: { Ledge } = {}

local function collect()
	table.clear(ledges)
	for _, model in map:GetChildren() do
		local cap = model:FindFirstChild("Cap")
		if cap and cap:IsA("BasePart") and cap:GetAttribute("Need") ~= nil then
			local labels = {}
			for _, d in cap:GetDescendants() do
				if d:IsA("TextLabel") and d.Name == "NeedLabel" then
					table.insert(labels, d)
				end
			end
			table.insert(ledges, { cap = cap, need = cap:GetAttribute("Need"), top = cap:GetAttribute("LedgeTop"), labels = labels })
		end
	end
	table.sort(ledges, function(a, b)
		return a.top < b.top
	end)
end
-- The map is built by the server before we get here in practice, but be safe about late parts.
task.wait(1)
collect()

local function jump(): number
	return player:GetAttribute("Jump") or 0
end

local function recolor()
	local j = jump()
	for _, l in ledges do
		if l.need >= 1 then
			for _, label in l.labels do
				label.TextColor3 = if j >= l.need then CAN else CANT
			end
		end
	end
end
recolor()
player:GetAttributeChangedSignal("Jump"):Connect(recolor)

-- Bouncing arrow -----------------------------------------------------------------------

local arrow = Instance.new("BillboardGui")
arrow.Name = "NextLedgeArrow"
arrow.Size = UDim2.fromScale(8, 8)
arrow.AlwaysOnTop = false -- AlwaysOnTop billboards failed to draw in testing
arrow.LightInfluence = 0
arrow.MaxDistance = 400
arrow.Enabled = false
Ui.label({ Size = UDim2.fromScale(1, 1), Text = "⬇", TextColor3 = Color3.fromRGB(255, 215, 60), Parent = arrow })

-- Hint for players who haven't won anything yet.
local hud = player.PlayerGui:WaitForChild("JumpTowerHud") :: ScreenGui
local hint = Ui.label({
	AnchorPoint = Vector2.new(0.5, 1),
	Position = UDim2.new(0.5, 0, 1, -18),
	Size = UDim2.fromOffset(560, 40),
	Text = "",
	Visible = false,
	Parent = hud,
})

local target: Ledge? = nil
local elapsed = 0
RunService.RenderStepped:Connect(function(dt)
	elapsed += dt
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not root then
		arrow.Enabled = false
		return
	end
	-- Re-pick the target a few times a second.
	if elapsed > 0.25 then
		elapsed = 0
		local feet = root.Position.Y - 3
		local j = jump()
		target = nil
		local blocked: Ledge? = nil
		for _, l in ledges do
			if l.top > feet + 1.5 then
				if l.need <= j then
					target = l
				else
					blocked = l
				end
				break
			end
		end
		local newbie = (player:GetAttribute("Wins") or 0) == 0 and (player:GetAttribute("Rebirths") or 0) == 0
		if newbie and blocked then
			hint.Text = `Your jump grows every second! Next ledge: ⬆ {math.ceil(blocked.need)}`
			hint.Visible = true
		elseif newbie and target and feet < 5 then
			hint.Text = "Hop onto the ledges to climb! 🏆 Wins at the top of each zone"
			hint.Visible = true
		else
			hint.Visible = false
		end
	end
	if target then
		-- Local-only instance parented straight to the ledge (Adornee from PlayerGui didn't draw).
		if arrow.Parent ~= target.cap then
			arrow.Parent = target.cap
		end
		arrow.StudsOffsetWorldSpace = Vector3.new(0, 5 + math.abs(math.sin(os.clock() * 4)) * 2.5, 0)
		arrow.Enabled = true
	else
		arrow.Enabled = false
	end
end)
