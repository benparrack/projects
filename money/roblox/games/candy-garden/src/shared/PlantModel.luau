--!strict
-- Builds candy plants from parts. Every plant is built full size with its pivot on the
-- soil surface; the server scales it with Model:ScaleTo while it grows. Candies are a
-- separate child Model ("Candies") so they can come and go between harvests.

local Config = require(script.Parent.Config)

local PlantModel = {}

local LEAF = Color3.fromRGB(90, 200, 110)
local LEAF_DARK = Color3.fromRGB(60, 160, 90)
local WHITE = Color3.fromRGB(255, 250, 245)

local function part(parent: Instance, props: { [string]: any }): BasePart
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CanTouch = false
	p.CanQuery = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Material = Enum.Material.SmoothPlastic
	for k, v in props do
		(p :: any)[k] = v
	end
	p.Parent = parent
	return p
end

-- A squashed/stretched sphere (SpecialMesh scales with the part, so ScaleTo still works).
local function blob(parent: Instance, cf: CFrame, size: Vector3, color: Color3, material: Enum.Material?): BasePart
	local p = part(parent, { Size = size, CFrame = cf, Color = color, Material = material or Enum.Material.SmoothPlastic })
	local m = Instance.new("SpecialMesh")
	m.MeshType = Enum.MeshType.Sphere
	m.Parent = p
	return p
end

local function ball(parent: Instance, pos: CFrame, d: number, color: Color3, material: Enum.Material?): BasePart
	return part(parent, { Shape = Enum.PartType.Ball, Size = Vector3.new(d, d, d), CFrame = pos, Color = color, Material = material or Enum.Material.SmoothPlastic })
end

-- Vertical cylinder from y0 to y1 at (x, z) in `base` space.
local function stick(parent: Instance, base: CFrame, x: number, z: number, y0: number, y1: number, d: number, color: Color3, tilt: CFrame?): BasePart
	local h = y1 - y0
	local cf = base * CFrame.new(x, y0, z) * (tilt or CFrame.identity) * CFrame.new(0, h / 2, 0) * CFrame.Angles(0, 0, math.pi / 2)
	return part(parent, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(h, d, d), CFrame = cf, Color = color })
end

local function bush(parent: Instance, base: CFrame, r: number, color: Color3?)
	local c = color or LEAF
	ball(parent, base * CFrame.new(0, r * 0.55, 0), r * 1.3, c, Enum.Material.Grass)
	for i = 0, 4 do
		local a = i / 5 * math.pi * 2
		ball(parent, base * CFrame.new(math.cos(a) * r * 0.55, r * 0.4, math.sin(a) * r * 0.55), r * 0.9, if i % 2 == 0 then c else LEAF_DARK, Enum.Material.Grass)
	end
end

local function leaves(parent: Instance, base: CFrame, n: number, len: number)
	for i = 0, n - 1 do
		local a = i / n * math.pi * 2
		local cf = base * CFrame.Angles(0, a, 0) * CFrame.new(0, 0.25, -len * 0.45) * CFrame.Angles(math.rad(-25), 0, 0)
		blob(parent, cf, Vector3.new(len * 0.45, 0.25, len), if i % 2 == 0 then LEAF else LEAF_DARK)
	end
end

-- Plant bodies (no candy) -------------------------------------------------------------------

type Builder = { plant: (Model, CFrame) -> (), spots: { CFrame }, candy: (Model, CFrame, Color3?, Enum.Material?) -> () }

local B: { [string]: Builder } = {}

-- Gumdrop: a low round bush with sugar-dusted drops on top.
B.gumdrop = {
	plant = function(m, base)
		bush(m, base, 1.4)
	end,
	spots = { CFrame.new(0, 1.9, 0), CFrame.new(0.9, 1.4, 0.5), CFrame.new(-0.8, 1.4, -0.6) },
	candy = function(m, cf, color, mat)
		blob(m, cf, Vector3.new(1, 0.85, 1), color or Color3.fromRGB(255, 90, 120), mat or Enum.Material.Sand)
	end,
}

-- Candy corn: a corn-like stalk with striped cones.
local function cornCone(m: Model, cf: CFrame, color: Color3?, mat: Enum.Material?)
	local cols = if color then { color, color, color } else { Color3.fromRGB(255, 200, 40), Color3.fromRGB(255, 130, 30), WHITE }
	for i, d in { 0.9, 0.65, 0.38 } do
		part(m, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.42, d, d), CFrame = cf * CFrame.new(0, (i - 2) * 0.4, 0) * CFrame.Angles(0, 0, math.pi / 2), Color = cols[i], Material = mat or Enum.Material.SmoothPlastic })
	end
end
B.candycorn = {
	plant = function(m, base)
		stick(m, base, 0, 0, 0, 3.4, 0.35, LEAF_DARK)
		leaves(m, base, 4, 2)
		for i, y in { 1.2, 2.2 } do
			blob(m, base * CFrame.Angles(0, i * 2.2, 0) * CFrame.new(0, y, -0.7) * CFrame.Angles(math.rad(-40), 0, 0), Vector3.new(0.5, 0.2, 1.5), LEAF)
		end
	end,
	spots = { CFrame.new(0.55, 2.4, 0) * CFrame.Angles(0, 0, math.rad(-20)), CFrame.new(-0.55, 1.8, 0.2) * CFrame.Angles(0, 0, math.rad(20)), CFrame.new(0, 3.6, 0) },
	candy = cornCone,
}

-- Lollipop: tall sticks, round swirl candies.
local function lolly(m: Model, cf: CFrame, color: Color3?, mat: Enum.Material?, size: number?)
	local s = size or 1.6
	local main = color or Color3.fromRGB(255, 80, 200)
	part(m, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.3, s, s), CFrame = cf * CFrame.Angles(0, math.pi / 2, 0), Color = main, Material = mat or Enum.Material.SmoothPlastic, Reflectance = 0.05 })
	part(m, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.34, s * 0.62, s * 0.62), CFrame = cf * CFrame.Angles(0, math.pi / 2, 0), Color = if color then main:Lerp(WHITE, 0.4) else WHITE, Material = mat or Enum.Material.SmoothPlastic })
	part(m, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.38, s * 0.3, s * 0.3), CFrame = cf * CFrame.Angles(0, math.pi / 2, 0), Color = main, Material = mat or Enum.Material.SmoothPlastic })
end
B.lollipop = {
	plant = function(m, base)
		leaves(m, base, 5, 1.8)
		stick(m, base, 0, 0, 0, 3.6, 0.18, WHITE)
		stick(m, base, 0.2, 0, 0, 2.6, 0.18, WHITE, CFrame.Angles(0, 0, math.rad(-25)))
		stick(m, base, -0.2, 0, 0, 2.3, 0.18, WHITE, CFrame.Angles(0, 0, math.rad(25)))
	end,
	spots = { CFrame.new(0, 4.3, 0), CFrame.new(1.4, 3, 0) * CFrame.Angles(0, 0, math.rad(-25)), CFrame.new(-1.25, 2.75, 0) * CFrame.Angles(0, 0, math.rad(25)) },
	candy = function(m, cf, color, mat)
		lolly(m, cf, color, mat)
	end,
}

-- Cotton candy: paper-cone stems topped with fluffy clouds.
B.cottoncandy = {
	plant = function(m, base)
		leaves(m, base, 6, 2)
		for i, x in { -0.9, 0.9, 0 } do
			local h = 2.2 + i * 0.5
			stick(m, base, x, if i == 3 then 0.6 else -0.3, 0, h, 0.3, if i % 2 == 0 then Color3.fromRGB(120, 200, 255) else WHITE)
		end
	end,
	spots = { CFrame.new(-0.9, 3.1, -0.3), CFrame.new(0.9, 3.6, -0.3), CFrame.new(0, 4.1, 0.6) },
	candy = function(m, cf, color, mat)
		local c = color or Color3.fromRGB(255, 175, 225)
		ball(m, cf, 1.6, c, mat or Enum.Material.Sand)
		for i = 0, 3 do
			local a = i / 4 * math.pi * 2
			ball(m, cf * CFrame.new(math.cos(a) * 0.6, 0.15, math.sin(a) * 0.6), 1.1, c:Lerp(WHITE, 0.25), mat or Enum.Material.Sand)
		end
	end,
}

-- Jelly bean bush: a big bush dotted with glossy beans.
local BEANS = { Color3.fromRGB(255, 70, 70), Color3.fromRGB(255, 200, 40), Color3.fromRGB(80, 200, 90), Color3.fromRGB(150, 80, 255), Color3.fromRGB(255, 130, 200), Color3.fromRGB(255, 140, 40) }
B.jellybean = {
	plant = function(m, base)
		bush(m, base, 2)
	end,
	spots = { CFrame.new(0, 2.7, 0) },
	candy = function(m, cf, color, mat)
		for i = 1, 8 do
			local a = i / 8 * math.pi * 2
			local r = if i % 2 == 0 then 1.4 else 0.9
			local pos = cf * CFrame.new(math.cos(a) * r, (if i % 2 == 0 then -0.9 else 0.15), math.sin(a) * r) * CFrame.Angles(0, a, math.rad(30))
			blob(m, pos, Vector3.new(0.75, 0.42, 0.42), color or BEANS[(i - 1) % #BEANS + 1], mat or Enum.Material.Glass).Reflectance = 0.15
		end
	end,
}

-- Candy cane: striped canes curling at the top.
local function cane(m: Model, cf: CFrame, color: Color3?, mat: Enum.Material?)
	local red = color or Color3.fromRGB(235, 40, 50)
	local stripe = if color then color:Lerp(WHITE, 0.55) else WHITE
	local seg = 0.5
	for i = 0, 5 do
		part(m, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(seg, 0.45, 0.45), CFrame = cf * CFrame.new(0, -1.5 + i * seg, 0) * CFrame.Angles(0, 0, math.pi / 2), Color = if i % 2 == 0 then red else stripe, Material = mat or Enum.Material.SmoothPlastic })
	end
	local r = 0.55
	for i = 0, 5 do
		local a = i / 5 * math.pi
		local pos = cf * CFrame.new(-r + math.cos(a) * r, 1.3 + math.sin(a) * r, 0) * CFrame.Angles(0, 0, a)
		part(m, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.45, 0.45, 0.45), CFrame = pos, Color = if i % 2 == 0 then stripe else red, Material = mat or Enum.Material.SmoothPlastic })
	end
end
B.candycane = {
	plant = function(m, base)
		leaves(m, base, 6, 2.4)
		bush(m, base, 1.1, LEAF_DARK)
	end,
	spots = { CFrame.new(0, 3.2, 0), CFrame.new(1.3, 2.7, 0.4) * CFrame.Angles(0, math.pi, 0), CFrame.new(-1.2, 2.5, -0.6) * CFrame.Angles(0, 0.8, 0) },
	candy = cane,
}

-- Chocolate tree: a trunk with a cocoa canopy and hanging bars.
B.chocolate = {
	plant = function(m, base)
		stick(m, base, 0, 0, 0, 4, 0.8, Color3.fromRGB(110, 70, 40))
		local canopy = Color3.fromRGB(90, 50, 30)
		ball(m, base * CFrame.new(0, 5, 0), 3.6, canopy, Enum.Material.Sand)
		for i = 0, 4 do
			local a = i / 5 * math.pi * 2
			ball(m, base * CFrame.new(math.cos(a) * 1.5, 4.5, math.sin(a) * 1.5), 2.4, if i % 2 == 0 then canopy else Color3.fromRGB(120, 70, 40), Enum.Material.Sand)
		end
	end,
	spots = { CFrame.new(1.8, 3.3, 0.4), CFrame.new(-1.6, 3.2, -0.8) * CFrame.Angles(0, 1.2, 0), CFrame.new(0.2, 3.1, 1.9) * CFrame.Angles(0, 2.2, 0) },
	candy = function(m, cf, color, mat)
		local c = color or Color3.fromRGB(95, 50, 25)
		part(m, { Size = Vector3.new(1.3, 1.8, 0.3), CFrame = cf, Color = c, Material = mat or Enum.Material.SmoothPlastic })
		for row = 0, 2 do
			for col = 0, 1 do
				part(m, { Size = Vector3.new(0.5, 0.45, 0.12), CFrame = cf * CFrame.new(-0.3 + col * 0.6, -0.55 + row * 0.55, -0.18), Color = c:Lerp(Color3.new(1, 1, 1), 0.08), Material = mat or Enum.Material.SmoothPlastic })
			end
		end
		part(m, { Size = Vector3.new(1.34, 0.7, 0.34), CFrame = cf * CFrame.new(0, -0.6, 0), Color = Color3.fromRGB(230, 60, 60) }) -- wrapper
	end,
}

-- Cupcake: a frilly plant holding frosted cupcakes.
B.cupcake = {
	plant = function(m, base)
		leaves(m, base, 7, 2.8)
		stick(m, base, 0, 0, 0, 2.2, 0.3, LEAF_DARK)
		stick(m, base, 0, 0, 0, 2, 0.3, LEAF_DARK, CFrame.Angles(0, 0, math.rad(-35)))
		stick(m, base, 0, 0, 0, 2, 0.3, LEAF_DARK, CFrame.Angles(0, 0, math.rad(35)))
	end,
	spots = { CFrame.new(0, 2.9, 0), CFrame.new(1.35, 2.4, 0), CFrame.new(-1.35, 2.4, 0) },
	candy = function(m, cf, color, mat)
		part(m, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.9, 1.3, 1.3), CFrame = cf * CFrame.Angles(0, 0, math.pi / 2), Color = color or Color3.fromRGB(120, 200, 255), Material = mat or Enum.Material.Fabric })
		blob(m, cf * CFrame.new(0, 0.65, 0), Vector3.new(1.6, 1, 1.6), color and color:Lerp(WHITE, 0.4) or Color3.fromRGB(255, 190, 220), mat)
		ball(m, cf * CFrame.new(0, 1.25, 0), 0.4, color or Color3.fromRGB(220, 20, 40), mat)
	end,
}

-- Rainbow swirl: one tall stem with a giant layered swirl.
local RAINBOW = { Color3.fromRGB(255, 70, 70), Color3.fromRGB(255, 160, 40), Color3.fromRGB(255, 230, 60), Color3.fromRGB(80, 220, 110), Color3.fromRGB(70, 170, 255), Color3.fromRGB(160, 100, 255) }
B.rainbow = {
	plant = function(m, base)
		leaves(m, base, 6, 2.6)
		stick(m, base, 0, 0, 0, 5, 0.3, WHITE)
	end,
	spots = { CFrame.new(0, 6.2, 0) },
	candy = function(m, cf, color, mat)
		for i, c in RAINBOW do
			local d = 3.2 - (i - 1) * 0.5
			part(m, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.4 + i * 0.03, d, d), CFrame = cf * CFrame.Angles(0, math.pi / 2, 0), Color = color or c, Material = mat or Enum.Material.SmoothPlastic, Reflectance = 0.05 })
		end
	end,
}

-- Rock candy: a crystal cluster on a stick, glowing a little.
B.rockcandy = {
	plant = function(m, base)
		leaves(m, base, 5, 2.4)
		stick(m, base, 0, 0, 0, 3.4, 0.25, Color3.fromRGB(200, 170, 120))
	end,
	spots = { CFrame.new(0, 4.6, 0) },
	candy = function(m, cf, color, mat)
		local c = color or Color3.fromRGB(90, 230, 255)
		local rng = Random.new(7)
		for i = 1, 9 do
			local s = rng:NextNumber(0.7, 1.3)
			local pos = cf * CFrame.new(rng:NextNumber(-0.6, 0.6), rng:NextNumber(-1.2, 1.2), rng:NextNumber(-0.6, 0.6)) * CFrame.Angles(rng:NextNumber(0, 6), rng:NextNumber(0, 6), rng:NextNumber(0, 6))
			part(m, { Size = Vector3.new(s, s * 1.2, s), CFrame = pos, Color = c:Lerp(Color3.new(1, 1, 1), (i % 3) * 0.12), Material = mat or Enum.Material.Glass, Transparency = 0.15 })
		end
		local core = m:FindFirstChildWhichIsA("BasePart") :: BasePart
		local l = Instance.new("PointLight")
		l.Color = c
		l.Range = 10
		l.Brightness = 1.5
		l.Parent = core
	end,
}

-- Mutation looks --------------------------------------------------------------------------

local function mutationLook(mut: string?): (Color3?, Enum.Material?)
	if mut == "golden" then
		return Color3.fromRGB(255, 178, 20), Enum.Material.Foil
	elseif mut == "frozen" then
		return Color3.fromRGB(170, 225, 255), Enum.Material.Ice
	elseif mut == "choco" then
		return Color3.fromRGB(100, 55, 30), Enum.Material.SmoothPlastic
	elseif mut == "sugar" then
		return nil, Enum.Material.Sand
	elseif mut == "rainbow" then
		return Color3.fromRGB(255, 100, 200), Enum.Material.Neon
	end
	return nil, nil
end

-- Public -------------------------------------------------------------------------------------

-- Plant body only, full size, pivot at the soil surface.
function PlantModel.plant(seedId: string, cf: CFrame): Model
	local m = Instance.new("Model")
	m.Name = seedId
	local root = part(m, { Name = "Root", Size = Vector3.new(1, 0.2, 1), CFrame = cf * CFrame.new(0, 0.1, 0), Transparency = 1 })
	m.PrimaryPart = root
	local b = B[seedId]
	if b then
		b.plant(m, cf)
	end
	for _, d in m:GetDescendants() do
		if d:IsA("BasePart") then
			d.CastShadow = d ~= root
		end
	end
	return m
end

-- The ripe candies on a full-size plant at `cf`. Returns the "Candies" model.
function PlantModel.candies(seedId: string, cf: CFrame, mut: string?): Model
	local m = Instance.new("Model")
	m.Name = "Candies"
	local b = B[seedId]
	if not b then
		return m
	end
	local color, mat = mutationLook(mut)
	for _, spot in b.spots do
		b.candy(m, cf * spot, color, mat)
	end
	if mut then
		m:SetAttribute("Mutation", mut)
	end
	return m
end

-- One candy on its own (for the harvest pop and the market display).
function PlantModel.candy(seedId: string, cf: CFrame, mut: string?): Model
	local m = Instance.new("Model")
	m.Name = seedId
	local b = B[seedId]
	if b then
		local color, mat = mutationLook(mut)
		b.candy(m, cf, color, mat)
	end
	return m
end

PlantModel.Seeds = Config.SeedById
return PlantModel
