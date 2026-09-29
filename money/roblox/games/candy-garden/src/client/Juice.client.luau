--!strict
-- Grow a Candy Garden world effects: music, weather (falling sprinkles / chocolate / snow,
-- a rainbow in the sky, colour tints and rain ambience), rainbow candy colour cycling and a
-- flash when your plants ripen.

local Lighting = game:GetService("Lighting")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local Sfx = require(script.Parent:WaitForChild("Sfx"))

local player = Players.LocalPlayer
local camera = Workspace.CurrentCamera

local music = Sfx.loop("music", 0.25)
local rain = Sfx.loop("rain", 0)

-- Weather ----------------------------------------------------------------------------------------

local cloud = Instance.new("Part")
cloud.Name = "WeatherEmitter"
cloud.Anchored = true
cloud.CanCollide = false
cloud.CanQuery = false
cloud.CanTouch = false
cloud.Transparency = 1
cloud.Size = Vector3.new(120, 1, 120)
cloud.Parent = Workspace

local function emitter(props: { [string]: any }): ParticleEmitter
	local e = Instance.new("ParticleEmitter")
	e.EmissionDirection = Enum.NormalId.Bottom
	e.Enabled = false
	e.LightInfluence = 0.4
	for k, v in props do
		(e :: any)[k] = v
	end
	e.Parent = cloud
	return e
end

local SQUARE = "rbxasset://textures/particles/sparkles_main.dds"
local emitters: { [string]: ParticleEmitter } = {
	sprinkles = emitter({
		Texture = "rbxassetid://241594419", -- white square
		Rate = 260,
		Lifetime = NumberRange.new(2.5, 3.2),
		Speed = NumberRange.new(26, 34),
		Size = NumberSequence.new(0.55),
		Rotation = NumberRange.new(0, 360),
		RotSpeed = NumberRange.new(-200, 200),
		Color = ColorSequence.new({
			ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 90, 160)),
			ColorSequenceKeypoint.new(0.25, Color3.fromRGB(255, 220, 80)),
			ColorSequenceKeypoint.new(0.5, Color3.fromRGB(90, 220, 255)),
			ColorSequenceKeypoint.new(0.75, Color3.fromRGB(140, 255, 120)),
			ColorSequenceKeypoint.new(1, Color3.fromRGB(200, 120, 255)),
		}),
		Squash = NumberSequence.new(1.2),
		LightEmission = 0.3,
	}),
	chocostorm = emitter({
		Texture = "rbxassetid://241594419",
		Rate = 520,
		Lifetime = NumberRange.new(1.4, 1.8),
		Speed = NumberRange.new(55, 65),
		Size = NumberSequence.new(0.75),
		Squash = NumberSequence.new(1.6),
		Color = ColorSequence.new(Color3.fromRGB(95, 50, 25)),
		Transparency = NumberSequence.new(0.05),
	}),
	blizzard = emitter({
		Texture = SQUARE,
		Rate = 240,
		Lifetime = NumberRange.new(5, 7),
		Speed = NumberRange.new(9, 14),
		SpreadAngle = Vector2.new(20, 20),
		Size = NumberSequence.new(1.1),
		Color = ColorSequence.new(Color3.fromRGB(255, 255, 255)),
		LightEmission = 0.6,
	}),
	rainbowhour = emitter({
		Texture = SQUARE,
		Rate = 90,
		Lifetime = NumberRange.new(4, 6),
		Speed = NumberRange.new(6, 10),
		SpreadAngle = Vector2.new(30, 30),
		Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.4), NumberSequenceKeypoint.new(0.5, 1), NumberSequenceKeypoint.new(1, 0) }),
		Color = ColorSequence.new(Color3.fromRGB(255, 230, 120), Color3.fromRGB(255, 140, 230)),
		LightEmission = 1,
	}),
}

local tint = Instance.new("ColorCorrectionEffect")
tint.Name = "WeatherTint"
tint.Parent = Lighting

local TINTS = {
	sprinkles = { TintColor = Color3.fromRGB(255, 240, 250), Brightness = 0.02, Saturation = 0.15 },
	chocostorm = { TintColor = Color3.fromRGB(230, 195, 170), Brightness = -0.1, Saturation = -0.1 },
	blizzard = { TintColor = Color3.fromRGB(215, 235, 255), Brightness = 0.06, Saturation = -0.12 },
	rainbowhour = { TintColor = Color3.fromRGB(255, 245, 225), Brightness = 0.05, Saturation = 0.3 },
}
local CLEAR = { TintColor = Color3.new(1, 1, 1), Brightness = 0, Saturation = 0 }

-- A rainbow arcing over the town during Rainbow Hour (and faintly after Sprinkle Rain).
local rainbow = Instance.new("Model")
rainbow.Name = "Rainbow"
local BANDS = {
	Color3.fromRGB(255, 70, 70),
	Color3.fromRGB(255, 160, 50),
	Color3.fromRGB(255, 230, 60),
	Color3.fromRGB(90, 220, 90),
	Color3.fromRGB(70, 160, 255),
	Color3.fromRGB(150, 90, 255),
}
local bandParts: { BasePart } = {}
for b, color in BANDS do
	local r = 250 - b * 7
	local n = 48
	for i = 0, n - 1 do
		local a0, a1 = i / n * math.pi, (i + 1) / n * math.pi
		local p0 = Vector3.new(math.cos(a0) * r, math.sin(a0) * r - 30, 330)
		local p1 = Vector3.new(math.cos(a1) * r, math.sin(a1) * r - 30, 330)
		local p = Instance.new("Part")
		p.Anchored = true
		p.CanCollide = false
		p.CanQuery = false
		p.CanTouch = false
		p.CastShadow = false
		p.Material = Enum.Material.Neon
		p.Color = color
		p.Transparency = 1
		p.Size = Vector3.new(7.2, 1, (p1 - p0).Magnitude + 0.5)
		p.CFrame = CFrame.lookAt((p0 + p1) / 2, p1)
		p.Parent = rainbow
		table.insert(bandParts, p)
	end
end
rainbow.Parent = Workspace

local current: string? = nil
local function setWeather(id: string?)
	if id == current then
		return
	end
	current = id
	for key, e in emitters do
		e.Enabled = key == id
	end
	local look = if id and TINTS[id] then TINTS[id] else CLEAR
	TweenService:Create(tint, TweenInfo.new(2), look :: any):Play()
	TweenService:Create(rain, TweenInfo.new(2), { Volume = if id == "chocostorm" or id == "sprinkles" then 0.18 else 0 }):Play()
	TweenService:Create(music, TweenInfo.new(2), { Volume = if id == "chocostorm" then 0.15 else 0.25 }):Play()
	local show = if id == "rainbowhour" then 0.25 elseif id == "sprinkles" then 0.6 else 1
	for _, p in bandParts do
		TweenService:Create(p, TweenInfo.new(3), { Transparency = show }):Play()
	end
	local atmo = Lighting:FindFirstChildOfClass("Atmosphere")
	if atmo then
		TweenService:Create(atmo, TweenInfo.new(3), {
			Density = if id == "chocostorm" then 0.5 elseif id == "blizzard" then 0.45 else 0.3,
			Color = if id == "chocostorm" then Color3.fromRGB(200, 160, 140) elseif id == "blizzard" then Color3.fromRGB(230, 240, 255) else Color3.fromRGB(255, 214, 232),
		}):Play()
	end
end

local function readWeather()
	local w = Workspace:GetAttribute("Weather")
	setWeather(if typeof(w) == "string" then w else nil)
end
Workspace:GetAttributeChangedSignal("Weather"):Connect(readWeather)
readWeather()

-- Rainbow candies + ripe flashes -----------------------------------------------------------------

local rainbowParts: { [BasePart]: number } = {}

local function watchCandies(m: Instance)
	if m.Name ~= "Candies" or m:GetAttribute("Mutation") ~= "rainbow" then
		return
	end
	for _, d in m:GetDescendants() do
		if d:IsA("BasePart") then
			rainbowParts[d] = math.random() * 6
		end
	end
end

local function myPlants(): Instance?
	local i = player:GetAttribute("Plot")
	local map = Workspace:FindFirstChild("Map")
	local plots = map and map:FindFirstChild("Plots")
	local plot = i and plots and plots:FindFirstChild("Plot" .. tostring(i))
	return plot and plot:FindFirstChild("Plants")
end

local function flash(m: Model)
	local h = Instance.new("Highlight")
	h.FillColor = Color3.fromRGB(255, 250, 200)
	h.OutlineColor = Color3.new(1, 1, 1)
	h.FillTransparency = 0.2
	h.OutlineTransparency = 0
	h.DepthMode = Enum.HighlightDepthMode.Occluded
	h.Parent = m
	TweenService:Create(h, TweenInfo.new(0.8), { FillTransparency = 1, OutlineTransparency = 1 }):Play()
	task.delay(0.9, function()
		h:Destroy()
	end)
end

Workspace.DescendantAdded:Connect(function(d: Instance)
	if d.Name == "Candies" and d:IsA("Model") then
		task.defer(function()
			watchCandies(d)
			local plant = d.Parent
			local plants = myPlants()
			if plant and plant:IsA("Model") and plants and plant.Parent == plants then
				flash(plant)
			end
		end)
	end
end)
for _, d in Workspace:GetDescendants() do
	watchCandies(d)
end

RunService.RenderStepped:Connect(function()
	local t = os.clock()
	for p, off in rainbowParts do
		if not p.Parent then
			rainbowParts[p] = nil
		else
			p.Color = Color3.fromHSV((t * 0.35 + off) % 1, 0.65, 1)
		end
	end
	if current then
		local pos = camera.CFrame.Position
		cloud.CFrame = CFrame.new(pos.X, pos.Y + 45, pos.Z)
	end
end)
