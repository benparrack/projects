--!strict
-- +1 Jump Tower server: player state, the +1/s gain tick, win pads, lava, remotes, purchases.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local ServerScriptService = game:GetService("ServerScriptService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Formulas = require(Shared.Formulas)
local TowerLayout = require(Shared.TowerLayout)
local SaveStore = require(ServerScriptService.ServerLib.SaveStore)
local Monetization = require(ServerScriptService.ServerLib.Monetization)
local World = require(script.Parent.World)

workspace.Gravity = Config.Gravity

local built = World.build()
local pillars = TowerLayout.build()
local zoneEndPillar: { [number]: TowerLayout.Pillar } = {}
for _, p in pillars do
	if p.isZoneEnd then
		zoneEndPillar[p.zone] = p
	end
end

-- Remotes ------------------------------------------------------------------------------

local remotes = Instance.new("Folder")
remotes.Name = "Remotes"
local actionRemote = Instance.new("RemoteEvent")
actionRemote.Name = "Action"
actionRemote.Parent = remotes
local notifyRemote = Instance.new("RemoteEvent")
notifyRemote.Name = "Notify"
notifyRemote.Parent = remotes
remotes.Parent = ReplicatedStorage

local function notify(player: Player, text: string, kind: string?)
	notifyRemote:FireClient(player, text, kind or "info")
end

-- Save data ------------------------------------------------------------------------------

local TEMPLATE = {
	jump = 0,
	wins = 0,
	rebirths = 0,
	bestZone = 0,
	clears = 0,
	trails = {},
	equipped = "",
	dailyLast = -1,
	dailyStreak = 0,
	playSeconds = 0,
	receipts = {},
}

local store = SaveStore.new("JumpTower_v1", TEMPLATE, {
	onFail = function(player, reason)
		player:Kick(`Your data couldn't be loaded ({reason}). Please rejoin in a minute.`)
	end,
})

type Session = {
	profile: SaveStore.Profile,
	runZones: { [number]: boolean },
	checkpoint: number,
	giftsClaimed: number,
	nextGiftAt: number,
	lastAction: number,
	lastLavaHit: number,
	overhead: TextLabel?,
	leaderstats: { Jump: NumberValue, Wins: NumberValue, Rebirths: IntValue },
}
local sessions: { [Player]: Session } = {}

-- Monetization ---------------------------------------------------------------------------

local passIds: { [string]: number } = {}
for key, pass in Config.GamePasses do
	passIds[key] = pass.id
end

local function gainState(player: Player, data: any): Formulas.GainState
	local trail = nil
	for _, t in Config.Trails do
		if t.id == data.equipped then
			trail = t
		end
	end
	return {
		rebirths = data.rebirths,
		x2Jump = player:GetAttribute("Pass_x2Jump") == true,
		vip = player:GetAttribute("Pass_vip") == true,
		trailBonus = if trail then trail.bonus else 0,
	}
end

local refresh: (player: Player) -> ()
local applyTrail: (player: Player) -> ()

local productHandlers = {}
for _, product in Config.Products do
	if product.id ~= 0 then
		productHandlers[product.id] = function(player: Player, profile: SaveStore.Profile): boolean
			local data = profile.data
			if product.kind == "jumpMinutes" then
				local amount = Formulas.gainPerSecond(gainState(player, data)) * 60 * product.amount
				data.jump += amount
				notify(player, `+{Formulas.abbreviate(amount)} Jump!`, "reward")
			elseif product.kind == "skipZone" then
				local need = Formulas.nextZoneNeed(data.jump)
				if need then
					data.jump = need
					notify(player, "Zone skipped! You can clear the next zone now.", "reward")
				else
					local amount = Formulas.gainPerSecond(gainState(player, data)) * 600
					data.jump += amount
					notify(player, `Tower maxed: +{Formulas.abbreviate(amount)} Jump instead!`, "reward")
				end
			else
				return false
			end
			refresh(player)
			return true
		end
	end
end

local monetization = Monetization.new({
	store = store,
	passes = passIds,
	products = productHandlers,
	onPassOwned = function(player, key)
		player:SetAttribute("Pass_" .. key, true)
		if key == "vip" then
			local session = sessions[player]
			if session then
				session.profile.data.trails.vip = true
				if session.profile.data.equipped == "" then
					session.profile.data.equipped = "vip"
				end
				applyTrail(player)
			end
		end
		if sessions[player] then
			refresh(player)
		end
	end,
})
monetization:start()

-- Character helpers ----------------------------------------------------------------------

local function checkpointCFrame(session: Session): CFrame
	local p = zoneEndPillar[session.checkpoint]
	if p then
		return CFrame.new(p.x, p.top + 4, p.z)
	end
	return CFrame.new(0, 4, 0)
end

local function teleport(player: Player, cf: CFrame)
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
	if character and root then
		root.AssemblyLinearVelocity = Vector3.zero
		character:PivotTo(cf)
	end
end

local function resetRun(session: Session)
	session.runZones = {}
	session.checkpoint = 0
end

function applyTrail(player: Player)
	local session = sessions[player]
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if not session or not root then
		return
	end
	local old = root:FindFirstChild("JT_Trail")
	if old then
		old:Destroy()
	end
	for _, name in { "JT_A0", "JT_A1" } do
		local a = root:FindFirstChild(name)
		if a then
			a:Destroy()
		end
	end
	local trail = nil
	for _, t in Config.Trails do
		if t.id == session.profile.data.equipped then
			trail = t
		end
	end
	if not trail then
		return
	end
	local a0 = Instance.new("Attachment")
	a0.Name = "JT_A0"
	a0.Position = Vector3.new(0, 0.9, 0)
	a0.Parent = root
	local a1 = Instance.new("Attachment")
	a1.Name = "JT_A1"
	a1.Position = Vector3.new(0, -0.9, 0)
	a1.Parent = root
	local t = Instance.new("Trail")
	t.Name = "JT_Trail"
	t.Attachment0 = a0
	t.Attachment1 = a1
	t.Lifetime = 0.7
	t.LightEmission = 0.8
	t.FaceCamera = true
	local c1, c2 = trail.colors[1], trail.colors[2]
	t.Color = ColorSequence.new(Color3.fromRGB(c1[1], c1[2], c1[3]), Color3.fromRGB(c2[1], c2[2], c2[3]))
	t.Transparency = NumberSequence.new(0.1, 1)
	t.Parent = root
end

local function buildOverhead(character: Model): TextLabel?
	local head = character:WaitForChild("Head", 5)
	if not head then
		return nil
	end
	local gui = Instance.new("BillboardGui")
	gui.Name = "JT_Overhead"
	gui.Size = UDim2.fromOffset(160, 44)
	gui.StudsOffset = Vector3.new(0, 2.6, 0)
	gui.MaxDistance = 150
	gui.LightInfluence = 0
	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.FredokaOne
	label.TextScaled = true
	label.TextStrokeTransparency = 0.3
	label.TextColor3 = Color3.new(1, 1, 1)
	label.Parent = gui
	gui.Parent = head
	return label
end

-- State sync -----------------------------------------------------------------------------

function refresh(player: Player)
	local session = sessions[player]
	if not session then
		return
	end
	local data = session.profile.data
	local gain = Formulas.gainPerSecond(gainState(player, data))
	player:SetAttribute("Jump", data.jump)
	player:SetAttribute("Wins", data.wins)
	player:SetAttribute("Rebirths", data.rebirths)
	player:SetAttribute("Gain", gain)
	player:SetAttribute("BestZone", data.bestZone)
	player:SetAttribute("Checkpoint", session.checkpoint)
	player:SetAttribute("RebirthCost", Formulas.rebirthCost(data.rebirths))
	player:SetAttribute("Equipped", data.equipped)
	local owned = {}
	for id in data.trails do
		table.insert(owned, id)
	end
	player:SetAttribute("OwnedTrails", table.concat(owned, ","))
	player:SetAttribute("GiftsClaimed", session.giftsClaimed)
	player:SetAttribute("NextGiftAt", session.nextGiftAt)
	local _, dailyDue = Formulas.advanceStreak(data.dailyLast, data.dailyStreak, Formulas.dayIndex(os.time()))
	player:SetAttribute("DailyReady", dailyDue)
	player:SetAttribute("DailyStreak", data.dailyStreak)

	session.leaderstats.Jump.Value = math.floor(data.jump)
	session.leaderstats.Wins.Value = data.wins
	session.leaderstats.Rebirths.Value = data.rebirths

	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if humanoid then
		humanoid.UseJumpPower = true
		humanoid.JumpPower = Formulas.jumpPower(Formulas.jumpHeight(data.jump))
	end
	if session.overhead then
		local vip = if player:GetAttribute("Pass_vip") then "👑 " else ""
		session.overhead.Text = `{vip}⬆ {Formulas.abbreviate(data.jump)}`
		session.overhead.TextColor3 = if vip ~= "" then Color3.fromRGB(255, 215, 60) else Color3.new(1, 1, 1)
	end
end

-- Player lifecycle -----------------------------------------------------------------------

local function onCharacter(player: Player, character: Model)
	local session = sessions[player]
	if not session then
		return
	end
	local humanoid = character:WaitForChild("Humanoid", 10) :: Humanoid?
	if not humanoid then
		return
	end
	humanoid.WalkSpeed = Config.WalkSpeed
	session.overhead = buildOverhead(character)
	applyTrail(player)
	refresh(player)
	if session.checkpoint > 0 then
		task.defer(teleport, player, checkpointCFrame(session))
	end
end

local function onPlayerAdded(player: Player)
	local profile = store:attach(player, RunService:IsStudio())
	if not profile or not player.Parent then
		return
	end

	local folder = Instance.new("Folder")
	folder.Name = "leaderstats"
	local jumpStat = Instance.new("NumberValue")
	jumpStat.Name = "Jump"
	jumpStat.Parent = folder
	local winsStat = Instance.new("NumberValue")
	winsStat.Name = "Wins"
	winsStat.Parent = folder
	local rebirthStat = Instance.new("IntValue")
	rebirthStat.Name = "Rebirths"
	rebirthStat.Parent = folder
	folder.Parent = player

	sessions[player] = {
		profile = profile,
		runZones = {},
		checkpoint = 0,
		giftsClaimed = 0,
		nextGiftAt = os.time() + Config.GiftInterval,
		lastAction = 0,
		lastLavaHit = 0,
		overhead = nil,
		leaderstats = { Jump = jumpStat, Wins = winsStat, Rebirths = rebirthStat },
	}

	task.spawn(function()
		monetization:loadPasses(player)
	end)

	player.CharacterAdded:Connect(function(character)
		onCharacter(player, character)
	end)
	if player.Character then
		task.spawn(onCharacter, player, player.Character)
	end
	refresh(player)
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end
Players.PlayerRemoving:Connect(function(player)
	sessions[player] = nil
end)
store:start(60)

-- World interactions ---------------------------------------------------------------------

local function playerFromHit(hit: BasePart): Player?
	local model = hit:FindFirstAncestorOfClass("Model")
	return model and Players:GetPlayerFromCharacter(model)
end

local function sendToCheckpoint(player: Player)
	local session = sessions[player]
	if not session or os.clock() - session.lastLavaHit < 1 then
		return
	end
	session.lastLavaHit = os.clock()
	teleport(player, checkpointCFrame(session))
end

built.lava.Touched:Connect(function(hit)
	local player = playerFromHit(hit)
	if player then
		sendToCheckpoint(player)
	end
end)

local lastZone = #Config.Zones
for zone, pad in built.winPads do
	pad.Touched:Connect(function(hit)
		local player = playerFromHit(hit)
		local session = player and sessions[player]
		if not player or not session or session.runZones[zone] then
			return
		end
		local data = session.profile.data
		-- Loose sanity check: you can't physically be here with a tiny jump stat.
		if data.jump < Config.Zones[zone].need * 0.5 then
			return
		end
		session.runZones[zone] = true
		session.checkpoint = zone
		local wins = Formulas.winsForZone(zone, player:GetAttribute("Pass_x2Wins") == true)
		data.wins += wins
		data.bestZone = math.max(data.bestZone, zone)
		if zone == lastZone then
			data.clears += 1
			notify(player, `🌟 TOWER CLEARED! +{Formulas.abbreviate(wins)} Wins`, "big")
			resetRun(session)
			task.delay(2.5, teleport, player, CFrame.new(0, 4, 0))
		else
			notify(player, `Zone {zone} cleared! +{Formulas.abbreviate(wins)} Wins`, "reward")
		end
		refresh(player)
	end)
end

-- Client actions -------------------------------------------------------------------------

local actions: { [string]: (player: Player, session: Session, arg: any) -> () } = {}

function actions.rebirth(player, session)
	local data = session.profile.data
	local cost = Formulas.rebirthCost(data.rebirths)
	if data.jump < cost then
		notify(player, `Need {Formulas.abbreviate(cost)} Jump to rebirth`, "error")
		return
	end
	data.jump = 0
	data.rebirths += 1
	resetRun(session)
	teleport(player, CFrame.new(0, 4, 0))
	notify(player, `REBIRTH! Jump gain is now x{Formulas.abbreviate(1 + data.rebirths)}`, "big")
end

function actions.spawn(player, session)
	resetRun(session)
	teleport(player, CFrame.new(0, 4, 0))
end

function actions.gift(player, session)
	if session.giftsClaimed >= Config.GiftsPerSession or os.time() < session.nextGiftAt then
		return
	end
	local data = session.profile.data
	session.giftsClaimed += 1
	session.nextGiftAt = os.time() + Config.GiftInterval
	if math.random() < 0.6 then
		local amount = Formulas.gainPerSecond(gainState(player, data)) * 120
		data.jump += amount
		notify(player, `🎁 Gift: +{Formulas.abbreviate(amount)} Jump`, "reward")
	else
		local wins = math.max(2, data.bestZone * data.bestZone)
		data.wins += wins
		notify(player, `🎁 Gift: +{Formulas.abbreviate(wins)} Wins`, "reward")
	end
end

function actions.daily(player, session)
	local data = session.profile.data
	local today = Formulas.dayIndex(os.time())
	local streak, due = Formulas.advanceStreak(data.dailyLast, data.dailyStreak, today)
	if not due then
		return
	end
	data.dailyLast = today
	data.dailyStreak = streak
	local wins = Formulas.dailyWins(streak)
	data.wins += wins
	notify(player, `📅 Day {streak} streak: +{wins} Wins`, "reward")
end

function actions.buyTrail(player, session, id)
	local data = session.profile.data
	for _, t in Config.Trails do
		if t.id == id and t.cost > 0 and not data.trails[id] then
			if data.wins < t.cost then
				notify(player, `Need {Formulas.abbreviate(t.cost)} Wins`, "error")
				return
			end
			data.wins -= t.cost
			data.trails[id] = true
			data.equipped = id
			applyTrail(player)
			notify(player, `Unlocked {t.name} trail (+{math.floor(t.bonus * 100)}% gain)`, "reward")
		end
	end
end

function actions.equip(player, session, id)
	local data = session.profile.data
	if id == "" or data.trails[id] then
		data.equipped = id
		applyTrail(player)
	end
end

actionRemote.OnServerEvent:Connect(function(player, name, arg)
	local session = sessions[player]
	local handler = if type(name) == "string" then actions[name] else nil
	if not session or not handler or os.clock() - session.lastAction < 0.25 then
		return
	end
	session.lastAction = os.clock()
	handler(player, session, arg)
	refresh(player)
end)

-- The +1 tick ----------------------------------------------------------------------------

task.spawn(function()
	while true do
		task.wait(1)
		for player, session in sessions do
			local data = session.profile.data
			data.jump += Formulas.gainPerSecond(gainState(player, data))
			data.playSeconds += 1
			refresh(player)
			-- Backup for fast falls that skip the lava's Touched event.
			local root = player.Character and player.Character:FindFirstChild("HumanoidRootPart") :: BasePart?
			if root and root.Position.Y < -30 then
				sendToCheckpoint(player)
			end
		end
	end
end)
