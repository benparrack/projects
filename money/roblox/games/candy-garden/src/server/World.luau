--!strict
-- Grow a Candy Garden map, built from code: a candy-town street with the Seed Shop,
-- the Candy Market and a chocolate fountain, and 6 garden plots (3 each side).

local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local PlantModel = require(Shared:WaitForChild("PlantModel"))
local Rules = require(Shared:WaitForChild("Rules"))

local World = {}

local SOIL = Color3.fromRGB(112, 70, 44)
local SOIL_WET = Color3.fromRGB(92, 56, 36)
local LOCKED = Color3.fromRGB(150, 205, 120)
local GRASS = Color3.fromRGB(120, 214, 118)
local WHITE = Color3.fromRGB(255, 250, 245)
local PINK = Color3.fromRGB(255, 130, 180)
local FONT = Enum.Font.FredokaOne

local function part(parent: Instance, props: { [string]: any }): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Material = Enum.Material.SmoothPlastic
	for k, v in props do
		(p :: any)[k] = v
	end
	p.Parent = parent
	return p
end

-- Non-colliding decoration.
local function decor(parent: Instance, props: { [string]: any }): Part
	props.CanCollide = if props.CanCollide == nil then false else props.CanCollide
	props.CanTouch = false
	return part(parent, props)
end

local function blob(parent: Instance, cf: CFrame, size: Vector3, color: Color3, material: Enum.Material?, collide: boolean?): Part
	local p = decor(parent, { Size = size, CFrame = cf, Color = color, Material = material or Enum.Material.SmoothPlastic, CanCollide = collide or false })
	local m = Instance.new("SpecialMesh")
	m.MeshType = Enum.MeshType.Sphere
	m.Parent = p
	return p
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
	g.LightInfluence = 0.3
	g.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	g.PixelsPerStud = ppS or 30
	g.Parent = p
	return g
end

local function text(parent: Instance, props: { [string]: any }): TextLabel
	local l = Instance.new("TextLabel")
	l.BackgroundTransparency = 1
	l.Size = UDim2.fromScale(1, 1)
	l.Font = FONT
	l.TextScaled = true
	l.TextColor3 = Color3.new(1, 1, 1)
	for k, v in props do
		(l :: any)[k] = v
	end
	local s = Instance.new("UIStroke")
	s.Thickness = 3
	s.Color = Color3.fromRGB(90, 40, 70)
	s.Parent = l
	l.Parent = parent
	return l
end

-- Candy-cane striped vertical pole from `cf` (its bottom) up `h` studs.
local function stripedPole(parent: Instance, cf: CFrame, h: number, d: number, a: Color3?, b: Color3?)
	local seg = d * 1.4
	local n = math.max(1, math.floor(h / seg))
	for i = 0, n - 1 do
		decor(parent, {
			Shape = Enum.PartType.Cylinder,
			Size = Vector3.new(h / n, d, d),
			CFrame = cf * CFrame.new(0, (i + 0.5) * h / n, 0) * CFrame.Angles(0, 0, math.pi / 2),
			Color = if i % 2 == 0 then (a or Color3.fromRGB(235, 45, 60)) else (b or WHITE),
			CanCollide = true,
		})
	end
end

local function candyCaneLamp(parent: Instance, cf: CFrame)
	local m = model(parent, "Lamp")
	stripedPole(m, cf, 12, 0.9)
	local r = 1.4
	for i = 0, 6 do
		local a = i / 6 * math.pi
		decor(m, { Shape = Enum.PartType.Ball, Size = Vector3.new(0.95, 0.95, 0.95), CFrame = cf * CFrame.new(r - math.cos(a) * r, 12 + math.sin(a) * r, 0), Color = if i % 2 == 0 then WHITE else Color3.fromRGB(235, 45, 60) })
	end
	local bulb = decor(m, { Shape = Enum.PartType.Ball, Size = Vector3.new(1.6, 1.6, 1.6), CFrame = cf * CFrame.new(2 * r, 11, 0), Color = Color3.fromRGB(255, 230, 170), Material = Enum.Material.Neon })
	local l = Instance.new("PointLight")
	l.Color = Color3.fromRGB(255, 210, 160)
	l.Range = 18
	l.Brightness = 0.8
	l.Parent = bulb
end

local function giantLollipop(parent: Instance, cf: CFrame, h: number, color: Color3)
	local m = model(parent, "Lollipop")
	decor(m, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(h, 1.2, 1.2), CFrame = cf * CFrame.new(0, h / 2, 0) * CFrame.Angles(0, 0, math.pi / 2), Color = WHITE, CanCollide = true })
	local d = h * 0.55
	for i, c in { color, WHITE, color, WHITE, color } do
		local dd = d * (1 - (i - 1) * 0.19)
		decor(m, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(1.4 + i * 0.05, dd, dd), CFrame = cf * CFrame.new(0, h + d * 0.4, 0) * CFrame.Angles(0, math.pi / 2, 0), Color = c, CanCollide = true })
	end
end

local function cottonTree(parent: Instance, cf: CFrame, color: Color3)
	local m = model(parent, "CottonTree")
	stripedPole(m, cf, 9, 1.1, Color3.fromRGB(255, 255, 255), color:Lerp(Color3.new(1, 1, 1), 0.3))
	blob(m, cf * CFrame.new(0, 11.5, 0), Vector3.new(10, 7, 10), color, Enum.Material.Sand, true)
	blob(m, cf * CFrame.new(-2.5, 13.5, 1), Vector3.new(6, 5, 6), color:Lerp(Color3.new(1, 1, 1), 0.25), Enum.Material.Sand)
	blob(m, cf * CFrame.new(2.2, 14, -1.2), Vector3.new(5.5, 4.5, 5.5), color:Lerp(Color3.new(1, 1, 1), 0.15), Enum.Material.Sand)
end

local function gingerbread(parent: Instance, cf: CFrame): Model
	local m = model(parent, "Vendor")
	local brown = Color3.fromRGB(190, 115, 55)
	local icing = WHITE
	blob(m, cf * CFrame.new(0, 3.2, 0), Vector3.new(2.6, 3, 1.1), brown)
	blob(m, cf * CFrame.new(0, 5.4, 0), Vector3.new(2.2, 2.1, 1.1), brown)
	for _, side in { -1, 1 } do
		blob(m, cf * CFrame.new(side * 1.7, 3.8, 0) * CFrame.Angles(0, 0, side * 0.9), Vector3.new(0.9, 2.4, 0.9), brown)
		blob(m, cf * CFrame.new(side * 0.7, 1.2, 0), Vector3.new(1, 2.4, 1), brown)
		-- eyes
		decor(m, { Shape = Enum.PartType.Ball, Size = Vector3.new(0.35, 0.35, 0.35), CFrame = cf * CFrame.new(side * 0.4, 5.7, -0.5), Color = Color3.fromRGB(40, 20, 20) })
	end
	for i = 0, 2 do
		decor(m, { Shape = Enum.PartType.Ball, Size = Vector3.new(0.4, 0.4, 0.4), CFrame = cf * CFrame.new(0, 2.5 + i * 0.7, -0.5), Color = if i == 1 then Color3.fromRGB(80, 200, 120) else Color3.fromRGB(240, 60, 90) })
	end
	-- smile
	for i = -2, 2 do
		decor(m, { Size = Vector3.new(0.22, 0.14, 0.1), CFrame = cf * CFrame.new(i * 0.2, 5.0 + math.abs(i) * 0.07, -0.55), Color = icing })
	end
	return m
end

-- A market stall facing along cf.LookVector (the customer side).
local function stall(parent: Instance, cf: CFrame, color: Color3, title: string, sub: string): (Model, BasePart)
	local m = model(parent, title)
	local wood = Color3.fromRGB(170, 110, 70)
	-- counter
	part(m, { Size = Vector3.new(14, 3.6, 3), CFrame = cf * CFrame.new(0, 1.8, -2), Color = wood, Material = Enum.Material.WoodPlanks })
	decor(m, { Size = Vector3.new(14.4, 0.4, 3.4), CFrame = cf * CFrame.new(0, 3.8, -2), Color = WHITE })
	for i = 0, 6 do
		decor(m, { Size = Vector3.new(1, 3.2, 0.2), CFrame = cf * CFrame.new(-6 + i * 2, 1.8, -3.55), Color = if i % 2 == 0 then color else WHITE })
	end
	-- back wall
	part(m, { Size = Vector3.new(14, 10, 1), CFrame = cf * CFrame.new(0, 5, 4), Color = color:Lerp(WHITE, 0.55) })
	-- posts
	for _, x in { -6.8, 6.8 } do
		for _, z in { -3.2, 3.6 } do
			stripedPole(m, cf * CFrame.new(x, 0, z), 11, 0.8, color, WHITE)
		end
	end
	-- striped awning
	for i = 0, 7 do
		decor(m, { Size = Vector3.new(1.85, 0.4, 9.4), CFrame = cf * CFrame.new(-6.5 + i * 1.86, 11.6, 0.2) * CFrame.Angles(math.rad(-14), 0, 0), Color = if i % 2 == 0 then color else WHITE })
	end
	for i = 0, 7 do
		decor(m, { Shape = Enum.PartType.Ball, Size = Vector3.new(1.3, 1.3, 1.3), CFrame = cf * CFrame.new(-6.5 + i * 1.86, 10.3, -4.4), Color = if i % 2 == 0 then color else WHITE })
	end
	-- sign
	local sign = decor(m, { Size = Vector3.new(12, 3, 0.4), CFrame = cf * CFrame.new(0, 14.3, -3.4) * CFrame.Angles(math.rad(-6), 0, 0), Color = WHITE })
	local g = gui(sign, Enum.NormalId.Front, 30)
	local bg = Instance.new("Frame")
	bg.Size = UDim2.fromScale(1, 1)
	bg.BackgroundColor3 = color
	bg.Parent = g
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0.25, 0)
	c.Parent = bg
	text(bg, { Text = title, Size = UDim2.fromScale(0.94, 0.66), Position = UDim2.fromScale(0.03, 0.04) })
	text(bg, { Text = sub, Size = UDim2.fromScale(0.9, 0.28), Position = UDim2.fromScale(0.05, 0.68), TextColor3 = Color3.fromRGB(255, 245, 200) })
	gingerbread(m, cf * CFrame.new(0, 0, 1.5))
	-- prompt anchor at the counter front
	local anchor = decor(m, { Name = "PromptAnchor", Size = Vector3.new(4, 1, 1), CFrame = cf * CFrame.new(0, 3, -4), Transparency = 1 })
	return m, anchor
end

local function prompt(anchor: BasePart, action: string, object: string, hold: number?): ProximityPrompt
	local p = Instance.new("ProximityPrompt")
	p.ActionText = action
	p.ObjectText = object
	p.HoldDuration = hold or 0
	p.MaxActivationDistance = 14
	p.RequiresLineOfSight = false
	p.KeyboardKeyCode = Enum.KeyCode.E
	p.Parent = anchor
	return p
end

-- Lighting --------------------------------------------------------------------------------

function World.lighting()
	Lighting.ClockTime = 14.5
	Lighting.GeographicLatitude = 30
	Lighting.Brightness = 2.4
	Lighting.Ambient = Color3.fromRGB(120, 100, 120)
	Lighting.OutdoorAmbient = Color3.fromRGB(170, 150, 175)
	Lighting.EnvironmentDiffuseScale = 1
	Lighting.EnvironmentSpecularScale = 1
	for _, c in Lighting:GetChildren() do
		if c:IsA("PostEffect") or c:IsA("Atmosphere") or c:IsA("Sky") then
			c:Destroy()
		end
	end
	local atmo = Instance.new("Atmosphere")
	atmo.Density = 0.36
	atmo.Offset = 0.1
	atmo.Color = Color3.fromRGB(255, 214, 232)
	atmo.Decay = Color3.fromRGB(255, 170, 210)
	atmo.Glare = 0.25
	atmo.Haze = 1.4
	atmo.Parent = Lighting
	local cc = Instance.new("ColorCorrectionEffect")
	cc.Name = "Grade"
	cc.Saturation = 0.18
	cc.Contrast = 0.06
	cc.Brightness = 0.02
	cc.TintColor = Color3.fromRGB(255, 250, 252)
	cc.Parent = Lighting
	local bloom = Instance.new("BloomEffect")
	bloom.Intensity = 0.5
	bloom.Size = 24
	bloom.Threshold = 1.4
	bloom.Parent = Lighting
	local rays = Instance.new("SunRaysEffect")
	rays.Intensity = 0.04
	rays.Spread = 0.6
	rays.Parent = Lighting
	local clouds = Workspace.Terrain:FindFirstChildOfClass("Clouds") or Instance.new("Clouds")
	clouds.Cover = 0.55
	clouds.Density = 0.55
	clouds.Color = Color3.fromRGB(255, 236, 246)
	clouds.Parent = Workspace.Terrain
end

-- Plots -------------------------------------------------------------------------------------

export type Plot = {
	index: number,
	cf: CFrame, -- local -Z faces the street
	model: Model,
	plants: Folder,
	tiles: { [number]: BasePart },
	sign: TextLabel,
	unlock: BasePart,
	unlockPrompt: ProximityPrompt,
	unlockLabel: TextLabel,
	spawn: CFrame,
}

local PLOT_X = { -64, 0, 64 }
local PLOT_Z = 62
local BED_W = Config.Cols * Config.Tile
local BED_D = Config.Rows * Config.Tile

function World.plotCFrame(i: number): CFrame
	local x = PLOT_X[(i - 1) % 3 + 1]
	if i <= 3 then
		return CFrame.new(x, 0, PLOT_Z)
	end
	return CFrame.new(x, 0, -PLOT_Z) * CFrame.Angles(0, math.pi, 0)
end

-- Local position of a tile's centre on the soil surface.
function World.tileLocal(index: number): CFrame
	local row, col = Rules.tileRow(index), Rules.tileCol(index)
	return CFrame.new((col - (Config.Cols + 1) / 2) * Config.Tile, 0.8, -BED_D / 2 + (row - 0.5) * Config.Tile)
end

local function fence(parent: Instance, cf: CFrame, w: number, d: number, gate: number)
	local function run(a: Vector3, b: Vector3)
		local len = (b - a).Magnitude
		local n = math.floor(len / 2)
		local dir = (b - a).Unit
		local rot = CFrame.lookAt(Vector3.zero, dir)
		for i = 0, n do
			local p = a + dir * (i * len / n)
			local pick = decor(parent, { Size = Vector3.new(0.5, 3.4, 0.5), CFrame = cf * CFrame.new(p + Vector3.new(0, 1.7, 0)) * rot, Color = if i % 2 == 0 then PINK else WHITE, CanCollide = true })
			local tip = decor(parent, { Size = Vector3.new(0.5, 0.5, 0.5), CFrame = pick.CFrame * CFrame.new(0, 1.8, 0) * CFrame.Angles(0, 0, math.rad(45)), Color = pick.Color })
			tip.Shape = Enum.PartType.Block
		end
		for _, y in { 1, 2.5 } do
			decor(parent, { Size = Vector3.new(0.25, 0.35, len), CFrame = cf * CFrame.new((a + b) / 2 + Vector3.new(0, y, 0)) * rot, Color = WHITE })
		end
	end
	local hw, hd, hg = w / 2, d / 2, gate / 2
	run(Vector3.new(-hw, 0, -hd), Vector3.new(-hg, 0, -hd))
	run(Vector3.new(hg, 0, -hd), Vector3.new(hw, 0, -hd))
	run(Vector3.new(-hw, 0, hd), Vector3.new(hw, 0, hd))
	run(Vector3.new(-hw, 0, -hd), Vector3.new(-hw, 0, hd))
	run(Vector3.new(hw, 0, -hd), Vector3.new(hw, 0, hd))
end

function World.plot(i: number, parent: Instance): Plot
	local cf = World.plotCFrame(i)
	local m = model(parent, "Plot" .. i)
	local padW, padD = BED_W + 12, BED_D + 14
	part(m, { Name = "Pad", Size = Vector3.new(padW, 1, padD), CFrame = cf * CFrame.new(0, -0.4, 0), Color = GRASS:Lerp(Color3.fromRGB(255, 255, 200), 0.12), Material = Enum.Material.Grass })
	fence(m, cf, padW - 1, padD - 1, 10)
	-- chocolate bed frame
	local frameCol = Color3.fromRGB(95, 55, 35)
	for _, side in { -1, 1 } do
		part(m, { Size = Vector3.new(BED_W + 2, 1.2, 1), CFrame = cf * CFrame.new(0, 0.5, side * (BED_D / 2 + 0.5)), Color = frameCol, Material = Enum.Material.WoodPlanks })
		part(m, { Size = Vector3.new(1, 1.2, BED_D + 2), CFrame = cf * CFrame.new(side * (BED_W / 2 + 0.5), 0.5, 0), Color = frameCol, Material = Enum.Material.WoodPlanks })
	end
	-- dark soil under the tiles so the gaps between them read as furrows
	part(m, { Name = "Soil", Size = Vector3.new(BED_W, 0.4, BED_D), CFrame = cf * CFrame.new(0, 0.2, 0), Color = Color3.fromRGB(70, 42, 28), Material = Enum.Material.Ground })
	local tiles: { [number]: BasePart } = {}
	local tileFolder = model(m, "Tiles")
	for idx = 1, Config.Rows * Config.Cols do
		local t = part(tileFolder, {
			Name = "T" .. idx,
			Size = Vector3.new(Config.Tile - 0.25, 0.8, Config.Tile - 0.25),
			CFrame = cf * World.tileLocal(idx) * CFrame.new(0, -0.4, 0),
			Color = SOIL,
			Material = Enum.Material.Ground,
		})
		t:SetAttribute("Tile", idx)
		t:SetAttribute("Plot", i)
		tiles[idx] = t
	end
	local plants = Instance.new("Folder")
	plants.Name = "Plants"
	plants.Parent = m

	-- owner sign by the gate
	local signCf = cf * CFrame.new(-11, 0, -padD / 2 - 1.5)
	decor(m, { Size = Vector3.new(0.6, 5, 0.6), CFrame = signCf * CFrame.new(-3.2, 2.5, 0.3), Color = WHITE, CanCollide = true })
	decor(m, { Size = Vector3.new(0.6, 5, 0.6), CFrame = signCf * CFrame.new(3.2, 2.5, 0.3), Color = WHITE, CanCollide = true })
	local board = decor(m, { Size = Vector3.new(8.6, 3, 0.4), CFrame = signCf * CFrame.new(0, 5.5, 0), Color = PINK, CanCollide = true })
	local sign = text(gui(board, Enum.NormalId.Front, 30), { Text = "Free Garden", Size = UDim2.fromScale(0.92, 0.8), Position = UDim2.fromScale(0.04, 0.1) })
	-- also readable from inside the garden
	text(gui(board, Enum.NormalId.Back, 30), { Text = `Garden {i}`, Size = UDim2.fromScale(0.92, 0.8), Position = UDim2.fromScale(0.04, 0.1) })

	-- row unlock stand (moved to the next locked row by setRows)
	local unlock = decor(m, { Name = "Unlock", Size = Vector3.new(2.2, 2.6, 2.2), CFrame = cf * CFrame.new(BED_W / 2 + 3, 1.3, 0), Color = Color3.fromRGB(255, 200, 60), Material = Enum.Material.SmoothPlastic, CanCollide = true })
	local bb = Instance.new("BillboardGui")
	bb.Size = UDim2.fromOffset(170, 60)
	bb.StudsOffset = Vector3.new(0, 3.2, 0)
	bb.MaxDistance = 70
	bb.Parent = unlock
	local unlockLabel = text(bb, { Text = "" })
	local unlockPrompt = prompt(unlock, "Unlock Row", "Garden", 0.4)
	unlockPrompt.MaxActivationDistance = 10
	unlockPrompt.Enabled = false

	return {
		index = i,
		cf = cf,
		model = m,
		plants = plants,
		tiles = tiles,
		sign = sign,
		unlock = unlock,
		unlockPrompt = unlockPrompt,
		unlockLabel = unlockLabel,
		spawn = cf * CFrame.new(0, 3.5, -padD / 2 - 5) * CFrame.Angles(0, math.pi, 0),
	}
end

-- Recolour tiles for how many rows are unlocked and move the unlock stand.
function World.setRows(plot: Plot, rows: number, owned: boolean)
	for idx, t in plot.tiles do
		local open = Rules.tileRow(idx) <= rows
		t.Color = if open then SOIL else LOCKED
		t.Material = if open then Enum.Material.Ground else Enum.Material.Grass
		t.Size = Vector3.new(Config.Tile - 0.25, if open then 0.8 else 0.5, Config.Tile - 0.25)
		t.CFrame = plot.cf * World.tileLocal(idx) * CFrame.new(0, if open then -0.4 else -0.55, 0)
		t:SetAttribute("Locked", not open)
	end
	local cost = Rules.nextRowCost(rows)
	if owned and cost then
		local z = -BED_D / 2 + (rows + 0.5) * Config.Tile
		plot.unlock.CFrame = plot.cf * CFrame.new(BED_W / 2 + 3, 1.3, z)
		plot.unlock.Transparency = 0
		plot.unlockLabel.Text = `🔓 Row {rows + 1}: 💰{Rules.short(cost)}`
		plot.unlockLabel.Visible = true
		plot.unlockPrompt.Enabled = true
		plot.unlockPrompt.ObjectText = `💰 {Rules.short(cost)}`
	else
		plot.unlock.CFrame = plot.cf * CFrame.new(0, -20, 0)
		plot.unlockLabel.Visible = false
		plot.unlockPrompt.Enabled = false
	end
end

function World.wetTile(t: BasePart, wet: boolean)
	if t:GetAttribute("Locked") then
		return
	end
	t.Color = if wet then SOIL_WET else SOIL
end

-- Town ---------------------------------------------------------------------------------------

export type Town = {
	plots: { Plot },
	seedPrompt: ProximityPrompt,
	sellPrompt: ProximityPrompt,
	seedStand: CFrame,
	sellStand: CFrame,
	spawn: CFrame,
	boards: { CFrame },
}

local function fountain(parent: Instance, cf: CFrame)
	local m = model(parent, "Fountain")
	local choc = Color3.fromRGB(100, 55, 30)
	local milk = Color3.fromRGB(150, 90, 50)
	part(m, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(2.4, 26, 26), CFrame = cf * CFrame.new(0, 1.2, 0) * CFrame.Angles(0, 0, math.pi / 2), Color = Color3.fromRGB(255, 190, 215) })
	decor(m, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.3, 23, 23), CFrame = cf * CFrame.new(0, 2.3, 0) * CFrame.Angles(0, 0, math.pi / 2), Color = choc, Material = Enum.Material.Glass, Reflectance = 0.1 })
	for i, d in { 13, 9, 5 } do
		local y = 2.5 + i * 3.2
		decor(m, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(3.2, 1.2, 1.2), CFrame = cf * CFrame.new(0, y - 1.6, 0) * CFrame.Angles(0, 0, math.pi / 2), Color = WHITE, CanCollide = true })
		decor(m, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.8, d, d), CFrame = cf * CFrame.new(0, y, 0) * CFrame.Angles(0, 0, math.pi / 2), Color = Color3.fromRGB(255, 190, 215), CanCollide = true })
		decor(m, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.35, d - 0.8, d - 0.8), CFrame = cf * CFrame.new(0, y + 0.3, 0) * CFrame.Angles(0, 0, math.pi / 2), Color = milk })
		-- chocolate curtain falling off the tier
		local fall = decor(m, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(3.2, d - 0.4, d - 0.4), CFrame = cf * CFrame.new(0, y - 1.6, 0) * CFrame.Angles(0, 0, math.pi / 2), Color = choc, Transparency = 0.35, Material = Enum.Material.Glass })
		fall.Name = "Fall"
	end
	giantLollipop(m, cf * CFrame.new(0, 12.5, 0), 5, Color3.fromRGB(255, 80, 170))
end

function World.build(): Town
	World.lighting()
	local old = Workspace:FindFirstChild("Map")
	if old then
		old:Destroy()
	end
	local map = Instance.new("Folder")
	map.Name = "Map"
	map.Parent = Workspace

	-- ground and street
	part(map, { Name = "Ground", Size = Vector3.new(2000, 2, 2000), CFrame = CFrame.new(0, -1, 0), Color = GRASS, Material = Enum.Material.Grass })
	part(map, { Name = "Street", Size = Vector3.new(230, 0.2, 60), CFrame = CFrame.new(0, 0.05, 0), Color = Color3.fromRGB(246, 184, 208), Material = Enum.Material.SmoothPlastic })
	for x = -112, 112, 8 do
		for _, z in { -28, 28 } do
			decor(map, { Size = Vector3.new(4, 0.25, 2), CFrame = CFrame.new(x, 0.1, z), Color = if (x // 8) % 2 == 0 then PINK else Color3.fromRGB(150, 220, 255) })
		end
	end
	-- paths from the street to each plot gate
	for i = 1, 6 do
		local cf = World.plotCFrame(i)
		decor(map, { Size = Vector3.new(10, 0.2, 14), CFrame = cf * CFrame.new(0, 0.06, -(BED_D + 14) / 2 - 5), Color = Color3.fromRGB(255, 226, 236), CanCollide = true })
	end

	local plotsFolder = Instance.new("Folder")
	plotsFolder.Name = "Plots"
	plotsFolder.Parent = map
	local plots = {}
	for i = 1, 6 do
		local p = World.plot(i, plotsFolder)
		World.setRows(p, Config.StartRows, false)
		plots[i] = p
	end

	-- stalls: the Seed Shop and the Candy Market face the fountain
	local seedCf = CFrame.lookAt(Vector3.new(-46, 0, 0), Vector3.new(0, 0, 0))
	local seedStall, seedAnchor = stall(map, seedCf, Color3.fromRGB(90, 200, 110), "SEED SHOP", "new seeds every 5 min")
	local sellCf = CFrame.lookAt(Vector3.new(46, 0, 0), Vector3.new(0, 0, 0))
	local sellStall, sellAnchor = stall(map, sellCf, Color3.fromRGB(255, 120, 170), "CANDY MARKET", "sell your candy here")
	-- seed packets on the seed counter
	for i, seed in Config.Seeds do
		local x = -6 + (i - 1) * 1.3
		local pkt = decor(seedStall, { Size = Vector3.new(1, 1.4, 0.15), CFrame = seedCf * CFrame.new(x, 4.7, -1.6) * CFrame.Angles(math.rad(-15), 0, 0), Color = seed.color })
		decor(seedStall, { Size = Vector3.new(0.8, 0.5, 0.16), CFrame = pkt.CFrame * CFrame.new(0, -0.25, 0), Color = WHITE })
	end
	-- candies on display at the market
	for i, id in { "lollipop", "cupcake", "candycane", "gumdrop" } do
		local c = PlantModel.candy(id, sellCf * CFrame.new(-4.5 + (i - 1) * 3, 5, -2), nil)
		for _, d in c:GetDescendants() do
			if d:IsA("BasePart") then
				d.Anchored = true
				d.CanCollide = false
			end
		end
		c.Parent = sellStall
	end
	-- big weighing scale beside the market
	decor(sellStall, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.4, 4, 4), CFrame = sellCf * CFrame.new(9.5, 4.2, -1) * CFrame.Angles(0, 0, math.pi / 2), Color = Color3.fromRGB(220, 220, 230), Material = Enum.Material.Metal })
	decor(sellStall, { Size = Vector3.new(1.4, 4, 1.4), CFrame = sellCf * CFrame.new(9.5, 2, -1), Color = Color3.fromRGB(255, 120, 170), CanCollide = true })

	local seedPrompt = prompt(seedAnchor, "Browse Seeds", "Seed Shop")
	local sellPrompt = prompt(sellAnchor, "Sell All Candy", "Candy Market", 0.3)

	-- the stalls and fountain read better a bit oversized
	seedStall.WorldPivot = seedCf
	seedStall:ScaleTo(1.5)
	sellStall.WorldPivot = sellCf
	sellStall:ScaleTo(1.5)
	fountain(map, CFrame.new(0, 0, 0))
	local f = map:FindFirstChild("Fountain") :: Model
	f.WorldPivot = CFrame.new()
	f:ScaleTo(1.4)

	-- cotton candy trees and lollipops between and behind the gardens
	local treeColors = { Color3.fromRGB(255, 160, 210), Color3.fromRGB(170, 220, 255), Color3.fromRGB(200, 170, 255) }
	for i = 1, 6 do
		local cf = World.plotCFrame(i)
		for _, side in { -1, 1 } do
			cottonTree(map, cf * CFrame.new(side * 32, 0, -10), treeColors[(i + side) % 3 + 1])
			cottonTree(map, cf * CFrame.new(side * 28, 0, 18), treeColors[(i - side) % 3 + 1])
		end
		giantLollipop(map, cf * CFrame.new(0, 0, 36), 16, treeColors[i % 3 + 1]:Lerp(Color3.fromRGB(255, 60, 140), 0.4))
	end

	-- candy cane lamps along the street
	for x = -96, 96, 32 do
		candyCaneLamp(map, CFrame.new(x, 0, -31) * CFrame.Angles(0, math.pi / 2, 0))
		candyCaneLamp(map, CFrame.new(x + 16, 0, 31) * CFrame.Angles(0, -math.pi / 2, 0))
	end

	-- scenery: lollipops and gumdrop hills around the town
	local rng = Random.new(42)
	local pastel = { Color3.fromRGB(255, 150, 190), Color3.fromRGB(160, 230, 200), Color3.fromRGB(190, 170, 255), Color3.fromRGB(255, 210, 140), Color3.fromRGB(150, 210, 255) }
	for i = 1, 26 do
		local a = i / 26 * math.pi * 2 + rng:NextNumber(-0.08, 0.08)
		local r = rng:NextNumber(185, 250)
		local s = rng:NextNumber(40, 90)
		blob(map, CFrame.new(math.cos(a) * r, -s * 0.18, math.sin(a) * r), Vector3.new(s, s * 0.7, s), pastel[i % #pastel + 1], Enum.Material.Sand, true)
	end
	local spots = {}
	for x = -150, 150, 50 do
		table.insert(spots, Vector3.new(x + rng:NextNumber(-10, 10), 0, 118 + rng:NextNumber(-8, 12)))
		table.insert(spots, Vector3.new(x + rng:NextNumber(-10, 10), 0, -118 - rng:NextNumber(-8, 12)))
	end
	for _, x in { -135, 135 } do
		for z = -60, 60, 40 do
			table.insert(spots, Vector3.new(x + rng:NextNumber(-8, 8), 0, z))
		end
	end
	for i, p in spots do
		if i % 3 == 0 then
			blob(map, CFrame.new(p + Vector3.new(0, 2, 0)), Vector3.new(9, 7, 9), pastel[i % #pastel + 1], Enum.Material.Sand, true)
		else
			giantLollipop(map, CFrame.new(p) * CFrame.Angles(0, rng:NextNumber(0, 6.28), 0), rng:NextNumber(10, 18), pastel[(i + 2) % #pastel + 1]:Lerp(Color3.fromRGB(255, 60, 140), 0.4))
		end
	end

	-- a big welcome arch over the street
	local arch = model(map, "Arch")
	for _, x in { -122, 122 } do
		for _, z in { -24, 24 } do
			stripedPole(arch, CFrame.new(x, 0, z), 20, 2)
		end
		local banner = decor(arch, { Size = Vector3.new(1, 6, 52), CFrame = CFrame.new(x, 20, 0), Color = PINK, CanCollide = true })
		text(gui(banner, if x < 0 then Enum.NormalId.Right else Enum.NormalId.Left, 20), { Text = "🍭 CANDY GARDEN 🍭" })
		text(gui(banner, if x < 0 then Enum.NormalId.Left else Enum.NormalId.Right, 20), { Text = "🍭 CANDY GARDEN 🍭" })
	end

	-- leaderboard backs + candy-cane posts (the boards themselves come from lib Leaderboard)
	local boards = {
		CFrame.lookAt(Vector3.new(-100, 12, -20), Vector3.new(-60, 12, -20)),
		CFrame.lookAt(Vector3.new(-100, 12, 20), Vector3.new(-60, 12, 20)),
	}
	for _, bcf in boards do
		local back = decor(map, { Size = Vector3.new(19.6, 25.6, 0.6), CFrame = bcf * CFrame.new(0, 0, 0.85), Color = PINK, CanCollide = true })
		text(gui(back, Enum.NormalId.Back, 12), { Text = "TOP\nGARDENERS", Size = UDim2.fromScale(0.9, 0.3), Position = UDim2.fromScale(0.05, 0.35) })
		for _, sx in { -10.6, 10.6 } do
			local foot = bcf * CFrame.new(sx, 0, 0.4)
			stripedPole(map, CFrame.new(foot.Position.X, 0, foot.Position.Z), 27, 1.2)
		end
	end

	local spawnLoc = Instance.new("SpawnLocation")
	spawnLoc.Anchored = true
	spawnLoc.Size = Vector3.new(10, 0.4, 10)
	spawnLoc.CFrame = CFrame.new(0, 0.2, 18)
	spawnLoc.Transparency = 1
	spawnLoc.CanCollide = false
	spawnLoc.Duration = 0
	spawnLoc.Parent = map

	return {
		plots = plots,
		seedPrompt = seedPrompt,
		sellPrompt = sellPrompt,
		seedStand = seedCf * CFrame.new(0, 3.5, -12) * CFrame.Angles(0, math.pi, 0),
		sellStand = sellCf * CFrame.new(0, 3.5, -12) * CFrame.Angles(0, math.pi, 0),
		spawn = CFrame.new(0, 3.5, 18),
		boards = boards,
	}
end

-- Plants ------------------------------------------------------------------------------------

-- (Re)build a plant model on a tile. `scale` is 0..1 of full size; `ripe` adds candies.
function World.plantModel(plot: Plot, tile: number, seedId: string, scale: number, ripe: boolean, mut: string?): Model
	local name = "P" .. tile
	local old = plot.plants:FindFirstChild(name)
	if old then
		old:Destroy()
	end
	local cf = plot.cf * World.tileLocal(tile) * CFrame.Angles(0, (tile * 1.7) % (math.pi * 2), 0)
	local m = PlantModel.plant(seedId, cf)
	m.Name = name
	m:SetAttribute("Tile", tile)
	m:SetAttribute("Seed", seedId)
	if ripe then
		local candies = PlantModel.candies(seedId, cf, mut)
		candies.Parent = m
		local root = m.PrimaryPart :: BasePart
		local att = Instance.new("Attachment")
		att.Position = Vector3.new(0, 3, 0)
		att.Parent = root
		local sp = Instance.new("ParticleEmitter")
		sp.Name = "Sparkle"
		sp.Texture = "rbxasset://textures/particles/sparkles_main.dds"
		local special = mut == "golden" or mut == "rainbow"
		local mdef = mut and Config.MutationById[mut]
		sp.Rate = if special then 10 elseif mut then 5 else 3
		sp.Lifetime = NumberRange.new(0.8, 1.2)
		sp.Speed = NumberRange.new(1, 2)
		sp.SpreadAngle = Vector2.new(180, 180)
		sp.Size = NumberSequence.new(if special then 0.8 else 0.5, 0)
		sp.Color = if mut == "rainbow"
			then ColorSequence.new({
				ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 90, 160)),
				ColorSequenceKeypoint.new(0.5, Color3.fromRGB(90, 220, 255)),
				ColorSequenceKeypoint.new(1, Color3.fromRGB(200, 120, 255)),
			})
			elseif mdef and mut ~= "choco" then ColorSequence.new(mdef.color)
			else ColorSequence.new(Color3.fromRGB(255, 240, 160))
		sp.LightEmission = 0.8
		sp.Parent = att
	end
	m:SetAttribute("Ripe", ripe)
	-- plants are modelled small; grow them a touch so they fill their 5-stud tile
	m:ScaleTo(math.max(0.05, scale) * 1.2)
	m.Parent = plot.plants
	return m
end

return World
