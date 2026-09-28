--!strict
-- Builds the whole map from code: lighting, spawn plaza, lava sea, the core and its ledge spiral.

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

local function spawnCFrame(): CFrame
	local sp = Config.SpawnPoint
	return CFrame.lookAt(Vector3.new(sp[1], 0.5, sp[3]), Vector3.new(0, 0.5, 0))
end

local function buildPlaza(folder: Folder): Part
	local r = Config.PlazaRadius
	local plaza = part({
		Name = "Plaza",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(4, r * 2, r * 2),
		CFrame = CFrame.new(0, -2, 0) * CFrame.Angles(0, 0, math.pi / 2),
		Material = Enum.Material.Slate,
		Color = Color3.fromRGB(78, 84, 106),
		Parent = folder,
	})
	part({
		Name = "PlazaRim",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(3.6, r * 2 + 4, r * 2 + 4),
		CFrame = CFrame.new(0, -2.3, 0) * CFrame.Angles(0, 0, math.pi / 2),
		Material = Enum.Material.Neon,
		Color = Color3.fromRGB(90, 200, 255),
		Parent = folder,
	})

	local spawn = Instance.new("SpawnLocation")
	spawn.Name = "Spawn"
	spawn.Anchored = true
	spawn.Size = Vector3.new(12, 1, 12)
	spawn.CFrame = spawnCFrame()
	spawn.Material = Enum.Material.Slate
	spawn.Color = Color3.fromRGB(45, 80, 125)
	spawn.Duration = 0
	spawn.Neutral = true
	spawn.TopSurface = Enum.SurfaceType.Smooth
	spawn.Parent = folder
	part({
		Name = "SpawnTrim",
		Size = Vector3.new(12.6, 0.6, 12.6),
		CFrame = spawn.CFrame - Vector3.new(0, 0.3, 0),
		Material = Enum.Material.Neon,
		Color = Color3.fromRGB(90, 200, 255),
		CanCollide = false,
		Parent = folder,
	})

	-- Title sign behind the spawn, readable from the plaza and from the tower.
	local signPos = spawnCFrame().Position + Vector3.new(0, 14, 22)
	local sign = part({
		Name = "TitleSign",
		Size = Vector3.new(44, 15, 1),
		CFrame = CFrame.lookAt(signPos, Vector3.new(0, signPos.Y, 0)),
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
	return plaza
end

-- Returns the lava part (the game listens to its Touched event).
local function buildLava(folder: Folder): Part
	return part({
		Name = "Lava",
		Size = Vector3.new(2048, 20, 2048),
		CFrame = CFrame.new(0, LAVA_TOP - 10, 0),
		Material = Enum.Material.Neon,
		Color = Color3.fromRGB(255, 85, 20),
		Parent = folder,
	})
end

-- Central core: stacked cylinder segments, banded in each zone's colour over that zone's height range.
local function buildCore(folder: Folder, pillars: { TowerLayout.Pillar })
	local core = Instance.new("Model")
	core.Name = "Core"
	local r = Config.CoreRadius
	local zoneTop: { number } = {}
	for _, p in pillars do
		zoneTop[p.zone] = p.top
	end
	local bottom = -4
	for zi, zone in Config.Zones do
		local top = zoneTop[zi] + (if zi == #Config.Zones then 30 else 0)
		local color = rgb(zone.color):Lerp(Color3.fromRGB(40, 40, 60), 0.45)
		while bottom < top do
			local h = math.min(MAX_PART, top - bottom)
			part({
				Name = "Segment",
				Shape = Enum.PartType.Cylinder,
				Size = Vector3.new(h, r * 2, r * 2),
				CFrame = CFrame.new(0, bottom + h / 2, 0) * CFrame.Angles(0, 0, math.pi / 2),
				Material = Enum.Material.Concrete,
				Color = color,
				Parent = core,
			})
			bottom += h
		end
		-- Glowing ring marking the zone boundary.
		part({
			Name = "Band",
			Shape = Enum.PartType.Cylinder,
			Size = Vector3.new(3, r * 2 + 1, r * 2 + 1),
			CFrame = CFrame.new(0, top, 0) * CFrame.Angles(0, 0, math.pi / 2),
			Material = Enum.Material.Neon,
			Color = rgb(zone.color),
			CanCollide = false,
			Parent = core,
		})
	end
	core.Parent = folder
end

-- Returns winPads[zone] = pad part.
local function buildTower(folder: Folder): { [number]: Part }
	local winPads = {}
	local size = Config.PillarSize
	local pillars = TowerLayout.build()
	buildCore(folder, pillars)
	for _, p in pillars do
		local zone = Config.Zones[p.zone]
		local color = rgb(zone.color)
		-- Face the ledge's outer edge away from the core.
		local basis = CFrame.lookAt(Vector3.new(p.x, 0, p.z), Vector3.new(p.x * 2, 0, p.z * 2))
		local model = Instance.new("Model")
		model.Name = `Ledge{p.index}`

		part({
			Name = "Cap",
			Size = Vector3.new(size, 4, size),
			CFrame = basis + Vector3.new(0, p.top - 2, 0),
			Material = Enum.Material.SmoothPlastic,
			Color = color,
			Parent = model,
		})
		part({
			Name = "Trim",
			Size = Vector3.new(size + 0.4, 0.6, size + 0.4),
			CFrame = basis + Vector3.new(0, p.top - 4.2, 0),
			Material = Enum.Material.Neon,
			Color = color,
			CanCollide = false,
			Parent = model,
		})
		-- Support strut into the core, purely visual.
		part({
			Name = "Strut",
			Size = Vector3.new(4, 4, size * 0.6),
			CFrame = basis * CFrame.new(0, p.top - 6, size * 0.35) * CFrame.Angles(math.rad(35), 0, 0),
			Material = Enum.Material.Metal,
			Color = Color3.fromRGB(60, 62, 80),
			CanCollide = false,
			Parent = model,
		})

		local anchor = model:FindFirstChild("Cap") :: Part
		anchor:SetAttribute("LedgeTop", p.top) -- the client makes ledges one-way (see OneWayLedges)
		-- Requirement printed on all four sides of the ledge: readable while you look up at it,
		-- out of the way once you're standing on it.
		local needText = if p.need < 1 then "START" else `⬆ {Formulas.abbreviate(math.ceil(p.need))}`
		for _, face in { Enum.NormalId.Front, Enum.NormalId.Back, Enum.NormalId.Left, Enum.NormalId.Right } do
			local gui = Instance.new("SurfaceGui")
			gui.Face = face
			gui.LightInfluence = 0
			gui.PixelsPerStud = 20
			gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
			local label = Instance.new("TextLabel")
			label.Size = UDim2.fromScale(1, 1)
			label.BackgroundColor3 = Color3.fromRGB(20, 20, 32)
			label.BackgroundTransparency = 0.25
			label.Font = Enum.Font.FredokaOne
			label.TextScaled = true
			label.TextColor3 = Color3.new(1, 1, 1)
			label.Text = needText
			label.Parent = gui
			gui.Parent = anchor
		end
		if p.step == 1 then
			billboard(
				anchor,
				`ZONE {p.zone} · {string.upper(zone.name)}`,
				color,
				UDim2.fromScale(36, 7),
				Vector3.new(0, 13, 0),
				900
			)
		end
		if p.isZoneEnd then
			local pad = part({
				Name = "WinPad",
				Size = Vector3.new(size - 4, 0.6, size - 4),
				CFrame = basis + Vector3.new(0, p.top + 0.3, 0),
				Material = Enum.Material.Neon,
				Color = Color3.fromRGB(255, 215, 60),
				Parent = model,
			})
			pad:SetAttribute("Zone", p.zone)
			pad:SetAttribute("LedgeTop", p.top) -- one-way too, or you'd bonk your head on it from below
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
				UDim2.fromScale(18, 4.5),
				Vector3.new(0, 8, 0),
				500
			)
			winPads[p.zone] = pad
		end
		model.Parent = folder
	end
	return winPads
end

export type Built = { lava: Part, plaza: Part, winPads: { [number]: Part }, spawn: CFrame }

function World.build(): Built
	setupLighting()
	local folder = Instance.new("Folder")
	folder.Name = "Map"
	folder.Parent = workspace
	local plaza = buildPlaza(folder)
	local lava = buildLava(folder)
	local winPads = buildTower(folder)
	return { lava = lava, plaza = plaza, winPads = winPads, spawn = spawnCFrame() + Vector3.new(0, 4, 0) }
end

return World
