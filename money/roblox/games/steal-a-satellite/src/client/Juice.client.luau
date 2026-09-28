--!strict
-- Presentation: music, confetti, belt animation, floating/spinning satellites, buy/collect/
-- steal/zap effects, the carry guide beam, prompt visibility and the zapper hook-up.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Formulas = require(Shared.Formulas)
local SatModel = require(Shared.SatModel)
local Ui = require(script.Parent.Ui)
local Sfx = require(script.Parent.Sfx)

local player = Players.LocalPlayer
local remotes = ReplicatedStorage:WaitForChild("Remotes")
local actionRemote = remotes:WaitForChild("Action") :: RemoteEvent
local notifyRemote = remotes:WaitForChild("Notify") :: RemoteEvent
local fxRemote = remotes:WaitForChild("Fx") :: RemoteEvent
local map = Workspace:WaitForChild("Map")
local hud = player:WaitForChild("PlayerGui"):WaitForChild("SatHud") :: ScreenGui

-- Confetti ----------------------------------------------------------------------------

local CONFETTI_COLORS = {
	Color3.fromRGB(255, 90, 90),
	Color3.fromRGB(255, 210, 70),
	Color3.fromRGB(80, 220, 120),
	Color3.fromRGB(70, 170, 255),
	Color3.fromRGB(255, 90, 200),
	Color3.fromRGB(170, 110, 255),
}

local function confetti(amount: number)
	local rng = Random.new()
	for _ = 1, amount do
		local piece = Ui.new("Frame", {
			AnchorPoint = Vector2.new(0.5, 0.5),
			Position = UDim2.new(rng:NextNumber(0, 1), 0, 0, -20),
			Size = UDim2.fromOffset(rng:NextInteger(8, 14), rng:NextInteger(14, 22)),
			Rotation = rng:NextNumber(0, 360),
			BackgroundColor3 = CONFETTI_COLORS[rng:NextInteger(1, #CONFETTI_COLORS)],
			BorderSizePixel = 0,
			ZIndex = 20,
			Parent = hud,
		})
		local fall = rng:NextNumber(1.6, 2.8)
		TweenService:Create(piece, TweenInfo.new(fall, Enum.EasingStyle.Quad, Enum.EasingDirection.In), {
			Position = UDim2.fromScale(piece.Position.X.Scale + rng:NextNumber(-0.15, 0.15), 1.1),
			Rotation = piece.Rotation + rng:NextNumber(-540, 540),
		}):Play()
		task.delay(fall, function()
			piece:Destroy()
		end)
	end
end

-- Full-screen color flash (alarm red, zap blue).
local flash = Ui.new("Frame", {
	Size = UDim2.fromScale(1, 1),
	BackgroundColor3 = Color3.new(1, 0, 0),
	BackgroundTransparency = 1,
	BorderSizePixel = 0,
	ZIndex = 0,
	Parent = hud,
})
local function flashScreen(color: Color3, strength: number, duration: number)
	flash.BackgroundColor3 = color
	flash.BackgroundTransparency = 1 - strength
	TweenService:Create(flash, TweenInfo.new(duration), { BackgroundTransparency = 1 }):Play()
end

notifyRemote.OnClientEvent:Connect(function(_text: string, kind: string)
	if kind == "win" then
		Sfx.play("victory", 0.6)
		confetti(70)
	elseif kind == "big" then
		Sfx.play("victory", 0.7)
		confetti(160)
	elseif kind == "good" then
		Sfx.play("levelUp", 0.4)
	end
end)

-- Music -------------------------------------------------------------------------------

local music = Sfx.loop("music", 0.2)
local musicOn = true
local musicButton = Ui.button({
	Position = UDim2.new(0.5, 180, 0, 8),
	Size = UDim2.fromOffset(46, 46),
	Text = "🎵",
	Parent = hud,
}, Ui.Colors.blue, function() end)
musicButton.Activated:Connect(function()
	musicOn = not musicOn
	music.Volume = if musicOn then 0.2 else 0
	musicButton.Text = if musicOn then "🎵" else "🔇"
end)

-- Belt stripes scroll with the satellites -----------------------------------------------

local stripes: { { part: BasePart, x: number } } = {}
local belt = map:WaitForChild("Belt")
local stripeFolder = belt:WaitForChild("Stripes")
for _, s in stripeFolder:GetChildren() do
	if s:IsA("BasePart") then
		table.insert(stripes, { part = s, x = s.Position.X })
	end
end

-- Prompt visibility: owners see Sell, everyone else sees Steal ----------------------------

local function setupPrompt(p: ProximityPrompt)
	local model = p:FindFirstAncestorOfClass("Model")
	while model and model:GetAttribute("SatId") == nil do
		model = model:FindFirstAncestorOfClass("Model")
	end
	if not model then
		return
	end
	local owner = model:GetAttribute("OwnerId")
	if owner == nil then
		return -- belt satellites: everyone can buy
	end
	local mine = owner == player.UserId
	if p.Name == "Steal" then
		p.Enabled = not mine
	elseif p.Name == "Sell" then
		p.Enabled = mine
	end
end
Workspace.DescendantAdded:Connect(function(d)
	if d:IsA("ProximityPrompt") then
		task.defer(setupPrompt, d)
	end
end)
for _, d in Workspace:GetDescendants() do
	if d:IsA("ProximityPrompt") then
		setupPrompt(d)
	end
end

-- Satellites on pads float and turn (locally; the server copy stays put) ----------------

type Floater = { model: Model, home: CFrame, phase: number }
local floaters: { [Model]: Floater } = {}
local function track(model: Model)
	if model:GetAttribute("OwnerId") == nil or floaters[model] then
		return
	end
	local root = model.PrimaryPart
	if not root or not root.Anchored then
		return
	end
	floaters[model] = { model = model, home = root.CFrame, phase = math.random() * 6 }
	model.AncestryChanged:Connect(function()
		if not model:IsDescendantOf(map) then
			floaters[model] = nil
		end
	end)
end
map.DescendantAdded:Connect(function(d: Instance)
	if d:IsA("Model") and d:GetAttribute("SatId") then
		task.defer(track, d :: Model)
	end
end)
for _, d in map:GetDescendants() do
	if d:IsA("Model") and d:GetAttribute("SatId") then
		track(d)
	end
end

-- Own base marker + carry guide -------------------------------------------------------------

local function myBase(): Model?
	local index = player:GetAttribute("BaseIndex")
	return if index then map:FindFirstChild("Base" .. tostring(index)) :: Model? else nil
end

local marker = Instance.new("BillboardGui")
marker.Name = "YourBase"
marker.Size = UDim2.fromOffset(220, 60)
marker.StudsOffsetWorldSpace = Vector3.new(0, 8, 0)
marker.LightInfluence = 0
marker.MaxDistance = 1000
marker.AlwaysOnTop = false
Ui.label({ Size = UDim2.fromScale(1, 1), Text = "⭐ YOUR BASE ⭐", TextColor3 = Color3.fromRGB(255, 220, 90), Parent = marker })

local guideA = Instance.new("Attachment")
guideA.Name = "GuideTarget"
guideA.Parent = Workspace.Terrain
local beam = Instance.new("Beam")
beam.Attachment1 = guideA
beam.Width0 = 1.2
beam.Width1 = 1.2
beam.FaceCamera = true
beam.LightEmission = 1
beam.LightInfluence = 0
beam.Color = ColorSequence.new(Color3.fromRGB(255, 220, 90))
beam.Transparency = NumberSequence.new(0.2)
beam.Texture = "rbxasset://textures/particles/sparkles_main.dds"
beam.TextureMode = Enum.TextureMode.Wrap
beam.TextureLength = 4
beam.TextureSpeed = 2
beam.Segments = 20
beam.CurveSize0 = 0
beam.Enabled = false
beam.Parent = Workspace.Terrain

local carryBanner = Ui.label({
	AnchorPoint = Vector2.new(0.5, 1),
	Position = UDim2.new(0.5, 0, 1, -24),
	Size = UDim2.fromOffset(620, 46),
	Text = "",
	TextColor3 = Color3.fromRGB(255, 220, 90),
	Visible = false,
	Parent = hud,
})

local function updateMarker()
	local base = myBase()
	local sign = base and base:FindFirstChild("Sign")
	if sign then
		marker.Parent = sign
		guideA.WorldPosition = (sign :: BasePart).Position - Vector3.new(0, 18, 0)
	end
end
player:GetAttributeChangedSignal("BaseIndex"):Connect(updateMarker)
updateMarker()

local function updateCarry()
	local id = player:GetAttribute("Carrying")
	local sat = if type(id) == "string" then Config.ById[id] else nil
	carryBanner.Visible = sat ~= nil
	beam.Enabled = sat ~= nil
	if sat then
		carryBanner.Text = `🛰 You grabbed {sat.name}! Run to YOUR BASE ➜`
		Ui.pop(carryBanner, 0.5)
		Sfx.play("whoosh", 0.6, 0.8)
		local root = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
		if root then
			local a = root:FindFirstChild("GuideSource") :: Attachment? or Instance.new("Attachment")
			a.Name = "GuideSource"
			a.Parent = root
			beam.Attachment0 = a
		end
	end
end
player:GetAttributeChangedSignal("Carrying"):Connect(updateCarry)

-- Effects from the server ---------------------------------------------------------------

local function sparkleBurst(position: Vector3, color: Color3, count: number)
	local a = Instance.new("Attachment")
	a.WorldPosition = position
	a.Parent = Workspace.Terrain
	local e = Instance.new("ParticleEmitter")
	e.Texture = "rbxasset://textures/particles/sparkles_main.dds"
	e.Color = ColorSequence.new(color)
	e.LightEmission = 1
	e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1.2), NumberSequenceKeypoint.new(1, 0) })
	e.Lifetime = NumberRange.new(0.6, 1.1)
	e.Speed = NumberRange.new(8, 18)
	e.SpreadAngle = Vector2.new(180, 180)
	e.Drag = 3
	e.Rate = 0
	e.Parent = a
	e:Emit(count)
	task.delay(1.5, function()
		a:Destroy()
	end)
end

local function sound3d(name: string, position: Vector3, volume: number)
	local a = Instance.new("Attachment")
	a.WorldPosition = position
	a.Parent = Workspace.Terrain
	local s = Instance.new("Sound")
	s.SoundId = Sfx.Ids[name]
	s.Volume = volume
	s.RollOffMaxDistance = 160
	s.SoundGroup = Sfx.Group
	s.Parent = a
	s:Play()
	task.delay(4, function()
		a:Destroy()
	end)
end

local function floatText(position: Vector3, text: string, color: Color3)
	local a = Instance.new("Attachment")
	a.WorldPosition = position
	a.Parent = Workspace.Terrain
	local g = Instance.new("BillboardGui")
	g.Size = UDim2.fromOffset(160, 44)
	g.LightInfluence = 0
	g.AlwaysOnTop = false
	g.Adornee = a
	g.Parent = a
	local label = Ui.label({ Size = UDim2.fromScale(1, 1), Text = text, TextColor3 = color, Parent = g })
	local start = os.clock()
	local conn
	conn = RunService.RenderStepped:Connect(function()
		local t = os.clock() - start
		a.WorldPosition = position + Vector3.new(0, t * 5, 0)
		label.TextTransparency = math.clamp((t - 0.6) / 0.5, 0, 1)
		if t > 1.1 then
			conn:Disconnect()
			a:Destroy()
		end
	end)
end

-- A copy of the satellite arcs from the belt to its new pad.
local function flyGhost(from: Vector3, to: Vector3, id: string)
	local ghost = SatModel.build(id, CFrame.new(from))
	for _, d in ghost:GetDescendants() do
		if d:IsA("ProximityPrompt") or d:IsA("BillboardGui") then
			d:Destroy()
		end
	end
	ghost.Parent = Workspace
	local start = os.clock()
	local duration = 0.9
	local conn
	conn = RunService.RenderStepped:Connect(function()
		local a = math.min((os.clock() - start) / duration, 1)
		local e = 1 - (1 - a) ^ 2
		local pos = from:Lerp(to, e) + Vector3.new(0, math.sin(a * math.pi) * 25, 0)
		ghost:PivotTo(CFrame.new(pos) * CFrame.Angles(0, a * 8, 0))
		if a >= 1 then
			conn:Disconnect()
			ghost:Destroy()
			sparkleBurst(to, SatModel.rgb(Config.Rarities[Config.ById[id].tier].color), 30)
		end
	end)
end

local alarmSound: Sound? = nil
fxRemote.OnClientEvent:Connect(function(kind: string, a: any, b: any, c: any)
	if kind == "buy" then
		flyGhost(a, b, c)
		sound3d("whoosh", a, 0.8)
	elseif kind == "collect" then
		Sfx.play("cash", 0.5, 1 + math.random() * 0.1)
		floatText(a + Vector3.new(0, 3, 0), "+" .. Formulas.cash(b), Color3.fromRGB(120, 255, 140))
		sparkleBurst(a, Color3.fromRGB(120, 255, 140), 14)
	elseif kind == "steal" then
		sparkleBurst(a, SatModel.rgb(Config.Rarities[Config.ById[b].tier].color), 50)
	elseif kind == "zap" then
		sound3d("zap", a, 0.9)
	elseif kind == "stunned" then
		flashScreen(Color3.fromRGB(120, 200, 255), 0.5, 0.6)
		local root = player.Character and player.Character:FindFirstChild("HumanoidRootPart") :: BasePart?
		if root then
			root.AssemblyLinearVelocity = (a :: Vector3) * 55 + Vector3.new(0, 35, 0)
		end
	elseif kind == "alarm" then
		if alarmSound then
			alarmSound:Destroy()
		end
		local s = Instance.new("Sound")
		s.SoundId = Sfx.Ids.alarm
		s.Volume = 0.35
		s.Parent = hud
		s:Play()
		alarmSound = s
		task.delay(2.5, function()
			s:Destroy()
		end)
		for i = 0, 2 do
			task.delay(i * 0.5, flashScreen, Color3.fromRGB(255, 40, 40), 0.35, 0.4)
		end
	elseif kind == "lock" then
		Sfx.play("levelUp", 0.5, 1.2)
	end
end)

-- The zapper tool -----------------------------------------------------------------------------

local function hookTool(tool: Instance)
	if tool:IsA("Tool") and tool.Name == "Zapper" and not tool:GetAttribute("Hooked") then
		tool:SetAttribute("Hooked", true)
		tool.Activated:Connect(function()
			actionRemote:FireServer("zap")
		end)
	end
end
local function watch(container: Instance)
	for _, c in container:GetChildren() do
		hookTool(c)
	end
	container.ChildAdded:Connect(hookTool)
end
watch(player:WaitForChild("Backpack"))
player.CharacterAdded:Connect(function(character)
	watch(character)
	task.defer(function()
		local backpack = player:FindFirstChild("Backpack")
		if backpack then
			watch(backpack)
		end
	end)
	task.wait(0.5)
	updateCarry()
end)
if player.Character then
	watch(player.Character)
end

-- Per-frame animation -------------------------------------------------------------------------

RunService.RenderStepped:Connect(function()
	local t = os.clock()
	local shift = (t * Config.BeltSpeed) % 8
	for _, s in stripes do
		local x = s.x + shift
		if x > Config.BeltLength / 2 - 2 then
			x -= Config.BeltLength - 8
		end
		s.part.CFrame = CFrame.new(x, s.part.Position.Y, s.part.Position.Z)
	end
	local camera = Workspace.CurrentCamera
	local camPos = if camera then camera.CFrame.Position else Vector3.zero
	for model, f in floaters do
		if (f.home.Position - camPos).Magnitude < 220 then
			model:PivotTo(f.home * CFrame.new(0, math.sin(t * 1.6 + f.phase) * 0.5, 0) * CFrame.Angles(0, t * 0.6 + f.phase, 0))
		end
	end
	if beam.Enabled then
		beam.Width0 = 1 + math.sin(t * 6) * 0.3
	end
end)
