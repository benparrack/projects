--!strict
-- Per-zone scenery around the tower. Everything is deterministic (seeded per zone), non-colliding
-- and kept outside the climbing lane, so it's pure backdrop: it tells you where you are at a glance.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared").Config)

local Decor = {}

-- Nothing is placed closer to the core axis than this (ledges end at CoreRadius + 1.5 * PillarSize).
local CLEAR_RADIUS = Config.CoreRadius + Config.PillarSize * 2 + 24

type Rng = Random

local function part(parent: Instance, props: { [string]: any }): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.CastShadow = false
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	for k, v in props do
		(p :: any)[k] = v
	end
	p.Parent = parent
	return p
end

local function ball(parent: Instance, pos: Vector3, size: Vector3, color: Color3, material: Enum.Material): Part
	return part(parent, {
		Shape = Enum.PartType.Ball,
		Size = size,
		CFrame = CFrame.new(pos),
		Color = color,
		Material = material,
	})
end

-- Random point on an annulus around the core at a random height.
local function around(rng: Rng, rMin: number, rMax: number, yMin: number, yMax: number): Vector3
	local a = rng:NextNumber(0, math.pi * 2)
	local r = rng:NextNumber(rMin, rMax)
	return Vector3.new(math.cos(a) * r, rng:NextNumber(yMin, yMax), math.sin(a) * r)
end

local function vary(rng: Rng, c: Color3, amount: number): Color3
	local h, s, v = c:ToHSV()
	return Color3.fromHSV(
		(h + rng:NextNumber(-amount, amount) * 0.1) % 1,
		math.clamp(s + rng:NextNumber(-amount, amount), 0, 1),
		math.clamp(v + rng:NextNumber(-amount, amount), 0, 1)
	)
end

local function tree(parent: Instance, rng: Rng, base: Vector3, scale: number, leaf: Color3)
	local h = rng:NextNumber(10, 16) * scale
	part(parent, {
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(h, 2.4 * scale, 2.4 * scale),
		CFrame = CFrame.new(base + Vector3.new(0, h / 2, 0)) * CFrame.Angles(0, 0, math.pi / 2),
		Color = Color3.fromRGB(110, 75, 50),
		Material = Enum.Material.Wood,
	})
	for i = 1, 3 do
		local off = Vector3.new(rng:NextNumber(-2, 2), rng:NextNumber(-1, 2) + (i - 1) * 2.4, rng:NextNumber(-2, 2)) * scale
		local d = rng:NextNumber(7, 10) * scale
		ball(parent, base + Vector3.new(0, h, 0) + off, Vector3.new(d, d * 0.85, d), vary(rng, leaf, 0.08), Enum.Material.Grass)
	end
end

-- Floating island: rocky underside, grass cap, optional trees.
local function island(parent: Instance, rng: Rng, pos: Vector3, w: number, top: Color3, topMat: Enum.Material, trees: number, leaf: Color3)
	part(parent, {
		Shape = Enum.PartType.Ball,
		Size = Vector3.new(w, w * 0.8, w),
		CFrame = CFrame.new(pos - Vector3.new(0, w * 0.3, 0)),
		Color = Color3.fromRGB(105, 90, 80),
		Material = Enum.Material.Rock,
	})
	part(parent, {
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(3, w, w),
		CFrame = CFrame.new(pos) * CFrame.Angles(0, 0, math.pi / 2),
		Color = top,
		Material = topMat,
	})
	for _ = 1, trees do
		local a = rng:NextNumber(0, math.pi * 2)
		local r = rng:NextNumber(0, w * 0.3)
		tree(parent, rng, pos + Vector3.new(math.cos(a) * r, 1.5, math.sin(a) * r), w / 30, leaf)
	end
end

local function cloud(parent: Instance, rng: Rng, pos: Vector3, scale: number, color: Color3, transparency: number)
	for _ = 1, rng:NextInteger(4, 7) do
		local d = rng:NextNumber(14, 26) * scale
		local p = ball(
			parent,
			pos + Vector3.new(rng:NextNumber(-18, 18), rng:NextNumber(-3, 5), rng:NextNumber(-10, 10)) * scale,
			Vector3.new(d, d * 0.7, d),
			color,
			Enum.Material.SmoothPlastic
		)
		p.Transparency = transparency
	end
end

-- Builders ----------------------------------------------------------------------------

local builders: { [string]: (Folder, Rng, number, number) -> () } = {}

builders.meadow = function(f, rng, y0, y1)
	-- Trees around the plaza edge, leaving the spawn side (+Z) and its sign open.
	local plazaEdge = Config.PlazaRadius - 9
	for i = 0, 17 do
		local a = i / 18 * math.pi * 2 + rng:NextNumber(-0.08, 0.08)
		local toSpawn = math.abs(math.atan2(math.sin(a - math.pi / 2), math.cos(a - math.pi / 2)))
		if toSpawn > 0.5 then
			tree(f, rng, Vector3.new(math.cos(a) * plazaEdge, 0, math.sin(a) * plazaEdge), rng:NextNumber(1, 1.4), Color3.fromRGB(90, 190, 80))
		end
	end
	-- Flower beds between the trees.
	for _ = 1, 40 do
		local a = rng:NextNumber(0, math.pi * 2)
		local r = rng:NextNumber(CLEAR_RADIUS - 10, Config.PlazaRadius - 4)
		local colors = { Color3.fromRGB(255, 120, 170), Color3.fromRGB(255, 230, 90), Color3.fromRGB(170, 140, 255), Color3.new(1, 1, 1) }
		ball(f, Vector3.new(math.cos(a) * r, 0.6, math.sin(a) * r), Vector3.one * rng:NextNumber(1, 1.8), colors[rng:NextInteger(1, 4)], Enum.Material.SmoothPlastic)
	end
	for _ = 1, 9 do
		island(f, rng, around(rng, 190, 340, y0 + 20, y1 + 30), rng:NextNumber(28, 46), Color3.fromRGB(100, 200, 90), Enum.Material.Grass, 2, Color3.fromRGB(90, 190, 80))
	end
end

builders.canyon = function(f, rng, y0, y1)
	-- Mesas rising out of the lava sea.
	for _ = 1, 16 do
		local p = around(rng, 170, 360, 0, 0)
		local h = rng:NextNumber(y0 + 20, y1 + 20) + 30
		local w = rng:NextNumber(24, 50)
		local base = Color3.fromRGB(215, 140, 80)
		local cf = CFrame.new(p.X, h / 2 - 20, p.Z) * CFrame.Angles(0, rng:NextNumber(0, math.pi), 0)
		part(f, { Size = Vector3.new(w, h, w * rng:NextNumber(0.6, 1)), CFrame = cf, Color = vary(rng, base, 0.06), Material = Enum.Material.Sandstone })
		-- Darker stripe and a lighter cap for layered rock.
		part(f, { Size = Vector3.new(w + 1, 6, w * 0.6 + 1), CFrame = cf * CFrame.new(0, h * 0.2, 0), Color = Color3.fromRGB(170, 95, 60), Material = Enum.Material.Sandstone })
		part(f, { Size = Vector3.new(w + 3, 4, w * 0.6 + 3), CFrame = cf * CFrame.new(0, h / 2, 0), Color = Color3.fromRGB(240, 185, 120), Material = Enum.Material.Sandstone })
	end
	-- Hanging rock arches overhead.
	for _ = 1, 6 do
		local p = around(rng, 150, 260, y0 + 30, y1)
		part(f, {
			Size = Vector3.new(rng:NextNumber(40, 70), 8, 12),
			CFrame = CFrame.lookAt(p, Vector3.new(0, p.Y, 0)) * CFrame.Angles(0, math.pi / 2, rng:NextNumber(-0.3, 0.3)),
			Color = Color3.fromRGB(200, 125, 75),
			Material = Enum.Material.Sandstone,
		})
	end
end

builders.glacier = function(f, rng, y0, y1)
	for _ = 1, 22 do
		local p = around(rng, 130, 330, y0, y1)
		local s = rng:NextNumber(12, 34)
		part(f, {
			Size = Vector3.new(s, s * rng:NextNumber(1.2, 2.5), s * rng:NextNumber(0.6, 1)),
			CFrame = CFrame.new(p) * CFrame.Angles(rng:NextNumber(-0.5, 0.5), rng:NextNumber(0, math.pi), rng:NextNumber(-0.5, 0.5)),
			Color = vary(rng, Color3.fromRGB(170, 225, 255), 0.06),
			Material = Enum.Material.Glacier,
			Transparency = 0.1,
		})
	end
	-- Snowy floating floes with ice spikes.
	for _ = 1, 8 do
		local p = around(rng, 160, 300, y0 + 10, y1)
		local w = rng:NextNumber(30, 50)
		part(f, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(6, w, w), CFrame = CFrame.new(p) * CFrame.Angles(0, 0, math.pi / 2), Color = Color3.new(1, 1, 1), Material = Enum.Material.Snow })
		for _ = 1, 3 do
			local off = Vector3.new(rng:NextNumber(-w / 4, w / 4), 0, rng:NextNumber(-w / 4, w / 4))
			local h = rng:NextNumber(10, 22)
			part(f, {
				Size = Vector3.new(4, h, 4),
				CFrame = CFrame.new(p + off + Vector3.new(0, h / 2, 0)) * CFrame.Angles(rng:NextNumber(-0.2, 0.2), rng:NextNumber(0, 3), rng:NextNumber(-0.2, 0.2)),
				Color = Color3.fromRGB(150, 220, 255),
				Material = Enum.Material.Ice,
			})
		end
	end
end

builders.jungle = function(f, rng, y0, y1)
	local leaf = Color3.fromRGB(50, 160, 70)
	for _ = 1, 12 do
		local p = around(rng, 150, 320, y0, y1)
		local w = rng:NextNumber(34, 60)
		island(f, rng, p, w, Color3.fromRGB(70, 150, 60), Enum.Material.LeafyGrass, 3, leaf)
		-- Vines dangling from the underside.
		for _ = 1, 4 do
			local len = rng:NextNumber(18, 45)
			local off = Vector3.new(rng:NextNumber(-w / 4, w / 4), -w * 0.4 - len / 2, rng:NextNumber(-w / 4, w / 4))
			part(f, { Size = Vector3.new(0.8, len, 0.8), CFrame = CFrame.new(p + off), Color = Color3.fromRGB(40, 120, 50), Material = Enum.Material.Grass })
		end
	end
	-- Giant leafy canopy blobs close to the tower but out of the lane.
	for _ = 1, 10 do
		ball(f, around(rng, CLEAR_RADIUS + 20, 190, y0, y1), Vector3.one * rng:NextNumber(18, 30), vary(rng, leaf, 0.1), Enum.Material.LeafyGrass)
	end
end

builders.volcano = function(f, rng, y0, y1)
	-- Embers rise from the zone floor about as high as the zone goes.
	local emberSpeed = (y1 - y0) / 12
	for _ = 1, 16 do
		local p = around(rng, 140, 330, y0, y1)
		local s = rng:NextNumber(18, 40)
		local rock = part(f, {
			Size = Vector3.new(s, s * 0.8, s * rng:NextNumber(0.7, 1.1)),
			CFrame = CFrame.new(p) * CFrame.Angles(rng:NextNumber(-0.6, 0.6), rng:NextNumber(0, math.pi), rng:NextNumber(-0.6, 0.6)),
			Color = Color3.fromRGB(45, 40, 42),
			Material = Enum.Material.Basalt,
		})
		-- Glowing cracks and a lava drip on some rocks.
		part(f, { Size = rock.Size * Vector3.new(1.02, 0.12, 1.02), CFrame = rock.CFrame, Color = Color3.fromRGB(255, 90, 20), Material = Enum.Material.Neon })
		if rng:NextNumber() < 0.5 then
			local len = rng:NextNumber(40, 120)
			part(f, { Size = Vector3.new(3, len, 3), CFrame = CFrame.new(p - Vector3.new(0, s * 0.4 + len / 2, 0)), Color = Color3.fromRGB(255, 120, 30), Material = Enum.Material.Neon, Transparency = 0.15 })
		end
		if rng:NextNumber() < 0.6 then
			local fire = Instance.new("Fire")
			fire.Size = s * 0.5
			fire.Heat = 12
			fire.Color = Color3.fromRGB(255, 120, 30)
			fire.SecondaryColor = Color3.fromRGB(255, 40, 0)
			fire.Parent = rock
		end
	end
	-- Embers drifting up through the whole zone.
	local emitterPart = part(f, { Size = Vector3.new(400, 1, 400), CFrame = CFrame.new(0, y0, 0), Transparency = 1 })
	local embers = Instance.new("ParticleEmitter")
	embers.Texture = "rbxasset://textures/particles/sparkles_main.dds"
	embers.Rate = 60
	embers.Lifetime = NumberRange.new(8, 14)
	embers.Speed = NumberRange.new(emberSpeed * 0.6, emberSpeed)
	embers.EmissionDirection = Enum.NormalId.Top
	embers.SpreadAngle = Vector2.new(15, 15)
	embers.Size = NumberSequence.new(1.2, 0)
	embers.Color = ColorSequence.new(Color3.fromRGB(255, 190, 60), Color3.fromRGB(255, 60, 20))
	embers.LightEmission = 1
	embers.Parent = emitterPart
end

builders.clouds = function(f, rng, y0, y1)
	for _ = 1, 26 do
		cloud(f, rng, around(rng, CLEAR_RADIUS + 20, 380, y0, y1), rng:NextNumber(1.2, 2.6), Color3.new(1, 1, 1), 0.08)
	end
	-- A sea of cloud right at the zone's floor so you climb "through" it.
	for i = 0, 15 do
		local a = i / 16 * math.pi * 2
		local r = rng:NextNumber(CLEAR_RADIUS + 30, 220)
		cloud(f, rng, Vector3.new(math.cos(a) * r, y0 + rng:NextNumber(-10, 10), math.sin(a) * r), 3, Color3.fromRGB(245, 248, 255), 0.15)
	end
	-- A few golden castle-ish spires sitting on clouds.
	for _ = 1, 4 do
		local p = around(rng, 220, 340, y0 + 60, y1)
		cloud(f, rng, p, 3, Color3.new(1, 1, 1), 0)
		local h = rng:NextNumber(40, 70)
		part(f, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(h, 12, 12), CFrame = CFrame.new(p + Vector3.new(0, h / 2, 0)) * CFrame.Angles(0, 0, math.pi / 2), Color = Color3.fromRGB(250, 245, 235), Material = Enum.Material.Marble })
		part(f, { Size = Vector3.new(14, 14, 14), CFrame = CFrame.new(p + Vector3.new(0, h + 4, 0)) * CFrame.Angles(0, math.pi / 4, 0), Color = Color3.fromRGB(255, 205, 70), Material = Enum.Material.Foil })
	end
end

builders.aurora = function(f, rng, y0, y1)
	-- Curtains of light: rows of thin neon slats following a wave.
	local colors = { Color3.fromRGB(80, 255, 170), Color3.fromRGB(150, 90, 255), Color3.fromRGB(60, 200, 255) }
	for c = 1, 5 do
		local r = rng:NextNumber(320, 480)
		local a0 = rng:NextNumber(0, math.pi * 2)
		local y = rng:NextNumber(y0 + 100, y1 - 100)
		local color = colors[(c - 1) % #colors + 1]
		for i = 0, 26 do
			local a = a0 + i * 0.045
			local h = 120 + math.sin(i * 0.5 + c) * 50
			local wobble = math.sin(i * 0.7 + c * 2) * 25
			local p = Vector3.new(math.cos(a) * (r + wobble), y + math.sin(i * 0.3) * 30, math.sin(a) * (r + wobble))
			part(f, {
				Size = Vector3.new(14, h, 1),
				CFrame = CFrame.lookAt(p, Vector3.new(0, p.Y, 0)),
				Color = color,
				Material = Enum.Material.Neon,
				Transparency = 0.55,
			})
		end
	end
	-- Floating crystals.
	for _ = 1, 22 do
		local p = around(rng, CLEAR_RADIUS + 20, 300, y0, y1)
		local s = rng:NextNumber(6, 16)
		part(f, {
			Size = Vector3.new(s, s * 2.4, s),
			CFrame = CFrame.new(p) * CFrame.Angles(rng:NextNumber(-0.4, 0.4), rng:NextNumber(0, 3), rng:NextNumber(-0.4, 0.4)),
			Color = colors[rng:NextInteger(1, #colors)],
			Material = Enum.Material.Glass,
			Transparency = 0.25,
		})
	end
end

builders.space = function(f, rng, y0, y1)
	-- Planets far away (big and slow to pass), each with a tilted ring for some of them.
	local planets = {
		{ color = Color3.fromRGB(230, 120, 70), material = Enum.Material.Sand, size = 300 },
		{ color = Color3.fromRGB(90, 150, 255), material = Enum.Material.Glacier, size = 200 },
		{ color = Color3.fromRGB(200, 120, 255), material = Enum.Material.Marble, size = 380 },
		{ color = Color3.fromRGB(120, 220, 150), material = Enum.Material.Grass, size = 160 },
		{ color = Color3.fromRGB(240, 220, 170), material = Enum.Material.Slate, size = 240 },
	}
	for i, pl in planets do
		local d = pl.size
		local a = i / #planets * math.pi * 2 + rng:NextNumber(-0.3, 0.3)
		local r = rng:NextNumber(900, 1300)
		local p = Vector3.new(math.cos(a) * r, y0 + (y1 - y0) * (i - 0.5) / #planets, math.sin(a) * r)
		ball(f, p, Vector3.one * d, pl.color, pl.material)
		if i % 2 == 1 then
			part(f, {
				Shape = Enum.PartType.Cylinder,
				Size = Vector3.new(1, d * 1.9, d * 1.9),
				CFrame = CFrame.new(p) * CFrame.Angles(rng:NextNumber(-0.5, 0.5), 0, math.pi / 2 + rng:NextNumber(-0.4, 0.4)),
				Color = pl.color:Lerp(Color3.new(1, 1, 1), 0.5),
				Material = Enum.Material.Neon,
				Transparency = 0.6,
			})
		end
	end
	-- Asteroid belt around the tower.
	for _ = 1, 40 do
		local s = rng:NextNumber(4, 16)
		part(f, {
			Size = Vector3.new(s, s * rng:NextNumber(0.6, 1), s * rng:NextNumber(0.6, 1)),
			CFrame = CFrame.new(around(rng, CLEAR_RADIUS + 20, 360, y0, y1)) * CFrame.Angles(rng:NextNumber(0, 3), rng:NextNumber(0, 3), 0),
			Color = vary(rng, Color3.fromRGB(110, 100, 110), 0.08),
			Material = Enum.Material.Slate,
		})
	end
	-- A golden trophy beacon on top of the tower.
	local top = y1 + 30
	local beacon = ball(f, Vector3.new(0, top + 26, 0), Vector3.one * 24, Color3.fromRGB(255, 215, 60), Enum.Material.Neon)
	local light = Instance.new("PointLight")
	light.Range = 60
	light.Brightness = 3
	light.Color = Color3.fromRGB(255, 215, 60)
	light.Parent = beacon
end

-- zoneBounds[i] = { bottom, top } of zone i in studs.
function Decor.build(parent: Instance, zoneBounds: { { number } })
	local root = Instance.new("Folder")
	root.Name = "Decor"
	for zi, theme in Config.Themes do
		local builder = builders[theme.deco]
		local bounds = zoneBounds[zi]
		if builder and bounds then
			local f = Instance.new("Folder")
			f.Name = theme.deco
			builder(f, Random.new(zi * 7919), bounds[1], bounds[2])
			f.Parent = root
		end
	end
	root.Parent = parent
end

return Decor
