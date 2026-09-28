--!strict
-- Presentation only: altitude-driven sky, the altitude meter, zone banners, music/wind,
-- jump & landing effects, FOV kick and win confetti. No gameplay state lives here.

local Lighting = game:GetService("Lighting")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Formulas = require(Shared.Formulas)
local TowerLayout = require(Shared.TowerLayout)
local Sfx = require(script.Parent.Sfx)
local Ui = require(script.Parent.Ui)

local player = Players.LocalPlayer
local notifyRemote = ReplicatedStorage:WaitForChild("Remotes"):WaitForChild("Notify") :: RemoteEvent
local hud = player:WaitForChild("PlayerGui"):WaitForChild("JumpTowerHud") :: ScreenGui

local ZONES = #Config.Zones
local BASE_FOV = 70

local function rgb(c: { number }): Color3
	return Color3.fromRGB(c[1], c[2], c[3])
end

-- Zone height ranges ------------------------------------------------------------------

local bounds: { { number } } = {}
do
	local bottom = 0
	for _, p in TowerLayout.build() do
		if p.isZoneEnd then
			table.insert(bounds, { bottom, p.top })
			bottom = p.top
		end
	end
end

-- Continuous zone coordinate: 1.0 at the bottom of zone 1, 2.0 at the bottom of zone 2, ...
local function zoneCoord(y: number): number
	for i, b in bounds do
		if y < b[2] or i == ZONES then
			return i + math.clamp((y - b[1]) / (b[2] - b[1]), 0, 1)
		end
	end
	return ZONES + 1
end

-- Sky ---------------------------------------------------------------------------------

local atmosphere = Lighting:WaitForChild("Atmosphere", 10) :: Atmosphere?
local clouds = Workspace.Terrain:FindFirstChildOfClass("Clouds")

local function smooth(t: number): number
	return t * t * (3 - 2 * t)
end

local function applySky(coord: number)
	local z = math.clamp(math.floor(coord), 1, ZONES)
	local frac = coord - z
	local a = Config.Themes[z]
	local b = Config.Themes[math.min(z + 1, ZONES)]
	-- Hold each zone's look for most of the zone, then blend into the next near the top.
	local t = smooth(math.clamp((frac - 0.55) / 0.45, 0, 1))
	local ca = if a.clock == 0 then 24 else a.clock
	local cb = if b.clock == 0 then 24 else b.clock
	Lighting.ClockTime = (ca + (cb - ca) * t) % 24
	Lighting.OutdoorAmbient = rgb(a.ambient):Lerp(rgb(b.ambient), t)
	if atmosphere then
		atmosphere.Color = rgb(a.sky):Lerp(rgb(b.sky), t)
		atmosphere.Decay = rgb(a.decay):Lerp(rgb(b.decay), t)
		atmosphere.Density = a.density + (b.density - a.density) * t
		atmosphere.Haze = a.haze + (b.haze - a.haze) * t
	end
	if clouds then
		-- Terrain clouds sit low; fade them out once you're above the cloud zone.
		clouds.Cover = 0.55 * (1 - math.clamp(coord - 6.5, 0, 1))
	end
end

-- Altitude meter ----------------------------------------------------------------------

local meter = Ui.new("Frame", {
	Name = "AltitudeMeter",
	AnchorPoint = Vector2.new(1, 0.5),
	Position = UDim2.new(1, -14, 0.5, 0),
	Size = UDim2.fromOffset(22, 380),
	BackgroundColor3 = Color3.fromRGB(15, 16, 28),
	BackgroundTransparency = 0.2,
	Parent = hud,
}, { Ui.corner(11), Ui.stroke(Color3.fromRGB(10, 10, 20), 3) })

for i, zone in Config.Zones do
	Ui.new("Frame", {
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1 - (i - 1) / ZONES, -2),
		Size = UDim2.new(1, -8, 1 / ZONES, -3),
		BackgroundColor3 = rgb(zone.color),
		BackgroundTransparency = 0.25,
		Parent = meter,
	}, { Ui.corner(6) })
end

local marker = Ui.new("Frame", {
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.fromScale(0.5, 1),
	Size = UDim2.fromOffset(34, 34),
	BackgroundTransparency = 1,
	ZIndex = 3,
	Parent = meter,
})
local face = Ui.new("ImageLabel", {
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.fromScale(0.5, 0.5),
	Size = UDim2.fromOffset(34, 34),
	BackgroundColor3 = Color3.fromRGB(255, 255, 255),
	ZIndex = 4,
	Parent = marker,
}, { Ui.corner(17), Ui.stroke(Color3.fromRGB(20, 20, 30), 3) })
task.spawn(function()
	local ok, image = pcall(function()
		return Players:GetUserThumbnailAsync(player.UserId, Enum.ThumbnailType.HeadShot, Enum.ThumbnailSize.Size48x48)
	end)
	if ok then
		face.Image = image
	end
end)
-- Current height, just under the meter.
local heightLabel = Ui.label({
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 1, 6),
	Size = UDim2.fromOffset(70, 22),
	Text = "0m",
	Parent = meter,
})

-- Zone banner -------------------------------------------------------------------------

local banner = Ui.new("Frame", {
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.fromScale(0.5, 0.32),
	Size = UDim2.fromOffset(640, 130),
	BackgroundTransparency = 1,
	Visible = false,
	Parent = hud,
})
local bannerSub = Ui.label({ Size = UDim2.new(1, 0, 0, 34), Text = "", TextColor3 = Color3.new(1, 1, 1), Parent = banner })
local bannerTitle = Ui.label({ Position = UDim2.fromOffset(0, 34), Size = UDim2.new(1, 0, 0, 90), Text = "", Parent = banner })
local bannerToken = 0

local function showBanner(zone: number)
	bannerToken += 1
	local token = bannerToken
	local z = Config.Zones[zone]
	bannerSub.Text = `ZONE {zone} / {ZONES}`
	bannerTitle.Text = string.upper(z.name)
	bannerTitle.TextColor3 = rgb(z.color)
	for _, l in { bannerSub, bannerTitle } do
		l.TextTransparency = 0
		local s = l:FindFirstChildOfClass("UIStroke")
		if s then
			s.Transparency = 0.2
		end
	end
	banner.Visible = true
	Ui.pop(banner, 0.4)
	Sfx.play("levelUp", 0.45)
	task.delay(2.6, function()
		if token ~= bannerToken then
			return
		end
		for _, l in { bannerSub, bannerTitle } do
			TweenService:Create(l, TweenInfo.new(0.5), { TextTransparency = 1 }):Play()
			local s = l:FindFirstChildOfClass("UIStroke")
			if s then
				TweenService:Create(s, TweenInfo.new(0.5), { Transparency = 1 }):Play()
			end
		end
		task.wait(0.5)
		if token == bannerToken then
			banner.Visible = false
		end
	end)
end

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

notifyRemote.OnClientEvent:Connect(function(_text: string, kind: string)
	if kind == "win" then
		Sfx.play("victory", 0.6)
		confetti(70)
	elseif kind == "big" then
		Sfx.play("victory", 0.7)
		confetti(160)
	end
end)

-- Music & wind (with a mute toggle next to the top card) ------------------------------

local music = Sfx.loop("music", 0.22)
local wind = Sfx.loop("wind", 0)
local musicOn = true
local musicButton = Ui.button({
	AnchorPoint = Vector2.new(0, 0),
	Position = UDim2.new(0.5, 190, 0, 8),
	Size = UDim2.fromOffset(46, 46),
	Text = "🎵",
	Parent = hud,
}, Ui.Colors.blue, function() end)
musicButton.Activated:Connect(function()
	musicOn = not musicOn
	music.Volume = if musicOn then 0.22 else 0
	musicButton.Text = if musicOn then "🎵" else "🔇"
end)

-- Character effects -------------------------------------------------------------------

local function puff(position: Vector3, color: Color3, count: number, speed: number)
	local a = Instance.new("Attachment")
	a.WorldPosition = position
	a.Parent = Workspace.Terrain
	local e = Instance.new("ParticleEmitter")
	e.Texture = "rbxasset://textures/particles/smoke_main.dds"
	e.Color = ColorSequence.new(color)
	e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 2), NumberSequenceKeypoint.new(1, 5) })
	e.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.3), NumberSequenceKeypoint.new(1, 1) })
	e.Lifetime = NumberRange.new(0.5, 0.9)
	e.Speed = NumberRange.new(speed * 0.6, speed)
	e.SpreadAngle = Vector2.new(180, 10)
	e.EmissionDirection = Enum.NormalId.Top
	e.Acceleration = Vector3.new(0, -10, 0)
	e.Drag = 4
	e.Rate = 0
	e.Parent = a
	e:Emit(count)
	task.delay(1.5, function()
		a:Destroy()
	end)
end

local maxFallSpeed = 0

local function onCharacter(character: Model)
	local humanoid = character:WaitForChild("Humanoid") :: Humanoid
	local root = character:WaitForChild("HumanoidRootPart") :: BasePart
	humanoid.StateChanged:Connect(function(_, new)
		local feet = root.Position - Vector3.new(0, humanoid.HipHeight + root.Size.Y / 2, 0)
		if new == Enum.HumanoidStateType.Jumping then
			local power = humanoid.JumpPower
			if power > 70 then
				Sfx.play("whoosh", math.clamp(power / 600, 0.3, 0.7), math.clamp(1.25 - power / 1500, 0.8, 1.2))
				puff(feet, Color3.new(1, 1, 1), math.clamp(math.floor(power / 40), 4, 16), 18)
			end
		elseif new == Enum.HumanoidStateType.Landed then
			if maxFallSpeed > 70 then
				local floor = humanoid.FloorMaterial
				local color = if floor == Enum.Material.Grass or floor == Enum.Material.LeafyGrass
					then Color3.fromRGB(170, 220, 140)
					elseif floor == Enum.Material.Sandstone then Color3.fromRGB(235, 190, 140)
					else Color3.fromRGB(235, 235, 245)
				puff(feet, color, math.clamp(math.floor(maxFallSpeed / 20), 5, 20), math.clamp(maxFallSpeed / 6, 12, 40))
			end
			maxFallSpeed = 0
		end
	end)
end
if player.Character then
	task.spawn(onCharacter, player.Character)
end
player.CharacterAdded:Connect(onCharacter)

-- Per-frame: sky, meter, banner trigger, FOV, wind ------------------------------------

local shownZone = 1
local lastSky = 0
local fov = BASE_FOV

RunService.RenderStepped:Connect(function(dt)
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not root then
		return
	end
	local y = root.Position.Y
	local v = root.AssemblyLinearVelocity
	local coord = zoneCoord(y)
	local zone = math.clamp(math.floor(coord), 1, ZONES)

	-- Sky: the blend is cheap but Lighting writes aren't; ~20 Hz is plenty.
	lastSky += dt
	if lastSky > 0.05 then
		lastSky = 0
		applySky(coord)
	end

	-- Meter marker
	local t = math.clamp((coord - 1) / ZONES, 0, 1)
	marker.Position = UDim2.fromScale(0.5, 1 - t)
	heightLabel.Text = `{Formulas.abbreviate(math.max(0, math.floor(y)))}m`

	-- Banner when you climb into a zone above the last one announced; dropping down re-arms it.
	if zone > shownZone then
		shownZone = zone
		showBanner(zone)
	elseif zone < shownZone then
		shownZone = zone
	end

	-- FOV kick while launching up or plummeting.
	if v.Y < -maxFallSpeed then
		maxFallSpeed = -v.Y
	end
	local target = BASE_FOV + math.clamp((v.Y - 60) / 25, 0, 16) + math.clamp((-v.Y - 120) / 30, 0, 10)
	fov += (target - fov) * math.min(1, dt * 6)
	local camera = Workspace.CurrentCamera
	if camera then
		camera.FieldOfView = fov
	end

	-- Wind rises with speed and a little with altitude.
	wind.Volume = math.clamp((v.Magnitude - 60) / 400, 0, 0.5) + math.clamp(coord - 5, 0, 1) * 0.06
end)
