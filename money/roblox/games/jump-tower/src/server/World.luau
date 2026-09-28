--!strict
-- Builds the whole map from code: lighting, spawn plaza, lava sea and the pillar spiral.

local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Formulas = require(Shared.Formulas)
local TowerLayout = require(Shared.TowerLayout)

local World = {}

local MAX_PART = 2000
local LAVA_TOP = -6

local function rgb(c: { number }): Color3
	return Color3.fromRGB(c[1], c[2], c[3])
end

local function part(props: { [string]: any }): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	for k, v in props do
		(p :: any)[k] = v
	end
	return p
end

local function billboard(parent: Instance, text: string, color: Color3, size: UDim2, offset: Vector3, maxDistance: number): TextLabel
	local gui = Instance.new("BillboardGui")
	gui.Size = size
	gui.StudsOffsetWorldSpace = offset
	gui.AlwaysOnTop = false
	gui.MaxDistance = maxDistance
	gui.LightInfluence = 0
	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.FredokaOne
	label.TextScaled = true
	label.TextColor3 = color
	label.TextStrokeTransparency = 0.2
	label.Text = text
	label.Parent = gui
	gui.Parent = parent
	return label
end

local function setupLighting()
	Lighting.ClockTime = 14.5
	Lighting.Brightness = 3
	Lighting.EnvironmentDiffuseScale = 0.6
	Lighting.EnvironmentSpecularScale = 0.6
	Lighting.OutdoorAmbient = Color3.fromRGB(140, 140, 160)
	Lighting.GlobalShadows = true

	local atmosphere = Instance.new("Atmosphere")
	atmosphere.Density = 0.28
	atmosphere.Offset = 0.2
	atmosphere.Color = Color3.fromRGB(200, 215, 255)
	atmosphere.Decay = Color3.fromRGB(110, 120, 170)
	atmosphere.Glare = 0.4
	atmosphere.Haze = 1.2
	atmosphere.Parent = Lighting

	local bloom = Instance.new("BloomEffect")
	bloom.Intensity = 0.5
	bloom.Size = 28
	bloom.Threshold = 0.95
	bloom.Parent = Lighting

	local cc = Instance.new("ColorCorrectionEffect")
	cc.Saturation = 0.15
	cc.Contrast = 0.05
	cc.Parent = Lighting

	local rays = Instance.new("SunRaysEffect")
	rays.Intensity = 0.06
	rays.Spread = 0.8
	rays.Parent = Lighting

	local clouds = workspace.Terrain:FindFirstChildOfClass("Clouds") or Instance.new("Clouds")
	clouds.Cover = 0.55
	clouds.Density = 0.6
	clouds.Parent = workspace.Terrain
end

local function buildPlaza(folder: Folder)
	part({
		Name = "Plaza",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(4, 180, 180),
		CFrame = CFrame.new(0, -2, 0) * CFrame.Angles(0, 0, math.pi / 2),
		Material = Enum.Material.Slate,
		Color = Color3.fromRGB(70, 75, 95),
		Parent = folder,
	})
	part({
		Name = "PlazaRim",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(3.6, 184, 184),
		CFrame = CFrame.new(0, -2.3, 0) * CFrame.Angles(0, 0, math.pi / 2),
		Material = Enum.Material.Neon,
		Color = Color3.fromRGB(90, 200, 255),
		Parent = folder,
	})

	local spawn = Instance.new("SpawnLocation")
	spawn.Name = "Spawn"
	spawn.Anchored = true
	spawn.Size = Vector3.new(14, 1, 14)
	spawn.CFrame = CFrame.new(0, 0.5, 0)
	spawn.Material = Enum.Material.Neon
	spawn.Color = Color3.fromRGB(90, 200, 255)
	spawn.Duration = 0
	spawn.Neutral = true
	spawn.TopSurface = Enum.SurfaceType.Smooth
	spawn.Parent = folder

	-- Big title sign facing the first pillar.
	local sign = part({
		Name = "TitleSign",
		Size = Vector3.new(40, 14, 1),
		CFrame = CFrame.new(-40, 12, 0) * CFrame.Angles(0, math.pi / 2, 0),
		Material = Enum.Material.SmoothPlastic,
		Color = Color3.fromRGB(25, 25, 40),
		Parent = folder,
	})
	for _, face in { Enum.NormalId.Front, Enum.NormalId.Back } do
		local gui = Instance.new("SurfaceGui")
		gui.Face = face
		gui.LightInfluence = 0
		gui.PixelsPerStud = 25
		local title = Instance.new("TextLabel")
		title.Size = UDim2.fromScale(1, 0.6)
		title.BackgroundTransparency = 1
		title.Font = Enum.Font.FredokaOne
		title.TextScaled = true
		title.TextColor3 = Color3.fromRGB(255, 220, 90)
		title.Text = "+1 JUMP TOWER"
		title.Parent = gui
		local sub = title:Clone()
		sub.Position = UDim2.fromScale(0.05, 0.6)
		sub.Size = UDim2.fromScale(0.9, 0.3)
		sub.TextColor3 = Color3.new(1, 1, 1)
		sub.Text = "Your jump grows every second. Climb to the stars!"
		sub.Parent = gui
		gui.Parent = sign
	end
end

-- Returns the lava part (the game listens to its Touched event).
local function buildLava(folder: Folder): Part
	return part({
		Name = "Lava",
		Size = Vector3.new(2048, 20, 2048),
		CFrame = CFrame.new(0, LAVA_TOP - 10, 0),
		Material = Enum.Material.CrackedLava,
		Color = Color3.fromRGB(255, 90, 30),
		Parent = folder,
	})
end

-- Returns winPads[zone] = pad part.
local function buildTower(folder: Folder): { [number]: Part }
	local winPads = {}
	local size = Config.PillarSize
	for _, p in TowerLayout.build() do
		local zone = Config.Zones[p.zone]
		local color = rgb(zone.color)
		local angle = math.atan2(p.z, p.x)
		local basis = CFrame.new(p.x, 0, p.z) * CFrame.Angles(0, -angle, 0)
		local model = Instance.new("Model")
		model.Name = `Pillar{p.index}`

		-- Column, stacked because parts max out at 2048 studs.
		local columnColor = color:Lerp(Color3.fromRGB(30, 30, 45), 0.55)
		local bottom = LAVA_TOP - 8
		local columnTop = p.top - 2
		while bottom < columnTop do
			local h = math.min(MAX_PART, columnTop - bottom)
			part({
				Name = "Column",
				Size = Vector3.new(size - 1, h, size - 1),
				CFrame = basis + Vector3.new(0, bottom + h / 2, 0),
				Material = Enum.Material.SmoothPlastic,
				Color = columnColor,
				Parent = model,
			})
			bottom += h
		end
		part({
			Name = "Cap",
			Size = Vector3.new(size, 2, size),
			CFrame = basis + Vector3.new(0, p.top - 1, 0),
			Material = Enum.Material.SmoothPlastic,
			Color = color,
			Parent = model,
		})
		part({
			Name = "Trim",
			Size = Vector3.new(size + 0.4, 0.5, size + 0.4),
			CFrame = basis + Vector3.new(0, p.top - 2.1, 0),
			Material = Enum.Material.Neon,
			Color = color,
			CanCollide = false,
			Parent = model,
		})

		local anchor = model:FindFirstChild("Cap") :: Part
		billboard(
			anchor,
			`⬆ {Formulas.abbreviate(math.ceil(p.need))}`,
			Color3.new(1, 1, 1),
			UDim2.fromOffset(120, 40),
			Vector3.new(0, 5, 0),
			120
		)
		if p.step == 1 then
			billboard(
				anchor,
				`ZONE {p.zone} · {string.upper(zone.name)}`,
				color,
				UDim2.fromOffset(360, 70),
				Vector3.new(0, 14, 0),
				600
			)
		end
		if p.isZoneEnd then
			local pad = part({
				Name = "WinPad",
				Size = Vector3.new(size - 3, 0.6, size - 3),
				CFrame = basis + Vector3.new(0, p.top + 0.3, 0),
				Material = Enum.Material.Neon,
				Color = Color3.fromRGB(255, 215, 60),
				Parent = model,
			})
			pad:SetAttribute("Zone", p.zone)
			local sparkles = Instance.new("ParticleEmitter")
			sparkles.Texture = "rbxasset://textures/particles/sparkles_main.dds"
			sparkles.Rate = 12
			sparkles.Lifetime = NumberRange.new(1, 2)
			sparkles.Speed = NumberRange.new(4, 8)
			sparkles.SpreadAngle = Vector2.new(30, 30)
			sparkles.Color = ColorSequence.new(Color3.fromRGB(255, 230, 120))
			sparkles.LightEmission = 1
			sparkles.Parent = pad
			billboard(
				pad,
				`🏆 WIN +{Formulas.abbreviate(zone.wins)}`,
				Color3.fromRGB(255, 225, 90),
				UDim2.fromOffset(200, 50),
				Vector3.new(0, 9, 0),
				400
			)
			winPads[p.zone] = pad
		end
		model.Parent = folder
	end
	return winPads
end

export type Built = { lava: Part, winPads: { [number]: Part } }

function World.build(): Built
	setupLighting()
	local folder = Instance.new("Folder")
	folder.Name = "Map"
	folder.Parent = workspace
	buildPlaza(folder)
	local lava = buildLava(folder)
	local winPads = buildTower(folder)
	return { lava = lava, winPads = winPads }
end

return World
