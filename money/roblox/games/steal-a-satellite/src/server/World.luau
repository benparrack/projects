--!strict
-- Builds the spaceport from code: lighting, ground, the launch belt, 8 bases and scenery.

local Lighting = game:GetService("Lighting")
local Workspace = game:GetService("Workspace")

local Config = require(game:GetService("ReplicatedStorage").Shared.Config)

local World = {}

World.BaseColors = {
	Color3.fromRGB(255, 90, 90),
	Color3.fromRGB(70, 170, 255),
	Color3.fromRGB(90, 220, 120),
	Color3.fromRGB(255, 200, 60),
	Color3.fromRGB(180, 100, 255),
	Color3.fromRGB(255, 130, 200),
	Color3.fromRGB(60, 230, 220),
	Color3.fromRGB(255, 150, 60),
}

World.BaseWidth = 72
World.BaseDepth = 60
World.BeltY = 7 -- height satellites ride at
World.BeltZ = 0

export type Base = {
	index: number,
	color: Color3,
	cframe: CFrame, -- floor centre, LookVector points out the open front toward the belt
	model: Model,
	pads: { CFrame }, -- where each satellite hovers
	padParts: { BasePart },
	collect: { BasePart },
	collectLabels: { TextLabel },
	lockPlate: BasePart,
	lockLabel: TextLabel,
	shield: BasePart,
	ownerLabel: TextLabel,
	insideLabel: TextLabel,
	spawn: CFrame,
}

export type Built = {
	map: Folder,
	bases: { Base },
	beltStart: Vector3,
	beltEnd: Vector3,
}

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
	return part(parent, props)
end

local function surfaceText(p: BasePart, face: Enum.NormalId, text: string, color: Color3, ppS: number?): TextLabel
	local gui = Instance.new("SurfaceGui")
	gui.Face = face
	gui.LightInfluence = 0
	gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	gui.PixelsPerStud = ppS or 25
	gui.Parent = p
	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.FredokaOne
	label.TextScaled = true
	label.TextColor3 = color
	label.Text = text
	label.Parent = gui
	local stroke = Instance.new("UIStroke")
	stroke.Thickness = 3
	stroke.Parent = label
	return label
end

local function billboard(adornee: BasePart, size: UDim2, offset: Vector3, text: string, color: Color3, maxDistance: number?): TextLabel
	local gui = Instance.new("BillboardGui")
	gui.Size = size
	gui.StudsOffsetWorldSpace = offset
	gui.LightInfluence = 0
	gui.MaxDistance = maxDistance or 120
	gui.AlwaysOnTop = false -- AlwaysOnTop billboards don't draw under Vinegar
	gui.Parent = adornee
	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.FredokaOne
	label.TextScaled = true
	label.TextColor3 = color
	label.Text = text
	label.Parent = gui
	local stroke = Instance.new("UIStroke")
	stroke.Thickness = 2
	stroke.Parent = label
	return label
end
World.billboard = billboard

-- Lighting ------------------------------------------------------------------------------------

local function lighting()
	Lighting.ClockTime = 17.6
	Lighting.GeographicLatitude = 20
	Lighting.Brightness = 2.4
	Lighting.Ambient = Color3.fromRGB(70, 60, 100)
	Lighting.OutdoorAmbient = Color3.fromRGB(120, 105, 160)
	Lighting.EnvironmentDiffuseScale = 0.5
	Lighting.EnvironmentSpecularScale = 0.6
	Lighting.GlobalShadows = true
	for _, c in Lighting:GetChildren() do
		c:Destroy()
	end
	local atmosphere = Instance.new("Atmosphere")
	atmosphere.Density = 0.32
	atmosphere.Offset = 0.1
	atmosphere.Color = Color3.fromRGB(255, 170, 200)
	atmosphere.Decay = Color3.fromRGB(110, 70, 170)
	atmosphere.Glare = 0.4
	atmosphere.Haze = 1.6
	atmosphere.Parent = Lighting
	local sky = Instance.new("Sky")
	sky.StarCount = 5000
	sky.SunAngularSize = 14
	sky.MoonAngularSize = 20
	sky.CelestialBodiesShown = true
	sky.Parent = Lighting
	local bloom = Instance.new("BloomEffect")
	bloom.Intensity = 0.6
	bloom.Size = 30
	bloom.Threshold = 1.4
	bloom.Parent = Lighting
	local cc = Instance.new("ColorCorrectionEffect")
	cc.Saturation = 0.2
	cc.Contrast = 0.08
	cc.TintColor = Color3.fromRGB(255, 245, 250)
	cc.Parent = Lighting
	local sun = Instance.new("SunRaysEffect")
	sun.Intensity = 0.06
	sun.Spread = 0.6
	sun.Parent = Lighting
end

-- Ground & scenery -------------------------------------------------------------------------------

local function ground(map: Folder)
	part(map, { Name = "Ground", Size = Vector3.new(2048, 4, 2048), CFrame = CFrame.new(0, -2, 0), Material = Enum.Material.Slate, Color = Color3.fromRGB(128, 104, 150) })
	-- Spaceport apron under the bases and belt.
	part(map, { Name = "Apron", Size = Vector3.new(420, 0.4, 250), CFrame = CFrame.new(0, 0.2, 0), Material = Enum.Material.Concrete, Color = Color3.fromRGB(96, 98, 122) })
	-- Painted walkway lanes either side of the belt.
	for _, z in { -17, 17 } do
		decor(map, { Name = "Lane", Size = Vector3.new(400, 0.05, 1), CFrame = CFrame.new(0, 0.43, z), Material = Enum.Material.Neon, Color = Color3.fromRGB(255, 220, 90) })
	end
	-- Invisible boundary walls.
	for _, spec in { { 0, 330, 1400, 1 }, { 0, -330, 1400, 1 }, { 330, 0, 1, 1400 }, { -330, 0, 1, 1400 } } do
		part(map, { Name = "Boundary", Size = Vector3.new(spec[3], 200, spec[4]), CFrame = CFrame.new(spec[1], 100, spec[2]), Transparency = 1, CanQuery = false })
	end

	local rng = Random.new(1337)
	local deco = Instance.new("Folder")
	deco.Name = "Decor"
	deco.Parent = map
	-- Craters and boulders on the plain around the port.
	for _ = 1, 70 do
		local a = rng:NextNumber() * math.pi * 2
		local r = rng:NextNumber(250, 700)
		local pos = Vector3.new(math.cos(a) * r, 0, math.sin(a) * r)
		if rng:NextNumber() < 0.5 then
			local size = rng:NextNumber(20, 60)
			decor(deco, { Name = "Crater", Shape = Enum.PartType.Cylinder, Size = Vector3.new(1.2, size, size), CFrame = CFrame.new(pos + Vector3.new(0, 0.3, 0)) * CFrame.Angles(0, 0, math.rad(90)), Material = Enum.Material.Slate, Color = Color3.fromRGB(150, 120, 170) })
			decor(deco, { Name = "CraterPit", Shape = Enum.PartType.Cylinder, Size = Vector3.new(1.3, size * 0.7, size * 0.7), CFrame = CFrame.new(pos + Vector3.new(0, 0.35, 0)) * CFrame.Angles(0, 0, math.rad(90)), Material = Enum.Material.Slate, Color = Color3.fromRGB(95, 76, 115) })
		else
			local s = rng:NextNumber(6, 22)
			decor(deco, { Name = "Boulder", Size = Vector3.new(s, s * 0.7, s * 0.9), CFrame = CFrame.new(pos + Vector3.new(0, s * 0.25, 0)) * CFrame.Angles(rng:NextNumber(0, 1), rng:NextNumber(0, 6), rng:NextNumber(0, 1)), Material = Enum.Material.Rock, Color = Color3.fromRGB(140, 110, 160) })
		end
	end
	-- Distant mesas on the horizon ring.
	for i = 1, 26 do
		local a = i / 26 * math.pi * 2 + rng:NextNumber(-0.1, 0.1)
		local r = rng:NextNumber(820, 960)
		local w = rng:NextNumber(90, 220)
		local h = rng:NextNumber(60, 190)
		decor(deco, { Name = "Mesa", Size = Vector3.new(w, h, w * 0.7), CFrame = CFrame.new(math.cos(a) * r, h / 2 - 4, math.sin(a) * r) * CFrame.Angles(0, -a, 0), Material = Enum.Material.Sandstone, Color = Color3.fromRGB(170, 110, 150):Lerp(Color3.fromRGB(110, 80, 150), rng:NextNumber()) })
	end
	-- A huge ringed planet hanging in the sky, and a small moon.
	decor(deco, { Name = "Planet", Shape = Enum.PartType.Ball, Size = Vector3.new(700, 700, 700), CFrame = CFrame.new(-600, 900, -1700), Material = Enum.Material.SmoothPlastic, Color = Color3.fromRGB(120, 170, 255), CastShadow = false })
	for i = 0, 47 do
		local a = i / 48 * math.pi * 2
		decor(deco, { Name = "PlanetRing", Size = Vector3.new(90, 4, 60), CFrame = CFrame.new(-600, 900, -1700) * CFrame.Angles(math.rad(-18), 0, math.rad(22)) * CFrame.Angles(0, a, 0) * CFrame.new(0, 0, 560), Material = Enum.Material.Neon, Color = Color3.fromRGB(255, 200, 230), Transparency = 0.35, CastShadow = false })
	end
	decor(deco, { Name = "Moon", Shape = Enum.PartType.Ball, Size = Vector3.new(160, 160, 160), CFrame = CFrame.new(1300, 700, 900), Material = Enum.Material.Slate, Color = Color3.fromRGB(230, 220, 240), CastShadow = false })

	-- Lamp posts along the walkways, in pairs framing each base entrance (bases sit at x = ±45, ±135).
	for _, x in { -173, -97, -83, -7, 7, 83, 97, 173 } do
		for _, z in { -24, 24 } do
			decor(deco, { Name = "LampPost", Size = Vector3.new(0.8, 14, 0.8), CFrame = CFrame.new(x, 7, z), Material = Enum.Material.Metal, Color = Color3.fromRGB(60, 60, 80), CanCollide = true })
			local head = decor(deco, { Name = "LampHead", Size = Vector3.new(2.4, 0.8, 2.4), CFrame = CFrame.new(x, 14.2, z), Material = Enum.Material.Neon, Color = Color3.fromRGB(190, 230, 255) })
			local light = Instance.new("PointLight")
			light.Range = 26
			light.Brightness = 1.4
			light.Color = Color3.fromRGB(190, 220, 255)
			light.Parent = head
		end
	end
end

-- The belt ---------------------------------------------------------------------------------------

local function belt(map: Folder): (Vector3, Vector3)
	local half = Config.BeltLength / 2
	local folder = Instance.new("Folder")
	folder.Name = "Belt"
	folder.Parent = map
	part(folder, { Name = "Track", Size = Vector3.new(Config.BeltLength, 2, 12), CFrame = CFrame.new(0, 1, 0), Material = Enum.Material.DiamondPlate, Color = Color3.fromRGB(45, 45, 60) })
	-- Glowing stripes that the client scrolls along the belt.
	local stripes = Instance.new("Folder")
	stripes.Name = "Stripes"
	stripes.Parent = folder
	for x = -half + 4, half - 4, 8 do
		decor(stripes, { Name = "Stripe", Size = Vector3.new(0.6, 0.1, 9), CFrame = CFrame.new(x, 2.03, 0), Material = Enum.Material.Neon, Color = Color3.fromRGB(60, 120, 200), Transparency = 0.55 })
	end
	for _, z in { -6.4, 6.4 } do
		part(folder, { Name = "Rail", Size = Vector3.new(Config.BeltLength, 1.4, 0.8), CFrame = CFrame.new(0, 2.2, z), Material = Enum.Material.Metal, Color = Color3.fromRGB(80, 80, 100) })
		decor(folder, { Name = "RailGlow", Size = Vector3.new(Config.BeltLength, 0.3, 0.9), CFrame = CFrame.new(0, 2.95, z), Material = Enum.Material.Neon, Color = Color3.fromRGB(80, 200, 255) })
	end

	-- Launch Bay at the start: a hangar mouth with a rocket on a gantry behind it.
	local startX = -half
	local bay = Instance.new("Model")
	bay.Name = "LaunchBay"
	bay.Parent = folder
	for _, z in { -11, 11 } do
		part(bay, { Name = "BayWall", Size = Vector3.new(24, 26, 4), CFrame = CFrame.new(startX - 8, 13, z), Material = Enum.Material.Metal, Color = Color3.fromRGB(210, 215, 230) })
		decor(bay, { Name = "BayStripe", Size = Vector3.new(24.2, 2, 4.2), CFrame = CFrame.new(startX - 8, 20, z), Material = Enum.Material.Neon, Color = Color3.fromRGB(255, 120, 60) })
	end
	part(bay, { Name = "BayRoof", Size = Vector3.new(26, 4, 30), CFrame = CFrame.new(startX - 8, 28, 0), Material = Enum.Material.Metal, Color = Color3.fromRGB(190, 195, 215) })
	decor(bay, { Name = "BayGlow", Size = Vector3.new(1, 16, 18), CFrame = CFrame.new(startX - 19, 9, 0), Material = Enum.Material.Neon, Color = Color3.fromRGB(120, 220, 255) })
	local bayFront = decor(bay, { Name = "BaySign", Size = Vector3.new(1, 5, 26), CFrame = CFrame.new(startX + 5.6, 23.5, 0), Material = Enum.Material.SmoothPlastic, Color = Color3.fromRGB(30, 30, 50) })
	surfaceText(bayFront, Enum.NormalId.Right, "🚀 LAUNCH BAY", Color3.fromRGB(255, 200, 90), 20)
	-- Gantry + rocket.
	local rx = startX - 40
	part(bay, { Name = "Pad", Shape = Enum.PartType.Cylinder, Size = Vector3.new(2, 40, 40), CFrame = CFrame.new(rx, 1, 0) * CFrame.Angles(0, 0, math.rad(90)), Material = Enum.Material.Concrete, Color = Color3.fromRGB(110, 110, 130) })
	for _, z in { -12, -6 } do
		for _, x in { -3, 3 } do
			decor(bay, { Name = "Gantry", Size = Vector3.new(1.2, 70, 1.2), CFrame = CFrame.new(rx + x, 35, z - 8), Material = Enum.Material.Metal, Color = Color3.fromRGB(230, 90, 60) })
		end
	end
	for y = 8, 64, 8 do
		decor(bay, { Name = "GantryBar", Size = Vector3.new(7.2, 0.8, 7.2), CFrame = CFrame.new(rx, y, -17), Material = Enum.Material.Metal, Color = Color3.fromRGB(230, 90, 60) })
	end
	local rocket = Instance.new("Model")
	rocket.Name = "Rocket"
	rocket.Parent = bay
	decor(rocket, { Name = "Body", Shape = Enum.PartType.Cylinder, Size = Vector3.new(50, 10, 10), CFrame = CFrame.new(rx, 30, 0) * CFrame.Angles(0, 0, math.rad(90)), Material = Enum.Material.SmoothPlastic, Color = Color3.fromRGB(245, 245, 250) })
	decor(rocket, { Name = "Band", Shape = Enum.PartType.Cylinder, Size = Vector3.new(3, 10.4, 10.4), CFrame = CFrame.new(rx, 44, 0) * CFrame.Angles(0, 0, math.rad(90)), Material = Enum.Material.Neon, Color = Color3.fromRGB(255, 90, 90) })
	decor(rocket, { Name = "Nose", Shape = Enum.PartType.Ball, Size = Vector3.new(10, 14, 10), CFrame = CFrame.new(rx, 55, 0), Material = Enum.Material.SmoothPlastic, Color = Color3.fromRGB(255, 90, 90) })
	decor(rocket, { Name = "Window", Shape = Enum.PartType.Ball, Size = Vector3.new(3.4, 3.4, 3.4), CFrame = CFrame.new(rx + 4, 40, 0), Material = Enum.Material.Glass, Color = Color3.fromRGB(120, 200, 255), Reflectance = 0.4 })
	for i = 0, 3 do
		local a = i * math.pi / 2
		decor(rocket, { Name = "Fin", Size = Vector3.new(1, 12, 6), CFrame = CFrame.new(rx, 9, 0) * CFrame.Angles(0, a, 0) * CFrame.new(0, 0, 6.5), Material = Enum.Material.SmoothPlastic, Color = Color3.fromRGB(255, 90, 90) })
	end
	decor(rocket, { Name = "Engine", Shape = Enum.PartType.Cylinder, Size = Vector3.new(3, 7, 7), CFrame = CFrame.new(rx, 4.5, 0) * CFrame.Angles(0, 0, math.rad(90)), Material = Enum.Material.Metal, Color = Color3.fromRGB(60, 60, 70) })

	-- Recycler at the end: a glowing furnace that eats unsold satellites.
	local endX = half
	local rec = Instance.new("Model")
	rec.Name = "Recycler"
	rec.Parent = folder
	for _, z in { -11, 11 } do
		part(rec, { Name = "RecWall", Size = Vector3.new(20, 22, 4), CFrame = CFrame.new(endX + 6, 11, z), Material = Enum.Material.DiamondPlate, Color = Color3.fromRGB(60, 55, 70) })
	end
	part(rec, { Name = "RecRoof", Size = Vector3.new(22, 4, 30), CFrame = CFrame.new(endX + 6, 24, 0), Material = Enum.Material.DiamondPlate, Color = Color3.fromRGB(50, 45, 60) })
	local furnace = decor(rec, { Name = "Furnace", Size = Vector3.new(2, 16, 18), CFrame = CFrame.new(endX + 14, 9, 0), Material = Enum.Material.Neon, Color = Color3.fromRGB(255, 110, 30) })
	local fire = Instance.new("Fire")
	fire.Size = 14
	fire.Heat = 12
	fire.Color = Color3.fromRGB(255, 140, 40)
	fire.SecondaryColor = Color3.fromRGB(255, 60, 20)
	fire.Parent = furnace
	local recSign = decor(rec, { Name = "RecSign", Size = Vector3.new(1, 5, 26), CFrame = CFrame.new(endX - 4.6, 20, 0), Color = Color3.fromRGB(30, 30, 50) })
	surfaceText(recSign, Enum.NormalId.Left, "♻ RECYCLER", Color3.fromRGB(255, 140, 60), 20)

	return Vector3.new(startX, World.BeltY, World.BeltZ), Vector3.new(endX, World.BeltY, World.BeltZ)
end

-- Bases --------------------------------------------------------------------------------------------

local function base(map: Folder, index: number, cf: CFrame): Base
	local color = World.BaseColors[index]
	local model = Instance.new("Model")
	model.Name = "Base" .. index
	model.Parent = map
	local W, D = World.BaseWidth, World.BaseDepth
	local function at(x: number, y: number, z: number): CFrame
		-- Local frame: -Z is the open front facing the belt.
		return cf * CFrame.new(x, y, z)
	end

	part(model, { Name = "Floor", Size = Vector3.new(W, 1, D), CFrame = at(0, 0.5, 0), Material = Enum.Material.SmoothPlastic, Color = color:Lerp(Color3.fromRGB(40, 40, 60), 0.7) })
	-- Checker tiles for texture.
	for ix = 0, 5 do
		for iz = 0, 4 do
			if (ix + iz) % 2 == 0 then
				decor(model, { Name = "Tile", Size = Vector3.new(W / 6, 0.06, D / 5), CFrame = at(-W / 2 + W / 12 + ix * W / 6, 1.02, -D / 2 + D / 10 + iz * D / 5), Color = color:Lerp(Color3.fromRGB(40, 40, 60), 0.6) })
			end
		end
	end
	-- Neon trim around the floor edge.
	for _, spec in { { 0, -D / 2, W, 0.5 }, { 0, D / 2, W, 0.5 }, { -W / 2, 0, 0.5, D }, { W / 2, 0, 0.5, D } } do
		decor(model, { Name = "Trim", Size = Vector3.new(spec[3] + 0.4, 0.3, spec[4] + 0.4), CFrame = at(spec[1], 1.1, spec[2]), Material = Enum.Material.Neon, Color = color })
	end
	-- Walls: back and sides, low solid base with glass above.
	local wallColor = Color3.fromRGB(215, 220, 235)
	for _, spec in { { 0, D / 2, W, 1.5 }, { -W / 2, 0, 1.5, D }, { W / 2, 0, 1.5, D } } do
		part(model, { Name = "Wall", Size = Vector3.new(spec[3], 5, spec[4]), CFrame = at(spec[1], 3.5, spec[2]), Material = Enum.Material.Metal, Color = wallColor })
		part(model, { Name = "Glass", Size = Vector3.new(spec[3], 9, spec[4]) - Vector3.new(0.4, 0, 0.4), CFrame = at(spec[1], 10.5, spec[2]), Material = Enum.Material.Glass, Color = color:Lerp(Color3.new(1, 1, 1), 0.5), Transparency = 0.7 })
		decor(model, { Name = "WallTrim", Size = Vector3.new(spec[3] + 0.2, 0.5, spec[4] + 0.2), CFrame = at(spec[1], 15.2, spec[2]), Material = Enum.Material.Neon, Color = color })
	end
	-- Front pillars + owner sign arch.
	for _, x in { -W / 2, W / 2 } do
		part(model, { Name = "Pillar", Size = Vector3.new(3, 22, 3), CFrame = at(x, 11, -D / 2), Material = Enum.Material.Metal, Color = wallColor })
		decor(model, { Name = "PillarGlow", Size = Vector3.new(3.2, 1, 3.2), CFrame = at(x, 21.5, -D / 2), Material = Enum.Material.Neon, Color = color })
	end
	local sign = part(model, { Name = "Sign", Size = Vector3.new(W * 0.62, 6, 1.4), CFrame = at(0, 20, -D / 2), Material = Enum.Material.SmoothPlastic, Color = Color3.fromRGB(28, 28, 44) })
	decor(model, { Name = "SignTrim", Size = Vector3.new(W * 0.62 + 0.8, 6.8, 1), CFrame = at(0, 20, -D / 2 + 0.3), Material = Enum.Material.Neon, Color = color })
	decor(model, { Name = "Beam", Size = Vector3.new(W, 1.4, 1.4), CFrame = at(0, 22.3, -D / 2), Material = Enum.Material.Metal, Color = wallColor })
	local ownerLabel = surfaceText(sign, Enum.NormalId.Front, "EMPTY BASE", color:Lerp(Color3.new(1, 1, 1), 0.4), 20)
	-- Readable from inside too.
	local insideLabel = surfaceText(sign, Enum.NormalId.Back, "", color, 20)

	-- Laser shield across the open front (only visible/active while locked).
	local shield = part(model, { Name = "Shield", Size = Vector3.new(W - 3, 18, 0.6), CFrame = at(0, 10, -D / 2), Material = Enum.Material.Neon, Color = color, Transparency = 1, CanCollide = false, CanQuery = false, CanTouch = false })
	for i = 1, 6 do
		decor(shield, { Name = "ShieldBar", Size = Vector3.new(W - 3, 0.35, 0.8), CFrame = at(0, 1.5 + i * 2.8, -D / 2), Material = Enum.Material.Neon, Color = Color3.new(1, 1, 1):Lerp(color, 0.5), Transparency = 1 })
	end

	-- Pads: 2 rows of 8.
	local pads, padParts, collect, collectLabels = {}, {}, {}, {}
	local spacing = 8.4
	for row = 0, 1 do
		for i = 0, 7 do
			local x = -spacing * 3.5 + i * spacing
			local z = if row == 0 then -6 else 12
			local pad = part(model, { Name = "Pad", Shape = Enum.PartType.Cylinder, Size = Vector3.new(1.4, 6, 6), CFrame = at(x, 1.7, z) * CFrame.Angles(0, 0, math.rad(90)), Material = Enum.Material.Metal, Color = Color3.fromRGB(70, 72, 92) })
			decor(pad, { Name = "PadRing", Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.3, 6.5, 6.5), CFrame = at(x, 2.1, z) * CFrame.Angles(0, 0, math.rad(90)), Material = Enum.Material.Neon, Color = color })
			local plate = part(model, { Name = "Collect", Size = Vector3.new(5.4, 0.4, 2.6), CFrame = at(x, 1.2, z - 5), Material = Enum.Material.Neon, Color = Color3.fromRGB(70, 200, 100), CanCollide = false })
			table.insert(pads, at(x, 8, z))
			table.insert(padParts, pad)
			table.insert(collect, plate)
			table.insert(collectLabels, billboard(plate, UDim2.fromScale(5.4, 1.5), Vector3.new(0, 1.4, 0), "", Color3.fromRGB(140, 255, 150), 70))
		end
	end

	-- Lock button in the back-left corner.
	local lockPlate = part(model, { Name = "LockPlate", Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.8, 7, 7), CFrame = at(-W / 2 + 6, 1.4, D / 2 - 6) * CFrame.Angles(0, 0, math.rad(90)), Material = Enum.Material.Neon, Color = Color3.fromRGB(255, 70, 70), CanCollide = false })
	decor(model, { Name = "LockBase", Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.8, 8.4, 8.4), CFrame = at(-W / 2 + 6, 1.1, D / 2 - 6) * CFrame.Angles(0, 0, math.rad(90)), Material = Enum.Material.Metal, Color = Color3.fromRGB(60, 60, 70) })
	local lockLabel = billboard(lockPlate, UDim2.fromScale(10, 3.2), Vector3.new(0, 4.5, 0), "🔓 LOCK BASE", Color3.fromRGB(255, 120, 120), 90)

	return {
		index = index,
		color = color,
		cframe = cf,
		model = model,
		pads = pads,
		padParts = padParts,
		collect = collect,
		collectLabels = collectLabels,
		lockPlate = lockPlate,
		lockLabel = lockLabel,
		shield = shield,
		ownerLabel = ownerLabel,
		insideLabel = insideLabel,
		spawn = at(0, 4, D / 2 - 10) * CFrame.Angles(0, math.pi, 0),
	}
end

function World.build(): Built
	lighting()
	local old = Workspace:FindFirstChild("Map")
	if old then
		old:Destroy()
	end
	local map = Instance.new("Folder")
	map.Name = "Map"
	ground(map)
	local s, e = belt(map)
	local bases = {}
	local xs = { -135, -45, 45, 135 }
	for side = 0, 1 do
		for i, x in xs do
			local z = if side == 0 then -(World.BaseDepth / 2 + 32) else World.BaseDepth / 2 + 32
			-- Face the belt: LookVector toward z = 0.
			local cf = CFrame.lookAt(Vector3.new(x, 0, z), Vector3.new(x, 0, 0))
			table.insert(bases, base(map, side * 4 + i, cf))
		end
	end
	map.Parent = Workspace
	return { map = map, bases = bases, beltStart = s, beltEnd = e }
end

return World
