--!strict
-- Builds a satellite model from parts. Every part is welded to an invisible "Root", which is
-- the PrimaryPart; anchoring or unanchoring Root moves the whole thing.

local Config = require(script.Parent.Config)

local SatModel = {}

local function rgb(c: { number }): Color3
	return Color3.fromRGB(c[1], c[2], c[3])
end
SatModel.rgb = rgb

type Ctx = { model: Model, root: BasePart, s: number }

local function part(ctx: Ctx, props: { [string]: any }): BasePart
	local p = Instance.new("Part")
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.Massless = true
	p.CastShadow = true
	p.Anchored = false
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Material = Enum.Material.SmoothPlastic
	local offset = props.Offset or CFrame.new()
	for k, v in props do
		if k ~= "Offset" then
			(p :: any)[k] = v
		end
	end
	p.Size *= ctx.s
	p.CFrame = ctx.root.CFrame * CFrame.new(offset.Position * ctx.s) * offset.Rotation
	local w = Instance.new("WeldConstraint")
	w.Part0 = ctx.root
	w.Part1 = p
	w.Parent = p
	p.Parent = ctx.model
	return p
end

local function panels(ctx: Ctx, sat: Config.Satellite, width: number)
	for _, side in { -1, 1 } do
		part(ctx, { Name = "Strut", Size = Vector3.new(1.2, 0.2, 0.2), Color = Color3.fromRGB(150, 150, 160), Material = Enum.Material.Metal, Offset = CFrame.new(side * (width / 2 + 0.5), 0, 0) })
		part(ctx, {
			Name = "Panel",
			Size = Vector3.new(4.2, 0.18, 2.4),
			Color = rgb(sat.panel),
			Material = Enum.Material.Glass,
			Reflectance = 0.25,
			Offset = CFrame.new(side * (width / 2 + 3.1), 0, 0),
		})
		-- Grid lines across the panel.
		for i = -1, 1 do
			part(ctx, { Name = "Grid", Size = Vector3.new(0.08, 0.2, 2.4), Color = Color3.fromRGB(220, 220, 230), Material = Enum.Material.Metal, Offset = CFrame.new(side * (width / 2 + 3.1) + i * 1.05, 0, 0) })
		end
	end
end

local function antenna(ctx: Ctx, y: number, color: Color3)
	part(ctx, { Name = "Antenna", Size = Vector3.new(0.15, 2, 0.15), Color = Color3.fromRGB(200, 200, 210), Material = Enum.Material.Metal, Offset = CFrame.new(0, y + 1, 0) })
	part(ctx, { Name = "Tip", Shape = Enum.PartType.Ball, Size = Vector3.new(0.5, 0.5, 0.5), Color = color, Material = Enum.Material.Neon, Offset = CFrame.new(0, y + 2.1, 0) })
end

local builders: { [string]: (Ctx, Config.Satellite, Color3) -> () } = {
	box = function(ctx, sat, glow)
		part(ctx, { Name = "Body", Size = Vector3.new(2.6, 2.6, 2.6), Color = rgb(sat.body), Material = Enum.Material.Foil, Offset = CFrame.new() })
		part(ctx, { Name = "Band", Size = Vector3.new(2.7, 0.4, 2.7), Color = glow, Material = Enum.Material.Neon, Offset = CFrame.new() })
		panels(ctx, sat, 2.6)
		antenna(ctx, 1.3, glow)
	end,
	can = function(ctx, sat, glow)
		part(ctx, { Name = "Body", Shape = Enum.PartType.Cylinder, Size = Vector3.new(3, 2.4, 2.4), Color = rgb(sat.body), Material = Enum.Material.Metal, Offset = CFrame.Angles(0, 0, math.rad(90)) })
		part(ctx, { Name = "Cap", Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.3, 2.5, 2.5), Color = glow, Material = Enum.Material.Neon, Offset = CFrame.new(0, 1.5, 0) * CFrame.Angles(0, 0, math.rad(90)) })
		panels(ctx, sat, 2.4)
		antenna(ctx, 1.6, glow)
	end,
	orb = function(ctx, sat, glow)
		part(ctx, { Name = "Body", Shape = Enum.PartType.Ball, Size = Vector3.new(3, 3, 3), Color = rgb(sat.body), Material = Enum.Material.Metal, Reflectance = 0.2, Offset = CFrame.new() })
		part(ctx, { Name = "Equator", Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.3, 3.15, 3.15), Color = glow, Material = Enum.Material.Neon, Offset = CFrame.Angles(0, 0, math.rad(90)) })
		-- Sputnik-style whiskers swept back.
		for i = 0, 3 do
			local a = i * math.pi / 2 + math.pi / 4
			part(ctx, {
				Name = "Whisker",
				Size = Vector3.new(0.12, 0.12, 4.5),
				Color = rgb(sat.panel),
				Material = Enum.Material.Metal,
				Offset = CFrame.Angles(0, a, 0) * CFrame.Angles(math.rad(-25), 0, 0) * CFrame.new(0, 0, 3),
			})
		end
	end,
	dish = function(ctx, sat, glow)
		part(ctx, { Name = "Body", Size = Vector3.new(2.4, 2, 2.4), Color = rgb(sat.panel), Material = Enum.Material.Foil, Offset = CFrame.new(0, -0.6, 0) })
		part(ctx, { Name = "Dish", Shape = Enum.PartType.Ball, Size = Vector3.new(5, 1.1, 5), Color = rgb(sat.body), Material = Enum.Material.SmoothPlastic, Offset = CFrame.new(0, 1.2, 0.4) * CFrame.Angles(math.rad(-30), 0, 0) })
		part(ctx, { Name = "Feed", Size = Vector3.new(0.15, 2, 0.15), Color = Color3.fromRGB(180, 180, 190), Material = Enum.Material.Metal, Offset = CFrame.new(0, 2.2, -0.2) * CFrame.Angles(math.rad(-30), 0, 0) })
		part(ctx, { Name = "Tip", Shape = Enum.PartType.Ball, Size = Vector3.new(0.6, 0.6, 0.6), Color = glow, Material = Enum.Material.Neon, Offset = CFrame.new(0, 3.1, -0.7) })
		panels(ctx, sat, 2.4)
	end,
	scope = function(ctx, sat, glow)
		local tilt = CFrame.Angles(math.rad(25), 0, 0)
		part(ctx, { Name = "Tube", Shape = Enum.PartType.Cylinder, Size = Vector3.new(5, 2, 2), Color = rgb(sat.body), Material = Enum.Material.Metal, Offset = tilt * CFrame.Angles(0, math.rad(90), 0) })
		part(ctx, { Name = "Lens", Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.3, 1.7, 1.7), Color = rgb(sat.panel), Material = Enum.Material.Neon, Offset = tilt * CFrame.new(0, 0, -2.55) * CFrame.Angles(0, math.rad(90), 0) })
		part(ctx, { Name = "Hood", Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.4, 2.2, 2.2), Color = glow, Material = Enum.Material.Neon, Offset = tilt * CFrame.new(0, 0, 1.6) * CFrame.Angles(0, math.rad(90), 0) })
		panels(ctx, sat, 2)
	end,
	ring = function(ctx, sat, glow)
		part(ctx, { Name = "Body", Shape = Enum.PartType.Ball, Size = Vector3.new(2.6, 2.6, 2.6), Color = rgb(sat.body), Material = Enum.Material.Metal, Reflectance = 0.3, Offset = CFrame.new() })
		part(ctx, { Name = "Core", Shape = Enum.PartType.Ball, Size = Vector3.new(1.4, 1.4, 1.4), Color = rgb(sat.panel), Material = Enum.Material.Neon, Offset = CFrame.new(0, 0, -0.9) })
		local tilt = CFrame.Angles(math.rad(20), 0, math.rad(12))
		for i = 0, 15 do
			local a = i * math.pi * 2 / 16
			part(ctx, {
				Name = "Ring",
				Size = Vector3.new(1.25, 0.25, 0.45),
				Color = if i % 2 == 0 then glow else rgb(sat.panel),
				Material = Enum.Material.Neon,
				Offset = tilt * CFrame.Angles(0, a, 0) * CFrame.new(0, 0, 3.2) * CFrame.Angles(0, math.rad(90), 0),
			})
		end
	end,
	crystal = function(ctx, sat, glow)
		part(ctx, { Name = "Crystal", Size = Vector3.new(2.4, 2.4, 2.4), Color = rgb(sat.body), Material = Enum.Material.Glass, Transparency = 0.15, Reflectance = 0.3, Offset = CFrame.Angles(math.rad(45), 0, math.rad(45)) })
		part(ctx, { Name = "Heart", Size = Vector3.new(1.2, 1.2, 1.2), Color = rgb(sat.panel), Material = Enum.Material.Neon, Offset = CFrame.Angles(math.rad(45), 0, math.rad(45)) })
		for _, y in { -2.2, 2.2 } do
			part(ctx, { Name = "Spike", Size = Vector3.new(0.8, 1.6, 0.8), Color = glow, Material = Enum.Material.Neon, Offset = CFrame.new(0, y, 0) * CFrame.Angles(0, math.rad(45), 0) })
		end
		panels(ctx, sat, 3.2)
	end,
	monolith = function(ctx, sat, glow)
		part(ctx, { Name = "Slab", Size = Vector3.new(2.2, 6, 0.7), Color = rgb(sat.body), Material = Enum.Material.Glass, Reflectance = 0.5, Offset = CFrame.new(0, 0.6, 0) })
		for _, x in { -1.15, 1.15 } do
			part(ctx, { Name = "Edge", Size = Vector3.new(0.12, 6.1, 0.8), Color = glow, Material = Enum.Material.Neon, Offset = CFrame.new(x, 0.6, 0) })
		end
		for i = 0, 5 do
			local a = i * math.pi / 3
			part(ctx, {
				Name = "Shard",
				Size = Vector3.new(0.5, 0.5, 0.5),
				Color = rgb(sat.panel),
				Material = Enum.Material.Neon,
				Offset = CFrame.Angles(0, a, 0) * CFrame.new(0, 0.6 + math.sin(a) * 1.5, 2.4) * CFrame.Angles(math.rad(45), math.rad(45), 0),
			})
		end
	end,
}

-- Builds the model at `cframe` (anchored Root). `glowOverride` recolors the neon trim.
function SatModel.build(id: string, cframe: CFrame): Model
	local sat = Config.ById[id]
	local rarity = Config.Rarities[sat.tier]
	local glow = if sat.tier == 8 then Color3.new(1, 1, 1) else rgb(rarity.color)

	local model = Instance.new("Model")
	model.Name = sat.name
	model:SetAttribute("SatId", id)
	local root = Instance.new("Part")
	root.Name = "Root"
	root.Size = Vector3.new(1, 1, 1)
	root.Transparency = 1
	root.CanCollide = false
	root.CanQuery = false
	root.CanTouch = false
	root.Anchored = true
	root.CFrame = cframe
	root.Parent = model
	model.PrimaryPart = root

	builders[sat.shape]({ model = model, root = root, s = sat.scale }, sat, glow)

	if sat.tier >= 4 then
		local e = Instance.new("ParticleEmitter")
		e.Name = "Sparkle"
		e.Texture = "rbxasset://textures/particles/sparkles_main.dds"
		e.Color = ColorSequence.new(glow)
		e.LightEmission = 1
		e.Rate = 4 + sat.tier * 2
		e.Lifetime = NumberRange.new(0.8, 1.4)
		e.Speed = NumberRange.new(1.5, 3)
		e.SpreadAngle = Vector2.new(180, 180)
		e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.5), NumberSequenceKeypoint.new(1, 0) })
		e.Parent = root
	end
	if sat.tier >= 5 then
		local light = Instance.new("PointLight")
		light.Color = glow
		light.Range = 10 + sat.tier
		light.Brightness = 1.6
		light.Parent = root
	end
	return model
end

return SatModel
