--!strict
-- Builds Anomaly Shift from code: the night-office lobby and one private looping corridor
-- per player. A corridor is a static shell (floor, walls, ceiling, the turn to the exit)
-- plus a "Props" model that is rebuilt every floor and then bent by at most one anomaly.
--
-- Corridor-local axes: the player spawns facing +Z. Side A is the +X wall (the exit turn
-- is on it), side B the -X wall. Client-side animation is driven by an "Fx" attribute
-- on instances inside Props (see Juice.client.luau).

local Lighting = game:GetService("Lighting")
local Workspace = game:GetService("Workspace")

local Config = require(game:GetService("ReplicatedStorage").Shared.Config)

local World = {}

local H = Config.Hall
local HALF = H.width / 2
local TOP = H.height

local WALL = Color3.fromRGB(228, 224, 210)
local WAINSCOT = Color3.fromRGB(118, 130, 136)
local BASEBOARD = Color3.fromRGB(44, 44, 50)
local FLOOR_A = Color3.fromRGB(206, 206, 200)
local FLOOR_B = Color3.fromRGB(176, 178, 176)
local CEIL = Color3.fromRGB(196, 196, 190)
local DOOR = Color3.fromRGB(112, 84, 58)
local FRAME = Color3.fromRGB(72, 72, 78)
local LIGHT = Color3.fromRGB(255, 246, 226)
local SUIT = Color3.fromRGB(26, 26, 32)
local SKIN = Color3.fromRGB(214, 206, 196)

export type Corridor = {
	slot: number,
	origin: CFrame,
	model: Model,
	props: Model?,
	hum: Sound,
	lights: { BasePart },
	lightsFolder: Model,
}

export type Built = {
	map: Folder,
	spawn: CFrame,
	elevator: Vector3, -- centre of the "start shift" pad
	boardsAt: { CFrame },
}

-- Helpers ------------------------------------------------------------------------------------

local function part(parent: Instance, props: { [string]: any }): BasePart
	local p: any = Instance.new(props.ClassName or "Part")
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Material = Enum.Material.SmoothPlastic
	for k, v in props do
		if k ~= "ClassName" then
			(p :: any)[k] = v
		end
	end
	p.Parent = parent
	return p :: BasePart
end

local function decor(parent: Instance, props: { [string]: any }): BasePart
	props.CanCollide = props.CanCollide or false
	props.CanQuery = false
	props.CanTouch = false
	props.CastShadow = if props.CastShadow == nil then false else props.CastShadow
	return part(parent, props)
end

local function model(parent: Instance, name: string): Model
	local m = Instance.new("Model")
	m.Name = name
	m.Parent = parent
	return m
end

local function gui(p: BasePart, face: Enum.NormalId, ppS: number?): SurfaceGui
	local g = Instance.new("SurfaceGui")
	g.Face = face
	g.LightInfluence = 0.6
	g.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	g.PixelsPerStud = ppS or 40
	g.Parent = p
	return g
end

local function text(parent: Instance, props: { [string]: any }): TextLabel
	local l = Instance.new("TextLabel")
	l.BackgroundTransparency = 1
	l.Font = Enum.Font.GothamBlack
	l.TextScaled = true
	l.TextColor3 = Color3.new(0, 0, 0)
	l.Size = UDim2.fromScale(1, 1)
	for k, v in props do
		(l :: any)[k] = v
	end
	l.Parent = parent
	return l
end

local function frame(parent: Instance, props: { [string]: any }): Frame
	local f = Instance.new("Frame")
	f.BorderSizePixel = 0
	for k, v in props do
		(f :: any)[k] = v
	end
	f.Parent = parent
	return f
end

local function billboard(adornee: BasePart, size: UDim2, offset: Vector3, str: string, color: Color3): TextLabel
	local g = Instance.new("BillboardGui")
	g.Size = size
	g.StudsOffsetWorldSpace = offset
	g.LightInfluence = 0
	g.MaxDistance = 80
	g.Parent = adornee
	local l = text(g, { Text = str, TextColor3 = color, Font = Enum.Font.FredokaOne })
	local s = Instance.new("UIStroke")
	s.Thickness = 2
	s.Parent = l
	return l
end
World.billboard = billboard

-- Wall-mounted item on side (1 = A/+X, -1 = B/-X): returns CFrame + visible face.
local function onWall(o: CFrame, side: number, z: number, y: number, depth: number): (CFrame, Enum.NormalId)
	local cf = o * CFrame.new(side * (HALF - depth / 2), y, z)
	return cf, if side == 1 then Enum.NormalId.Left else Enum.NormalId.Right
end

-- Lighting ------------------------------------------------------------------------------------

local function lighting()
	Lighting.ClockTime = 0
	Lighting.Brightness = 0
	Lighting.Ambient = Color3.fromRGB(26, 26, 30)
	Lighting.OutdoorAmbient = Color3.fromRGB(14, 14, 20)
	Lighting.EnvironmentDiffuseScale = 0.35
	Lighting.EnvironmentSpecularScale = 0.35
	Lighting.GlobalShadows = true
	Lighting.FogEnd = 100000
	for _, c in Lighting:GetChildren() do
		c:Destroy()
	end
	local sky = Instance.new("Sky")
	sky.StarCount = 1500
	sky.CelestialBodiesShown = false
	sky.Parent = Lighting
	local bloom = Instance.new("BloomEffect")
	bloom.Intensity = 0.5
	bloom.Size = 22
	bloom.Threshold = 1.2
	bloom.Parent = Lighting
	local cc = Instance.new("ColorCorrectionEffect")
	cc.Name = "Grade"
	cc.Saturation = -0.12
	cc.Contrast = 0.12
	cc.TintColor = Color3.fromRGB(250, 252, 255)
	cc.Parent = Lighting
end

-- The figure (faceless man in a suit) ---------------------------------------------------------

local function figure(parent: Instance, cf: CFrame, scale: number?): Model
	local s = scale or 1
	local m = model(parent, "Figure")
	local function limb(name: string, size: Vector3, offset: Vector3, color: Color3): BasePart
		return decor(m, { Name = name, Size = size * s, CFrame = cf * CFrame.new(offset * s), Color = color, CastShadow = true })
	end
	local torso = limb("Torso", Vector3.new(2.2, 2.8, 1.1), Vector3.new(0, 4.4, 0), SUIT)
	limb("LegL", Vector3.new(0.95, 3, 0.95), Vector3.new(-0.55, 1.5, 0), SUIT)
	limb("LegR", Vector3.new(0.95, 3, 0.95), Vector3.new(0.55, 1.5, 0), SUIT)
	limb("ArmL", Vector3.new(0.75, 3.1, 0.75), Vector3.new(-1.5, 4.25, 0), SUIT)
	limb("ArmR", Vector3.new(0.75, 3.1, 0.75), Vector3.new(1.5, 4.25, 0), SUIT)
	limb("Shirt", Vector3.new(0.6, 2, 0.05), Vector3.new(0, 4.8, -0.56), Color3.fromRGB(235, 235, 235))
	limb("Tie", Vector3.new(0.25, 1.6, 0.06), Vector3.new(0, 4.7, -0.6), Color3.fromRGB(130, 20, 25))
	local head = limb("Head", Vector3.new(1.35, 1.6, 1.35), Vector3.new(0, 6.65, 0), SKIN)
	local mesh = Instance.new("SpecialMesh")
	mesh.MeshType = Enum.MeshType.Sphere
	mesh.Parent = head
	m.PrimaryPart = torso
	m:SetAttribute("Height", 7.5 * s)
	return m
end
World.figure = figure

-- Lobby ---------------------------------------------------------------------------------------

local function lobby(map: Folder): Built
	local m = model(map, "Lobby")
	local W, D, HT = 76, 70, 30
	local carpet = Color3.fromRGB(38, 62, 70)
	part(m, { Name = "Floor", Size = Vector3.new(W, 1, D), CFrame = CFrame.new(0, -0.5, 0), Color = carpet, Material = Enum.Material.Fabric })
	-- carpet runner to the elevator
	decor(m, { Size = Vector3.new(10, 0.05, D - 8), CFrame = CFrame.new(0, 0.03, 4), Color = Color3.fromRGB(120, 36, 40), Material = Enum.Material.Fabric })
	part(m, { Name = "Ceiling", Size = Vector3.new(W, 1, D), CFrame = CFrame.new(0, HT + 0.5, 0), Color = Color3.fromRGB(40, 38, 36) })
	local panel = Color3.fromRGB(92, 66, 46)
	for _, w in {
		{ Vector3.new(W, HT, 1), Vector3.new(0, HT / 2, -D / 2 - 0.5) },
		{ Vector3.new(W, HT, 1), Vector3.new(0, HT / 2, D / 2 + 0.5) },
		{ Vector3.new(1, HT, D), Vector3.new(-W / 2 - 0.5, HT / 2, 0) },
		{ Vector3.new(1, HT, D), Vector3.new(W / 2 + 0.5, HT / 2, 0) },
	} do
		part(m, { Size = w[1], CFrame = CFrame.new(w[2]), Color = panel, Material = Enum.Material.WoodPlanks })
	end
	-- dark wainscot band + gold rail all round
	for _, w in {
		{ Vector3.new(W, 5, 0.3), Vector3.new(0, 2.5, -D / 2 + 0.15) },
		{ Vector3.new(W, 5, 0.3), Vector3.new(0, 2.5, D / 2 - 0.15) },
		{ Vector3.new(0.3, 5, D), Vector3.new(-W / 2 + 0.15, 2.5, 0) },
		{ Vector3.new(0.3, 5, D), Vector3.new(W / 2 - 0.15, 2.5, 0) },
	} do
		decor(m, { Size = w[1], CFrame = CFrame.new(w[2]), Color = Color3.fromRGB(40, 30, 26), Material = Enum.Material.Wood })
		decor(m, { Size = w[1] * Vector3.new(1, 0, 1) + Vector3.new(0.2, 0.3, 0.2), CFrame = CFrame.new(w[2] + Vector3.new(0, 2.6, 0)), Color = Color3.fromRGB(200, 160, 70), Material = Enum.Material.Metal })
	end

	-- ceiling lamps
	for x = -24, 24, 24 do
		for z = -22, 22, 22 do
			local lamp = decor(m, { Size = Vector3.new(7, 0.4, 7), CFrame = CFrame.new(x, HT - 0.2, z), Color = Color3.fromRGB(255, 230, 190), Material = Enum.Material.Neon })
			local l = Instance.new("SurfaceLight")
			l.Face = Enum.NormalId.Bottom
			l.Range = 34
			l.Brightness = 1.4
			l.Angle = 150
			l.Color = Color3.fromRGB(255, 220, 175)
			l.Parent = lamp
		end
	end

	-- elevator (north wall, -Z)
	local ez = -D / 2
	local steel = Color3.fromRGB(150, 155, 160)
	part(m, { Size = Vector3.new(16, 14, 1.4), CFrame = CFrame.new(0, 7, ez + 0.3), Color = Color3.fromRGB(60, 55, 50), Material = Enum.Material.Metal })
	local doorL = decor(m, { Name = "ElevatorL", Size = Vector3.new(5.9, 11.5, 0.4), CFrame = CFrame.new(-3, 5.75, ez + 1.1), Color = steel, Material = Enum.Material.DiamondPlate })
	local doorR = decor(m, { Name = "ElevatorR", Size = Vector3.new(5.9, 11.5, 0.4), CFrame = CFrame.new(3, 5.75, ez + 1.1), Color = steel, Material = Enum.Material.DiamondPlate })
	doorL:SetAttribute("Fx", "elevator")
	doorR:SetAttribute("Fx", "elevator")
	-- light behind the doors when they open
	local inside = decor(m, { Size = Vector3.new(12, 11.5, 0.2), CFrame = CFrame.new(0, 5.75, ez + 0.95), Color = Color3.fromRGB(255, 240, 200), Material = Enum.Material.Neon })
	inside.Transparency = 0
	local sign = decor(m, { Size = Vector3.new(16, 3, 0.4), CFrame = CFrame.new(0, 16, ez + 1.1), Color = Color3.fromRGB(20, 20, 24), Material = Enum.Material.Metal })
	local sg = gui(sign, Enum.NormalId.Back, 30)
	sg.LightInfluence = 0
	text(sg, { Text = "▼ START SHIFT ▼", TextColor3 = Color3.fromRGB(255, 70, 60), Font = Enum.Font.Arcade })
	local pad = decor(m, { Name = "ElevatorPad", Size = Vector3.new(12, 0.2, 6), CFrame = CFrame.new(0, 0.1, ez + 4.5), Color = Color3.fromRGB(255, 70, 60), Material = Enum.Material.Neon, Transparency = 0.35 })
	pad:SetAttribute("Fx", "pulse")
	-- floor indicator arrows above elevator
	local ind = decor(m, { Size = Vector3.new(4, 1.4, 0.3), CFrame = CFrame.new(0, 13.3, ez + 1.1), Color = Color3.fromRGB(10, 10, 10) })
	local ig = gui(ind, Enum.NormalId.Back, 40)
	ig.LightInfluence = 0
	text(ig, { Text = "B8 ▼", TextColor3 = Color3.fromRGB(255, 150, 60), Font = Enum.Font.Arcade })

	-- company sign on the back wall (+Z), above reception
	local logo = decor(m, { Size = Vector3.new(34, 6, 0.5), CFrame = CFrame.new(0, 19, D / 2 - 0.3), Color = Color3.fromRGB(30, 22, 18), Material = Enum.Material.Wood })
	local lg = gui(logo, Enum.NormalId.Front, 20)
	lg.LightInfluence = 0
	text(lg, { Text = "NIGHT SHIFT INC.", TextColor3 = Color3.fromRGB(235, 200, 110), Font = Enum.Font.Bodoni, Size = UDim2.fromScale(1, 0.7) })
	text(lg, { Text = "we never close", TextColor3 = Color3.fromRGB(200, 160, 110), Font = Enum.Font.Bodoni, Size = UDim2.fromScale(1, 0.3), Position = UDim2.fromScale(0, 0.7) })

	-- reception desk
	local desk = Color3.fromRGB(60, 42, 30)
	part(m, { Size = Vector3.new(20, 4, 3), CFrame = CFrame.new(0, 2, D / 2 - 12), Color = desk, Material = Enum.Material.Wood })
	part(m, { Size = Vector3.new(21, 0.4, 4), CFrame = CFrame.new(0, 4.2, D / 2 - 12), Color = Color3.fromRGB(30, 30, 34), Material = Enum.Material.Marble })
	decor(m, { Size = Vector3.new(2.6, 1.8, 0.2), CFrame = CFrame.new(-4, 5.4, D / 2 - 11.4), Color = Color3.fromRGB(20, 20, 24) })
	local screen = decor(m, { Size = Vector3.new(2.3, 1.5, 0.05), CFrame = CFrame.new(-4, 5.4, D / 2 - 11.55), Color = Color3.fromRGB(60, 140, 255), Material = Enum.Material.Neon })
	screen.Transparency = 0.2
	decor(m, { Size = Vector3.new(0.6, 0.6, 0.6), CFrame = CFrame.new(4, 4.7, D / 2 - 12), Color = Color3.fromRGB(220, 200, 80), Material = Enum.Material.Metal, Shape = Enum.PartType.Ball })
	figure(m, CFrame.new(0, 0, D / 2 - 9.4) * CFrame.Angles(0, math.pi, 0)).Name = "Receptionist"

	-- couches + plants + windows
	local function couch(cf: CFrame)
		local c = Color3.fromRGB(110, 30, 36)
		part(m, { Size = Vector3.new(10, 1.6, 3.4), CFrame = cf * CFrame.new(0, 0.8, 0), Color = c, Material = Enum.Material.Fabric })
		part(m, { Size = Vector3.new(10, 2.6, 0.8), CFrame = cf * CFrame.new(0, 2.1, 1.3), Color = c, Material = Enum.Material.Fabric })
		part(m, { Size = Vector3.new(0.8, 2.2, 3.4), CFrame = cf * CFrame.new(-4.6, 1.5, 0), Color = c, Material = Enum.Material.Fabric })
		part(m, { Size = Vector3.new(0.8, 2.2, 3.4), CFrame = cf * CFrame.new(4.6, 1.5, 0), Color = c, Material = Enum.Material.Fabric })
	end
	couch(CFrame.new(-26, 0, 12) * CFrame.Angles(0, -math.pi / 2, 0))
	couch(CFrame.new(26, 0, 12) * CFrame.Angles(0, math.pi / 2, 0))
	local function plant(cf: CFrame, s: number)
		part(m, { Size = Vector3.new(2.4, 2.4, 2.4) * s, CFrame = cf * CFrame.new(0, 1.2 * s, 0) * CFrame.Angles(0, 0, math.pi / 2), Color = Color3.fromRGB(180, 170, 150), Material = Enum.Material.Concrete, Shape = Enum.PartType.Cylinder })
		for i = 1, 6 do
			local a = i * math.pi / 3
			decor(m, { Size = Vector3.new(2.2, 2.2, 2.2) * s, CFrame = cf * CFrame.new(math.cos(a) * 0.9 * s, (3.4 + (i % 2) * 1.2) * s, math.sin(a) * 0.9 * s), Color = Color3.fromRGB(46, 110, 50), Material = Enum.Material.Grass, Shape = Enum.PartType.Ball })
		end
	end
	for _, p in { Vector3.new(-12, 0, -D / 2 + 4), Vector3.new(12, 0, -D / 2 + 4), Vector3.new(-W / 2 + 4, 0, D / 2 - 4), Vector3.new(W / 2 - 4, 0, D / 2 - 4) } do
		plant(CFrame.new(p), 1.2)
	end

	-- windows on the side walls: night city behind glass
	for _, sx in { -1, 1 } do
		for _, z in { -14, 30 } do
			if z == 30 then
				continue
			end
			local wx = sx * (W / 2 - 0.2)
			decor(m, { Size = Vector3.new(0.3, 10, 16), CFrame = CFrame.new(wx, 17, z), Color = Color3.fromRGB(8, 12, 30), Material = Enum.Material.Glass, Transparency = 0 })
			for i = 1, 26 do
				local r = Random.new(i * 7 + (sx + 2) * 101)
				local c = if r:NextNumber() < 0.7 then Color3.fromRGB(255, 210, 120) else Color3.fromRGB(120, 180, 255)
				decor(m, { Size = Vector3.new(0.1, r:NextNumber(0.3, 0.7), r:NextNumber(0.3, 0.8)), CFrame = CFrame.new(wx - sx * 0.2, r:NextNumber(12.8, 21), z + r:NextNumber(-7.5, 7.5)), Color = c, Material = Enum.Material.Neon })
			end
			for _, d in { -8, 0, 8 } do
				decor(m, { Size = Vector3.new(0.5, 10.4, 0.4), CFrame = CFrame.new(wx - sx * 0.2, 17, z + d), Color = Color3.fromRGB(30, 26, 22), Material = Enum.Material.Metal })
			end
		end
	end

	local spawn = Instance.new("SpawnLocation")
	spawn.Name = "Spawn"
	spawn.Anchored = true
	spawn.Size = Vector3.new(8, 0.2, 8)
	spawn.CFrame = CFrame.new(0, 0.1, 18) * CFrame.Angles(0, 0, 0)
	spawn.Transparency = 1
	spawn.CanCollide = false
	spawn.Duration = 0
	spawn.Parent = m

	local boards = {
		CFrame.lookAt(Vector3.new(-W / 2 + 1.2, 14, -14), Vector3.new(0, 14, -14)),
		CFrame.lookAt(Vector3.new(W / 2 - 1.2, 14, -14), Vector3.new(0, 14, -14)),
		CFrame.lookAt(Vector3.new(-W / 2 + 1.2, 14, 14), Vector3.new(0, 14, 14)),
	}
	return {
		map = map,
		spawn = CFrame.new(0, 3, 18) * CFrame.Angles(0, 0, 0),
		elevator = Vector3.new(0, 0, ez + 4.5),
		boardsAt = boards,
	}
end

local function light(parent: Instance, cf: CFrame): BasePart
	local p = decor(parent, { Name = "Light", Size = Vector3.new(5, 0.2, 2.2), CFrame = cf, Color = LIGHT, Material = Enum.Material.Neon })
	decor(parent, { Size = Vector3.new(5.6, 0.12, 2.8), CFrame = cf * CFrame.new(0, 0.1, 0), Color = Color3.fromRGB(150, 150, 150), Material = Enum.Material.Metal })
	local l = Instance.new("SurfaceLight")
	l.Face = Enum.NormalId.Bottom
	l.Range = 20
	l.Brightness = 1.25
	l.Angle = 140
	l.Color = LIGHT
	l.Shadows = true
	l.Parent = p
	return p
end

-- Corridor shell ------------------------------------------------------------------------------

function World.origin(slot: number): CFrame
	return CFrame.new(1200 + (slot - 1) * 260, 0, 0)
end

function World.corridor(slot: number, parent: Instance): Corridor
	local o = World.origin(slot)
	local m = model(parent, "C" .. slot)
	local z0, z1 = -4, H.endZ
	local len = z1 - z0
	local zc = (z0 + z1) / 2

	-- floor + checker tiles
	part(m, { Name = "Floor", Size = Vector3.new(H.width, 1, len), CFrame = o * CFrame.new(0, -0.5, zc), Color = FLOOR_A })
	local tile = 3.5
	local col = 0
	local z = z0
	while z < z1 - 0.01 do
		for i = 0, 3 do
			if (i + col) % 2 == 0 then
				decor(m, { Size = Vector3.new(tile - 0.08, 0.02, tile - 0.08), CFrame = o * CFrame.new(-HALF + tile / 2 + i * tile, 0.01, z + tile / 2), Color = FLOOR_B })
			end
		end
		col += 1
		z += tile
	end
	-- ceiling
	part(m, { Name = "Ceiling", Size = Vector3.new(H.width + 2, 1, len), CFrame = o * CFrame.new(0, TOP + 0.5, zc), Color = CEIL })
	-- walls (side A has the exit turn at turnZ..endZ)
	local aLen = H.turnZ - z0
	part(m, { Name = "WallA", Size = Vector3.new(1, TOP, aLen), CFrame = o * CFrame.new(HALF + 0.5, TOP / 2, z0 + aLen / 2), Color = WALL })
	part(m, { Name = "WallB", Size = Vector3.new(1, TOP, len), CFrame = o * CFrame.new(-HALF - 0.5, TOP / 2, zc), Color = WALL })
	part(m, { Name = "WallBack", Size = Vector3.new(H.width + 2, TOP, 1), CFrame = o * CFrame.new(0, TOP / 2, z0 - 0.5), Color = WALL })
	part(m, { Name = "WallEnd", Size = Vector3.new(H.width + 2, TOP, 1), CFrame = o * CFrame.new(0, TOP / 2, z1 + 0.5), Color = WALL })
	-- wainscot, rail and baseboard along the long walls
	local function trim(side: number, za: number, zb: number)
		local l = zb - za
		local zm = (za + zb) / 2
		local x = side * (HALF - 0.05)
		decor(m, { Size = Vector3.new(0.1, 3.2, l), CFrame = o * CFrame.new(x, 1.6, zm), Color = WAINSCOT })
		decor(m, { Size = Vector3.new(0.25, 0.25, l), CFrame = o * CFrame.new(side * (HALF - 0.12), 3.25, zm), Color = Color3.fromRGB(80, 88, 92) })
		decor(m, { Size = Vector3.new(0.2, 0.5, l), CFrame = o * CFrame.new(side * (HALF - 0.1), 0.25, zm), Color = BASEBOARD })
		decor(m, { Size = Vector3.new(0.3, 0.3, l), CFrame = o * CFrame.new(side * (HALF - 0.15), TOP - 0.15, zm), Color = Color3.fromRGB(170, 170, 165) })
	end
	trim(1, z0, H.turnZ)
	trim(-1, z0, z1)

	-- exit turn (toward +X)
	local sx0, sx1 = HALF, H.exitX + 2
	local sLen = sx1 - sx0
	local sz = (H.turnZ + z1) / 2
	local sw = z1 - H.turnZ
	part(m, { Name = "TurnFloor", Size = Vector3.new(sLen, 1, sw), CFrame = o * CFrame.new(sx0 + sLen / 2, -0.5, sz), Color = FLOOR_A })
	for i = 0, math.floor(sLen / tile) - 1 do
		for j = 0, 3 do
			if (i + j) % 2 == 0 then
				decor(m, { Size = Vector3.new(tile - 0.08, 0.02, tile - 0.08), CFrame = o * CFrame.new(sx0 + tile / 2 + i * tile, 0.01, H.turnZ + tile / 2 + j * tile), Color = FLOOR_B })
			end
		end
	end
	part(m, { Name = "TurnCeiling", Size = Vector3.new(sLen, 1, sw + 2), CFrame = o * CFrame.new(sx0 + sLen / 2, TOP + 0.5, sz), Color = CEIL })
	part(m, { Size = Vector3.new(sLen + 1, TOP, 1), CFrame = o * CFrame.new(sx0 + sLen / 2, TOP / 2, H.turnZ - 0.5), Color = WALL })
	part(m, { Size = Vector3.new(sLen + 1, TOP, 1), CFrame = o * CFrame.new(sx0 + sLen / 2, TOP / 2, z1 + 0.5), Color = WALL })
	part(m, { Size = Vector3.new(1, TOP, sw), CFrame = o * CFrame.new(sx1 + 0.5, TOP / 2, sz), Color = WALL })
	for _, zz in { H.turnZ + 0.05, z1 - 0.05 } do
		decor(m, { Size = Vector3.new(sLen, 3.2, 0.1), CFrame = o * CFrame.new(sx0 + sLen / 2, 1.6, zz), Color = WAINSCOT })
		decor(m, { Size = Vector3.new(sLen, 0.5, 0.2), CFrame = o * CFrame.new(sx0 + sLen / 2, 0.25, zz), Color = BASEBOARD })
	end
	-- exit double door
	for _, dz in { -2.1, 2.1 } do
		local d = decor(m, { Size = Vector3.new(0.3, 8.5, 4), CFrame = o * CFrame.new(sx1 - 0.15, 4.25, sz + dz), Color = Color3.fromRGB(70, 110, 80), Material = Enum.Material.Metal })
		decor(m, { Size = Vector3.new(0.35, 0.3, 2.6), CFrame = d.CFrame * CFrame.new(-0.1, 0, -dz * 0.2), Color = Color3.fromRGB(190, 190, 195), Material = Enum.Material.Metal })
	end
	local exitSign = decor(m, { Size = Vector3.new(0.3, 1.4, 4), CFrame = o * CFrame.new(sx1 - 0.2, 9.8, sz), Color = Color3.fromRGB(40, 200, 90), Material = Enum.Material.Neon })
	local eg = gui(exitSign, Enum.NormalId.Left, 40)
	eg.LightInfluence = 0
	text(eg, { Text = "EXIT", TextColor3 = Color3.new(1, 1, 1) })
	local glow = Instance.new("PointLight")
	glow.Color = Color3.fromRGB(80, 255, 130)
	glow.Range = 12
	glow.Brightness = 1.2
	glow.Parent = exitSign

	-- back "stairs" doors
	for _, dx in { -2.1, 2.1 } do
		local d = decor(m, { Size = Vector3.new(4, 8.5, 0.3), CFrame = o * CFrame.new(dx, 4.25, z0 + 0.15), Color = Color3.fromRGB(140, 145, 150), Material = Enum.Material.Metal })
		decor(m, { Size = Vector3.new(2.6, 0.3, 0.35), CFrame = d.CFrame * CFrame.new(-dx * 0.2, 0, 0.1), Color = Color3.fromRGB(190, 190, 195), Material = Enum.Material.Metal })
	end
	local stairs = decor(m, { Size = Vector3.new(4, 1.2, 0.3), CFrame = o * CFrame.new(0, 9.8, z0 + 0.2), Color = Color3.fromRGB(30, 30, 34) })
	local sgui = gui(stairs, Enum.NormalId.Back, 40)
	sgui.LightInfluence = 0
	text(sgui, { Text = "STAIRS", TextColor3 = Color3.fromRGB(255, 220, 120) })

	-- fluorescent hum
	local humPart = decor(m, { Name = "Hum", Size = Vector3.new(1, 1, 1), CFrame = o * CFrame.new(0, TOP - 1, 80), Transparency = 1 })
	local hum = Instance.new("Sound")
	hum.SoundId = "rbxassetid://9069696118"
	hum.Looped = true
	hum.Volume = 0.35
	hum.RollOffMode = Enum.RollOffMode.Linear
	hum.RollOffMinDistance = 60
	hum.RollOffMaxDistance = 140
	hum.Parent = humPart
	hum:Play()

	-- ceiling lights live in the shell: new lights take a moment to switch on, so they're
	-- never rebuilt, only reset by World.dress
	local lf = model(m, "Lights")
	local lights = {}
	for lz = 10, 150, 20 do
		table.insert(lights, light(lf, o * CFrame.new(0, TOP - 0.12, lz)))
	end
	table.insert(lights, light(lf, o * CFrame.new(HALF + 12, TOP - 0.12, (H.turnZ + H.endZ) / 2) * CFrame.Angles(0, math.pi / 2, 0)))

	return { slot = slot, origin = o, model = m, props = nil, hum = hum, lights = lights, lightsFolder = lf }
end

-- Props (rebuilt every floor) -----------------------------------------------------------------

export type Props = {
	model: Model,
	lights: { BasePart },
	lightsFolder: Model,
	doors: { [number]: Model },
	plates: { [number]: TextLabel },
	poster: TextLabel,
	posterSub: TextLabel,
	employee: { name: TextLabel, image: ImageLabel },
	extinguisher: Model,
	clock: BasePart,
	clockLabel: TextLabel,
	vending: Model,
	cooler: BasePart,
	bench: Model,
	chair: Model,
	plant: Model,
	painting: BasePart,
	camera: Model,
	vent: BasePart,
	wetSign: Model,
	exitSign: TextLabel,
	floorSign: TextLabel,
}


local function door(parent: Instance, o: CFrame, side: number, z: number, number: number): (Model, TextLabel)
	local m = model(parent, "Door" .. number)
	local cf, face = onWall(o, side, z, 4.1, 0.3)
	local d = decor(m, { Name = "Leaf", Size = Vector3.new(0.3, 8.2, 4), CFrame = cf, Color = DOOR, Material = Enum.Material.Wood, CastShadow = false })
	local cfFrame = onWall(o, side, z, 0, 0.5)
	decor(m, { Size = Vector3.new(0.5, 0.5, 5), CFrame = cfFrame * CFrame.new(0, 8.45, 0), Color = FRAME })
	decor(m, { Size = Vector3.new(0.5, 8.7, 0.5), CFrame = cfFrame * CFrame.new(0, 4.35, -2.25), Color = FRAME })
	decor(m, { Size = Vector3.new(0.5, 8.7, 0.5), CFrame = cfFrame * CFrame.new(0, 4.35, 2.25), Color = FRAME })
	-- window strip + handle
	decor(m, { Size = Vector3.new(0.34, 2.4, 0.5), CFrame = d.CFrame * CFrame.new(0, 1.8, 1.1), Color = Color3.fromRGB(25, 28, 34), Material = Enum.Material.Glass })
	decor(m, { Size = Vector3.new(0.4, 0.25, 0.8), CFrame = d.CFrame * CFrame.new(-side * 0.2, -0.3, -1.4), Color = Color3.fromRGB(200, 200, 205), Material = Enum.Material.Metal })
	local plateCf = onWall(o, side, z + 3.4 * side, 6, 0.1)
	local plate = decor(m, { Name = "Plate", Size = Vector3.new(0.1, 0.9, 1.5), CFrame = plateCf, Color = Color3.fromRGB(30, 34, 40) })
	local pg = gui(plate, face, 60)
	local label = text(pg, { Text = tostring(number), TextColor3 = Color3.fromRGB(230, 230, 230), Font = Enum.Font.GothamBold })
	m.PrimaryPart = d
	return m, label
end

local function poster(parent: Instance, o: CFrame, side: number, z: number, y: number, w: number, h: number, bg: Color3): (BasePart, SurfaceGui)
	local cf, face = onWall(o, side, z, y, 0.08)
	local p = decor(parent, { Name = "Poster", Size = Vector3.new(0.08, h, w), CFrame = cf, Color = bg })
	decor(parent, { Size = Vector3.new(0.05, h + 0.3, w + 0.3), CFrame = cf * CFrame.new(side * 0.03, 0, 0), Color = Color3.fromRGB(40, 40, 40) })
	return p, gui(p, face, 50)
end

function World.dress(c: Corridor, floor: number, player: Player?): Props
	if c.props then
		c.props:Destroy()
	end
	local o = c.origin
	local m = model(c.model, "Props")
	c.props = m
	local P = {} :: any
	P.model = m

	-- reset the shell's ceiling lights
	P.lightsFolder = c.lightsFolder
	P.lights = c.lights
	for _, l in c.lights do
		l.Color = LIGHT
		l.Material = Enum.Material.Neon
		local sl = l:FindFirstChildOfClass("SurfaceLight")
		if sl then
			sl.Enabled = true
			sl.Color = LIGHT
		end
	end

	-- start room: floor sign (side B) and rules (side A)
	local fs, fsg = poster(m, o, -1, 12, 7, 4.2, 4.8, Color3.fromRGB(255, 205, 40))
	fs.Name = "FloorSign"
	fsg.LightInfluence = 0.3
	P.floorSign = text(fsg, { Text = tostring(floor), Size = UDim2.fromScale(1, 0.8), Position = UDim2.fromScale(0, 0.14), Font = Enum.Font.GothamBlack })
	text(fsg, { Text = "FLOOR", Size = UDim2.fromScale(1, 0.16), Position = UDim2.fromScale(0, 0.02), Font = Enum.Font.GothamBold })
	local _, rg = poster(m, o, 1, 12, 6.3, 4.4, 5.6, Color3.fromRGB(245, 245, 240))
	text(rg, { Text = "NIGHT SHIFT RULES", Size = UDim2.fromScale(0.9, 0.12), Position = UDim2.fromScale(0.05, 0.04), TextColor3 = Color3.fromRGB(180, 20, 20) })
	text(rg, {
		Text = "1. Don't overlook any anomalies.\n\n2. If you find an anomaly, turn back immediately.\n\n3. If you don't find an anomaly, do not turn back.\n\n4. Reach Floor 8 to clock out.",
		Size = UDim2.fromScale(0.86, 0.76),
		Position = UDim2.fromScale(0.07, 0.2),
		TextXAlignment = Enum.TextXAlignment.Left,
		TextYAlignment = Enum.TextYAlignment.Top,
		Font = Enum.Font.GothamMedium,
		TextColor3 = Color3.fromRGB(30, 30, 30),
	})

	-- doors
	P.doors = {}
	P.plates = {}
	for _, d in { { 1, 40, 101 }, { 1, 80, 103 }, { 1, 120, 105 }, { -1, 60, 102 }, { -1, 100, 104 }, { -1, 140, 106 } } do
		local dm, label = door(m, o, d[1], d[2], d[3])
		P.doors[d[3]] = dm
		P.plates[d[3]] = label
	end

	-- side A: extinguisher, safety poster, cooler, painting, vending
	local ext = model(m, "Extinguisher")
	local ecf = onWall(o, 1, 47, 0, 1)
	decor(ext, { Size = Vector3.new(2.4, 0.9, 0.9), CFrame = ecf * CFrame.new(-0.05, 3.2, 0) * CFrame.Angles(0, 0, math.pi / 2), Color = Color3.fromRGB(200, 25, 25), Shape = Enum.PartType.Cylinder, CastShadow = true })
	decor(ext, { Size = Vector3.new(0.5, 0.5, 0.5), CFrame = ecf * CFrame.new(-0.05, 4.55, 0), Color = Color3.fromRGB(30, 30, 30) })
	decor(ext, { Size = Vector3.new(0.15, 1.6, 0.15), CFrame = ecf * CFrame.new(-0.4, 3.4, 0.45), Color = Color3.fromRGB(20, 20, 20) })
	P.extinguisher = ext
	local _, fireg = poster(m, o, 1, 47, 6.2, 1.3, 0.9, Color3.fromRGB(200, 25, 25))
	text(fireg, { Text = "FIRE", TextColor3 = Color3.new(1, 1, 1), Size = UDim2.fromScale(0.8, 0.8), Position = UDim2.fromScale(0.1, 0.1) })

	local _, sg = poster(m, o, 1, 60, 6, 3.6, 4.8, Color3.fromRGB(255, 225, 60))
	frame(sg, { Size = UDim2.fromScale(1, 0.22), BackgroundColor3 = Color3.fromRGB(20, 110, 60) })
	text(sg, { Text = "SAFETY FIRST", Size = UDim2.fromScale(0.9, 0.16), Position = UDim2.fromScale(0.05, 0.03), TextColor3 = Color3.new(1, 1, 1) })
	P.poster = text(sg, { Text = "⚠", Size = UDim2.fromScale(0.8, 0.4), Position = UDim2.fromScale(0.1, 0.25), TextColor3 = Color3.fromRGB(30, 30, 30) })
	P.posterSub = text(sg, {
		Text = "Report anything unusual to your supervisor.",
		Size = UDim2.fromScale(0.84, 0.28),
		Position = UDim2.fromScale(0.08, 0.68),
		Font = Enum.Font.GothamBold,
		TextColor3 = Color3.fromRGB(30, 30, 30),
	})

	local ccf = onWall(o, 1, 90, 0, 2)
	decor(m, { Size = Vector3.new(1.8, 3.4, 1.8), CFrame = ccf * CFrame.new(-0.1, 1.7, 0), Color = Color3.fromRGB(235, 235, 235), CastShadow = true })
	P.cooler = decor(m, { Name = "Bottle", Size = Vector3.new(2.2, 1.6, 1.6), CFrame = ccf * CFrame.new(-0.1, 4.5, 0) * CFrame.Angles(0, 0, math.pi / 2), Color = Color3.fromRGB(140, 200, 255), Material = Enum.Material.Glass, Transparency = 0.25, Shape = Enum.PartType.Cylinder })
	decor(m, { Size = Vector3.new(0.3, 0.3, 0.3), CFrame = ccf * CFrame.new(-0.95, 2.8, 0.4), Color = Color3.fromRGB(60, 120, 255) })

	local pcf, pface = onWall(o, 1, 100, 6.4, 0.2)
	decor(m, { Size = Vector3.new(0.18, 3.6, 5.4), CFrame = pcf, Color = Color3.fromRGB(120, 90, 40), Material = Enum.Material.Wood })
	local painting = decor(m, { Name = "Painting", Size = Vector3.new(0.2, 3, 4.8), CFrame = pcf * CFrame.new(-0.02, 0, 0), Color = Color3.fromRGB(150, 200, 255) })
	local pg = gui(painting, pface, 40)
	local sky = frame(pg, { Size = UDim2.fromScale(1, 1), BackgroundColor3 = Color3.fromRGB(120, 180, 255), ClipsDescendants = true })
	local g = Instance.new("UIGradient")
	g.Rotation = 90
	g.Color = ColorSequence.new(Color3.fromRGB(80, 140, 240), Color3.fromRGB(255, 200, 150))
	g.Parent = sky
	local sun = frame(sky, { Size = UDim2.fromScale(0.2, 0.33), Position = UDim2.fromScale(0.66, 0.14), BackgroundColor3 = Color3.fromRGB(255, 230, 120) })
	local sc = Instance.new("UICorner")
	sc.CornerRadius = UDim.new(1, 0)
	sc.Parent = sun
	local hill = frame(sky, { Size = UDim2.fromScale(1.3, 0.8), Position = UDim2.fromScale(-0.35, 0.55), BackgroundColor3 = Color3.fromRGB(60, 150, 70) })
	local hc = Instance.new("UICorner")
	hc.CornerRadius = UDim.new(0.5, 0)
	hc.Parent = hill
	local hill2 = frame(sky, { Size = UDim2.fromScale(1, 0.7), Position = UDim2.fromScale(0.35, 0.68), BackgroundColor3 = Color3.fromRGB(40, 120, 55) })
	local hc2 = Instance.new("UICorner")
	hc2.CornerRadius = UDim.new(0.5, 0)
	hc2.Parent = hill2
	-- a little house
	frame(sky, { Size = UDim2.fromScale(0.12, 0.16), Position = UDim2.fromScale(0.2, 0.52), BackgroundColor3 = Color3.fromRGB(240, 235, 220) })
	frame(sky, { Size = UDim2.fromScale(0.16, 0.08), Position = UDim2.fromScale(0.18, 0.46), BackgroundColor3 = Color3.fromRGB(170, 50, 40) })
	P.painting = painting

	local vend = model(m, "Vending")
	local vcf = onWall(o, 1, 136, 0, 3)
	local body = decor(vend, { Name = "Body", Size = Vector3.new(3, 7.4, 4), CFrame = vcf * CFrame.new(0, 3.7, 0), Color = Color3.fromRGB(190, 30, 40), CanCollide = true, CastShadow = true })
	decor(vend, { Size = Vector3.new(0.05, 4.6, 2.6), CFrame = body.CFrame * CFrame.new(-1.52, 0.6, -0.5), Color = Color3.fromRGB(25, 25, 30) })
	local glass = decor(vend, { Name = "Glass", Size = Vector3.new(0.05, 4.6, 2.6), CFrame = body.CFrame * CFrame.new(-1.9, 0.6, -0.5), Color = Color3.fromRGB(170, 200, 220), Material = Enum.Material.Glass, Transparency = 0.6 })
	for row = 0, 3 do
		for colI = 0, 3 do
			local snack = Color3.fromHSV(((row * 4 + colI) * 0.13) % 1, 0.7, 0.95)
			decor(vend, { Size = Vector3.new(0.3, 0.6, 0.45), CFrame = glass.CFrame * CFrame.new(0.2, 1.6 - row * 1.1, -0.9 + colI * 0.6), Color = snack })
			if colI == 0 then
				decor(vend, { Size = Vector3.new(0.38, 0.06, 2.5), CFrame = glass.CFrame * CFrame.new(0.19, 1.27 - row * 1.1, 0), Color = Color3.fromRGB(120, 120, 130), Material = Enum.Material.Metal })
			end
		end
	end
	for _, dz in { -1.85, 0.85 } do
		decor(vend, { Size = Vector3.new(0.4, 4.8, 0.1), CFrame = body.CFrame * CFrame.new(-1.7, 0.6, dz), Color = Color3.fromRGB(150, 20, 30) })
	end
	for _, dy in { -1.75, 2.95 } do
		decor(vend, { Size = Vector3.new(0.4, 0.1, 2.8), CFrame = body.CFrame * CFrame.new(-1.7, dy, -0.5), Color = Color3.fromRGB(150, 20, 30) })
	end
	decor(vend, { Size = Vector3.new(0.1, 1.6, 0.9), CFrame = body.CFrame * CFrame.new(-1.52, 1, 1.4), Color = Color3.fromRGB(30, 30, 30) })
	decor(vend, { Size = Vector3.new(0.12, 0.8, 2.6), CFrame = body.CFrame * CFrame.new(-1.52, -2.6, -0.5), Color = Color3.fromRGB(15, 15, 15) })
	local vl = Instance.new("SurfaceLight")
	vl.Face = Enum.NormalId.Left
	vl.Color = Color3.fromRGB(255, 180, 180)
	vl.Brightness = 0.6
	vl.Range = 8
	vl.Parent = body
	vend.PrimaryPart = body
	P.vending = vend

	-- side B: clock, bench + chair, employee poster, plant, trash
	local kcf, kface = onWall(o, -1, 30, 9, 0.3)
	local clock = decor(m, { Name = "Clock", Size = Vector3.new(0.3, 1.2, 3), CFrame = kcf, Color = Color3.fromRGB(15, 15, 15) })
	local kg = gui(clock, kface, 50)
	kg.LightInfluence = 0
	P.clockLabel = text(kg, { Text = "02:14", TextColor3 = Color3.fromRGB(255, 50, 40), Font = Enum.Font.Arcade })
	P.clock = clock
	clock:SetAttribute("Fx", "clock")
	clock:SetAttribute("Start", 2 * 3600 + 14 * 60 + 5)
	clock:SetAttribute("Rate", 1)

	local bench = model(m, "Bench")
	local bcf = onWall(o, -1, 72, 0, 2.2)
	local seat = decor(bench, { Size = Vector3.new(2, 0.4, 6), CFrame = bcf * CFrame.new(0, 1.8, 0), Color = Color3.fromRGB(70, 70, 80), CanCollide = true, CastShadow = true })
	for _, dz in { -2.6, 2.6 } do
		decor(bench, { Size = Vector3.new(1.8, 1.6, 0.3), CFrame = bcf * CFrame.new(0, 0.8, dz), Color = Color3.fromRGB(40, 40, 45) })
	end
	bench.PrimaryPart = seat
	P.bench = bench

	local chair = model(m, "Chair")
	local chcf = o * CFrame.new(-HALF + 3.2, 0, 78) * CFrame.Angles(0, -math.pi / 2, 0)
	local cseat = decor(chair, { Name = "Seat", Size = Vector3.new(2.2, 0.4, 2.2), CFrame = chcf * CFrame.new(0, 2, 0), Color = Color3.fromRGB(35, 35, 40), CastShadow = true })
	decor(chair, { Size = Vector3.new(2.2, 2.6, 0.35), CFrame = chcf * CFrame.new(0, 3.4, 1), Color = Color3.fromRGB(35, 35, 40), CastShadow = true })
	decor(chair, { Size = Vector3.new(0.3, 1.8, 0.3), CFrame = chcf * CFrame.new(0, 0.9, 0), Color = Color3.fromRGB(120, 120, 125), Material = Enum.Material.Metal })
	for i = 0, 4 do
		local a = i * math.pi * 2 / 5
		decor(chair, { Size = Vector3.new(0.25, 0.2, 1.3), CFrame = chcf * CFrame.new(0, 0.15, 0) * CFrame.Angles(0, a, 0) * CFrame.new(0, 0, 0.6), Color = Color3.fromRGB(30, 30, 30) })
	end
	chair.PrimaryPart = cseat
	P.chair = chair

	local _, eg = poster(m, o, -1, 88, 6.2, 3.4, 4.4, Color3.fromRGB(245, 240, 225))
	text(eg, { Text = "EMPLOYEE OF THE MONTH", Size = UDim2.fromScale(0.9, 0.12), Position = UDim2.fromScale(0.05, 0.04), TextColor3 = Color3.fromRGB(30, 60, 140) })
	local img = Instance.new("ImageLabel")
	img.Size = UDim2.fromScale(0.7, 0.54)
	img.Position = UDim2.fromScale(0.15, 0.2)
	img.BackgroundColor3 = Color3.fromRGB(200, 210, 230)
	img.BorderSizePixel = 0
	img.Image = "rbxthumb://type=AvatarHeadShot&id=156&w=150&h=150"
	img.Parent = eg
	local ename = text(eg, { Text = "GARY P.", Size = UDim2.fromScale(0.9, 0.14), Position = UDim2.fromScale(0.05, 0.8), TextColor3 = Color3.fromRGB(30, 30, 30) })
	P.employee = { name = ename, image = img }

	local plant = model(m, "Plant")
	local plcf = o * CFrame.new(-HALF + 1.6, 0, 112)
	local pot = decor(plant, { Size = Vector3.new(1.8, 2, 2), CFrame = plcf * CFrame.new(0, 1, 0) * CFrame.Angles(0, 0, math.pi / 2), Color = Color3.fromRGB(190, 110, 70), Material = Enum.Material.Concrete, Shape = Enum.PartType.Cylinder, CanCollide = true, CastShadow = true })
	for i = 1, 7 do
		local a = i * math.pi * 2 / 7
		decor(plant, { Size = Vector3.new(1.6, 1.6, 1.6), CFrame = plcf * CFrame.new(math.cos(a) * 0.6, 2.6 + (i % 3) * 0.7, math.sin(a) * 0.6), Color = Color3.fromRGB(50, 120, 55), Material = Enum.Material.Grass, Shape = Enum.PartType.Ball, CastShadow = true })
	end
	plant.PrimaryPart = pot
	P.plant = plant

	decor(m, { Size = Vector3.new(1.4, 2, 1.4), CFrame = o * CFrame.new(-HALF + 1, 1, 150) * CFrame.Angles(0, 0, math.pi / 2), Color = Color3.fromRGB(90, 95, 100), Material = Enum.Material.Metal, Shape = Enum.PartType.Cylinder, CanCollide = true })

	-- ceiling: vent, hanging exit sign, security camera
	P.vent = decor(m, { Name = "Vent", Size = Vector3.new(3, 0.1, 3), CFrame = o * CFrame.new(3, TOP - 0.05, 95), Color = Color3.fromRGB(150, 150, 150), Material = Enum.Material.DiamondPlate })
	for i = -1, 1 do
		decor(m, { Size = Vector3.new(2.6, 0.12, 0.2), CFrame = o * CFrame.new(3, TOP - 0.1, 95 + i * 0.8), Color = Color3.fromRGB(60, 60, 60) })
	end

	local hang = decor(m, { Size = Vector3.new(4.6, 1.3, 0.3), CFrame = o * CFrame.new(0, TOP - 1.4, 146), Color = Color3.fromRGB(30, 180, 80), Material = Enum.Material.Neon })
	for _, dx in { -1.8, 1.8 } do
		decor(m, { Size = Vector3.new(0.08, 0.8, 0.08), CFrame = o * CFrame.new(dx, TOP - 0.35, 146), Color = Color3.fromRGB(60, 60, 60) })
	end
	local hg = gui(hang, Enum.NormalId.Front, 40)
	hg.LightInfluence = 0
	P.exitSign = text(hg, { Text = "← EXIT", TextColor3 = Color3.new(1, 1, 1) })

	local cam = model(m, "Camera")
	local camBase = o * CFrame.new(-HALF + 1.2, TOP - 0.6, 157)
	decor(cam, { Size = Vector3.new(0.4, 1, 0.4), CFrame = camBase, Color = Color3.fromRGB(230, 230, 230) })
	local head = decor(cam, { Name = "Head", Size = Vector3.new(0.9, 0.8, 1.8), CFrame = CFrame.lookAt((camBase * CFrame.new(0, -0.7, 0)).Position, (o * CFrame.new(0, 2, 60)).Position), Color = Color3.fromRGB(235, 235, 235), CastShadow = true })
	decor(cam, { Name = "Lens", Size = Vector3.new(0.5, 0.5, 0.1), CFrame = head.CFrame * CFrame.new(0, 0, -0.92), Color = Color3.fromRGB(10, 10, 10), Material = Enum.Material.Glass })
	decor(cam, { Size = Vector3.new(0.15, 0.15, 0.1), CFrame = head.CFrame * CFrame.new(0.3, 0.25, -0.92), Color = Color3.fromRGB(255, 30, 30), Material = Enum.Material.Neon })
	cam.PrimaryPart = head
	P.camera = cam

	local wet = model(m, "WetSign")
	World.wetSign(wet, o * CFrame.new(3, 0, 68) * CFrame.Angles(0, 0.4, 0))
	P.wetSign = wet

	if player then
		m:SetAttribute("Owner", player.UserId)
	end
	return P :: Props
end

function World.wetSign(parent: Instance, cf: CFrame)
	local yellow = Color3.fromRGB(255, 215, 30)
	for _, s in { -1, 1 } do
		local p = decor(parent, { Size = Vector3.new(1.8, 3, 0.12), CFrame = cf * CFrame.new(0, 1.45, s * 0.45) * CFrame.Angles(s * 0.28, 0, 0), Color = yellow, CastShadow = true })
		local g = gui(p, if s == 1 then Enum.NormalId.Back else Enum.NormalId.Front, 50)
		text(g, { Text = "⚠\nCAUTION\nWET FLOOR", TextColor3 = Color3.fromRGB(20, 20, 20), Size = UDim2.fromScale(0.9, 0.7), Position = UDim2.fromScale(0.05, 0.1) })
	end
end

-- Anomalies -----------------------------------------------------------------------------------
-- Each one bends a freshly dressed hall. ctx.player is the corridor's owner.

type Ctx = { player: Player?, rng: Random }

local function red(p: BasePart)
	p.Color = Color3.fromRGB(255, 40, 30)
	local l = p:FindFirstChildOfClass("SurfaceLight")
	if l then
		l.Color = Color3.fromRGB(255, 30, 20)
	end
end

local function hand(parent: Instance, cf: CFrame, s: number)
	local c = Color3.fromRGB(130, 10, 12)
	decor(parent, { Size = Vector3.new(0.04, 0.7, 0.6) * s, CFrame = cf, Color = c })
	for i = -2, 1 do
		decor(parent, { Size = Vector3.new(0.04, 0.55, 0.12) * s, CFrame = cf * CFrame.new(0, 0.55 * s, i * 0.15 * s + 0.07 * s), Color = c })
	end
	decor(parent, { Size = Vector3.new(0.04, 0.12, 0.4) * s, CFrame = cf * CFrame.new(0, 0.05 * s, -0.42 * s) * CFrame.Angles(0.6, 0, 0), Color = c })
end

local function sound(parent: Instance, id: string, volume: number, loop: boolean): Sound
	local s = Instance.new("Sound")
	s.SoundId = id
	s.Volume = volume
	s.Looped = loop
	s.RollOffMaxDistance = 90
	s.Parent = parent
	s:Play()
	return s
end

local Anomalies: { [string]: (P: Props, o: CFrame, ctx: Ctx) -> () } = {
	redlights = function(P)
		for _, l in P.lights do
			red(l)
		end
	end,
	flicker = function(P)
		-- server-side so the lights' real state resets cleanly on the next floor
		local props = P.model
		task.spawn(function()
			while props.Parent do
				for _, l in P.lights do
					local on = math.random() > 0.4
					l.Material = if on then Enum.Material.Neon else Enum.Material.SmoothPlastic
					local sl = l:FindFirstChildOfClass("SurfaceLight")
					if sl then
						sl.Enabled = on
					end
				end
				task.wait(0.05 + math.random() * 0.2)
			end
		end)
	end,
	darklight = function(P, _, ctx)
		local l = P.lights[ctx.rng:NextInteger(3, 7)]
		l.Material = Enum.Material.SmoothPlastic
		l.Color = Color3.fromRGB(90, 90, 90)
		local sl = l:FindFirstChildOfClass("SurfaceLight")
		if sl then
			sl.Enabled = false
		end
	end,
	figure = function(P, o)
		figure(P.model, o * CFrame.new(1.5, 0, 140) * CFrame.Angles(0, 0, 0))
	end,
	stalker = function(P, o)
		local f = figure(P.model, o * CFrame.new(-2, 0, 128))
		f:SetAttribute("Fx", "stalk")
	end,
	runner = function(P, o)
		local f = figure(P.model, o * CFrame.new(0, 0, 158))
		f:SetAttribute("Fx", "run")
	end,
	bigplant = function(P)
		P.plant:ScaleTo(3.4)
		P.plant:PivotTo(P.plant:GetPivot() * CFrame.new(1.2, 0, 0))
	end,
	wetsigns = function(P, o, ctx)
		for i = 1, 13 do
			local cf = o * CFrame.new(ctx.rng:NextNumber(-5, 5), 0, 30 + i * 8.5 + ctx.rng:NextNumber(-2, 2)) * CFrame.Angles(0, ctx.rng:NextNumber(0, 6.28), 0)
			World.wetSign(P.wetSign, cf)
		end
	end,
	spinchair = function(P)
		P.chair:SetAttribute("Fx", "spin")
	end,
	poster = function(P)
		P.poster.Text = "☠"
		P.poster.TextColor3 = Color3.fromRGB(150, 0, 0)
		P.posterSub.Text = "There is no supervisor. Do not report anything."
	end,
	extradoor = function(P, o)
		door(P.model, o, -1, 120, 107)
	end,
	nodoor = function(P)
		P.doors[103]:Destroy()
	end,
	noextinguisher = function(P)
		P.extinguisher:Destroy()
	end,
	clock = function(P)
		P.clock:SetAttribute("Fx", nil)
		P.clockLabel.Text = "25:61"
	end,
	clockback = function(P)
		P.clock:SetAttribute("Rate", -1)
	end,
	vending = function(P)
		local glass = P.vending:FindFirstChild("Glass") :: BasePart
		for _, dz in { -0.55, 0.55 } do
			local eye = decor(P.vending, { Name = "Eye", Size = Vector3.new(0.9, 0.9, 0.9), CFrame = glass.CFrame * CFrame.new(-0.35, 0.8, dz), Color = Color3.new(1, 1, 1), Shape = Enum.PartType.Ball })
			local pupil = decor(P.vending, { Name = "Pupil", Size = Vector3.new(0.42, 0.42, 0.42), CFrame = eye.CFrame * CFrame.new(0, 0, 0), Color = Color3.new(0, 0, 0), Shape = Enum.PartType.Ball })
			pupil:SetAttribute("Fx", "eye")
			pupil:SetAttribute("Center", eye.Position)
		end
	end,
	puddle = function(P, o)
		for i, s in { 5, 3, 2.2, 1.4 } do
			decor(P.model, { Size = Vector3.new(0.06, s, s * 1.2), CFrame = o * CFrame.new(-1 + i * 0.7, 0.03 + i * 0.001, 84 + i * 1.3) * CFrame.Angles(0, 0, math.pi / 2), Color = Color3.fromRGB(90, 4, 8), Material = Enum.Material.SmoothPlastic, Shape = Enum.PartType.Cylinder, Reflectance = 0.12 })
		end
	end,
	drip = function(P, o)
		P.vent:SetAttribute("Fx", "drip")
		decor(P.model, { Size = Vector3.new(0.05, 2.4, 2.4), CFrame = o * CFrame.new(3, 0.03, 95) * CFrame.Angles(0, 0, math.pi / 2), Color = Color3.fromRGB(20, 20, 18), Material = Enum.Material.Glass, Shape = Enum.PartType.Cylinder, Reflectance = 0.3 })
		sound(P.vent, "rbxassetid://9114181108", 0.6, true)
	end,
	painting = function(P)
		P.painting.CFrame = P.painting.CFrame * CFrame.Angles(math.pi, 0, 0)
	end,
	cooler = function(P)
		P.cooler.Color = Color3.fromRGB(170, 0, 10)
		P.cooler.Transparency = 0.1
	end,
	knocking = function(P)
		local d = P.doors[104]
		local leaf = d:FindFirstChild("Leaf") :: BasePart
		leaf:SetAttribute("Fx", "shake")
		sound(leaf, "rbxassetid://138990412937492", 1, true)
	end,
	handprints = function(P, o, ctx)
		for i = 1, 9 do
			local cf = o * CFrame.new(-HALF + 0.03, ctx.rng:NextNumber(2.5, 8), 118 + i * 1.6 + ctx.rng:NextNumber(-0.5, 0.5)) * CFrame.Angles(ctx.rng:NextNumber(-0.4, 0.4), 0, 0)
			hand(P.model, cf, ctx.rng:NextNumber(1.1, 1.5))
		end
	end,
	shadow = function(P, o)
		local d = P.doors[105]
		local leaf = d:FindFirstChild("Leaf") :: BasePart
		-- swing the leaf open into the hall and fill the doorway with darkness
		leaf.CFrame = o * CFrame.new(HALF - 2.2, 4.1, 122.2) * CFrame.Angles(0, math.pi / 2, 0)
		for _, c in d:GetChildren() do
			if c:IsA("BasePart") and c ~= leaf and c.Name ~= "Plate" and c.Size.Y < 3 then
				c:Destroy() -- window strip + handle
			end
		end
		decor(P.model, { Size = Vector3.new(0.1, 8.2, 3.9), CFrame = o * CFrame.new(HALF - 0.08, 4.1, 120), Color = Color3.new(0, 0, 0), Material = Enum.Material.SmoothPlastic })
		local f = figure(P.model, o * CFrame.new(HALF - 0.9, 0, 120) * CFrame.Angles(0, math.pi / 2, 0), 0.95)
		for _, c in f:GetChildren() do
			if c:IsA("BasePart") then
				c.Color = Color3.fromRGB(4, 4, 6)
			end
		end
	end,
	tixe = function(P)
		P.exitSign.Text = "TIXE →"
	end,
	roomnumber = function(P)
		P.plates[104].Text = "666"
	end,
	camera = function(P)
		P.camera:SetAttribute("Fx", "track")
	end,
	employee = function(P, _, ctx)
		if ctx.player then
			P.employee.image.Image = `rbxthumb://type=AvatarHeadShot&id={ctx.player.UserId}&w=150&h=150`
			P.employee.name.Text = string.upper(ctx.player.DisplayName)
		else
			P.employee.name.Text = "YOU"
		end
	end,
	longbench = function(P)
		local seat = P.bench.PrimaryPart :: BasePart
		for i, dz in { -1.4, 1.2 } do
			for _, dx in { -0.25, 0.25 } do
				decor(P.bench, { Size = Vector3.new(0.45, 0.35, 1.1), CFrame = seat.CFrame * CFrame.new(0.4 + dx * 1.2, -1.6, dz + dx) * CFrame.Angles(0, i * 0.3, 0), Color = Color3.fromRGB(15, 12, 10), Material = Enum.Material.Leather })
			end
		end
	end,
}
World.Anomalies = Anomalies

function World.apply(c: Corridor, P: Props, id: string?, player: Player?, seed: number?)
	if not id then
		return
	end
	local fn = Anomalies[id]
	assert(fn, "unknown anomaly " .. id)
	fn(P, c.origin, { player = player, rng = Random.new(seed or os.clock() * 1e6) })
end

-- Build ---------------------------------------------------------------------------------------

function World.build(): Built
	lighting()
	local old = Workspace:FindFirstChild("Map")
	if old then
		old:Destroy()
	end
	local map = Instance.new("Folder")
	map.Name = "Map"
	map.Parent = Workspace
	local oldCorridors = Workspace:FindFirstChild("Corridors")
	if oldCorridors then
		oldCorridors:Destroy()
	end
	local corridors = Instance.new("Folder")
	corridors.Name = "Corridors"
	corridors.Parent = Workspace
	return lobby(map)
end

return World
