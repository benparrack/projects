--!strict
-- Anomaly Shift server: shifts (private looping corridors), anomaly rolls, the forward/back
-- decision, rewards, radar + second chance, daily streaks, purchases and leaderboards.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local ServerScriptService = game:GetService("ServerScriptService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Rules = require(Shared.Rules)
local SaveStore = require(ServerScriptService.ServerLib.SaveStore)
local Monetization = require(ServerScriptService.ServerLib.Monetization)
local Leaderboard = require(ServerScriptService.ServerLib.Leaderboard)
local World = require(script.Parent.World)

local built = World.build()
local corridorFolder = Workspace:WaitForChild("Corridors")
local H = Config.Hall

-- Remotes ------------------------------------------------------------------------------

local remotes = Instance.new("Folder")
remotes.Name = "Remotes"
local actionRemote = Instance.new("RemoteEvent")
actionRemote.Name = "Action"
actionRemote.Parent = remotes
local notifyRemote = Instance.new("RemoteEvent")
notifyRemote.Name = "Notify"
notifyRemote.Parent = remotes
local fxRemote = Instance.new("RemoteEvent")
fxRemote.Name = "Fx"
fxRemote.Parent = remotes
remotes.Parent = ReplicatedStorage

local function notify(player: Player, text: string, kind: string?)
	notifyRemote:FireClient(player, text, kind or "info")
end

local function now(): number
	return os.clock()
end

-- Save data ------------------------------------------------------------------------------

local TEMPLATE = {
	coins = 0,
	escapes = 0,
	bestTime = 0, -- seconds, 0 = never escaped
	runs = 0,
	floorsCleared = 0,
	found = {}, -- anomaly id -> true
	radars = 2,
	revives = 1,
	dailyLast = -1,
	dailyStreak = 0,
	tutorialDone = false,
	receipts = {},
}

local store = SaveStore.new("AnomalyShift_v1", TEMPLATE, {
	onFail = function(player, reason)
		player:Kick(`Your data couldn't be loaded ({reason}). Please rejoin in a minute.`)
	end,
})

type Session = {
	profile: SaveStore.Profile,
	slot: number,
	corridor: World.Corridor?,
	inShift: boolean,
	busy: boolean,
	armed: boolean,
	floor: number,
	anomaly: string?,
	last: string?,
	calm: number,
	runStart: number,
	radarUsed: boolean,
	luckyUsed: boolean,
	lostFloor: number,
	lostAt: number,
	leaderstats: { Escapes: IntValue, Best: StringValue },
}

local sessions: { [Player]: Session } = {}
local slotOwner: { [number]: Player } = {}
local corridors: { [number]: World.Corridor } = {}
local rng = Random.new()

local monetization: any -- set below (product handlers need the session helpers first)

local function ownsPass(player: Player, key: string): boolean
	return monetization ~= nil and monetization:ownsPass(player, key)
end

local function coinMult(player: Player): number
	return if ownsPass(player, "coins2x") then 2 else 1
end

local function foundCount(data: any): number
	local n = 0
	for id in data.found do
		if Config.ById[id] then
			n += 1
		end
	end
	return n
end

local function title(player: Player, data: any)
	local t = Rules.title(data.escapes)
	player:SetAttribute("Title", t)
	local char = player.Character
	local head = char and char:FindFirstChild("Head") :: BasePart?
	if not head then
		return
	end
	local old = head:FindFirstChild("TitleTag")
	if old then
		old:Destroy()
	end
	local g = Instance.new("BillboardGui")
	g.Name = "TitleTag"
	g.Size = UDim2.fromScale(6, 0.9)
	g.StudsOffsetWorldSpace = Vector3.new(0, 2.4, 0)
	g.MaxDistance = 60
	g.LightInfluence = 0
	g.Parent = head
	local l = Instance.new("TextLabel")
	l.Size = UDim2.fromScale(1, 1)
	l.BackgroundTransparency = 1
	l.Font = Enum.Font.FredokaOne
	l.TextScaled = true
	l.Text = if data.escapes > 0 then `🏅 {t} · {data.escapes}` else t
	l.TextColor3 = if data.escapes >= 10 then Color3.fromRGB(255, 210, 70) else Color3.fromRGB(235, 235, 235)
	l.Parent = g
	local s = Instance.new("UIStroke")
	s.Thickness = 2
	s.Parent = l
end

local function refresh(player: Player)
	local session = sessions[player]
	if not session then
		return
	end
	local data = session.profile.data
	player:SetAttribute("Coins", data.coins)
	player:SetAttribute("Escapes", data.escapes)
	player:SetAttribute("BestTime", data.bestTime)
	player:SetAttribute("Radars", data.radars)
	player:SetAttribute("Revives", data.revives)
	player:SetAttribute("Found", foundCount(data))
	player:SetAttribute("FoundList", table.concat((function()
		local ids = {}
		for id in data.found do
			table.insert(ids, id)
		end
		return ids
	end)(), ","))
	player:SetAttribute("Floor", session.floor)
	player:SetAttribute("InShift", session.inShift)
	player:SetAttribute("Corridor", session.slot)
	player:SetAttribute("RunStart", if session.inShift then Workspace:GetServerTimeNow() - (now() - session.runStart) else 0)
	player:SetAttribute("LuckyReady", ownsPass(player, "lucky") and not session.luckyUsed)
	player:SetAttribute("RadarFree", ownsPass(player, "radar") and not session.radarUsed)
	session.leaderstats.Escapes.Value = data.escapes
	session.leaderstats.Best.Value = if data.bestTime > 0 then Rules.clock(data.bestTime) else "-"
end

-- Shift flow -----------------------------------------------------------------------------

local function rootOf(player: Player): BasePart?
	local char = player.Character
	return char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
end

local function teleport(player: Player, cf: CFrame)
	local char = player.Character
	local root = rootOf(player)
	if char and root then
		root.AssemblyLinearVelocity = Vector3.zero
		char:PivotTo(cf)
	end
end

local function corridorFor(session: Session): World.Corridor
	local c = corridors[session.slot]
	if not c then
		c = World.corridor(session.slot, corridorFolder)
		corridors[session.slot] = c
	end
	session.corridor = c
	return c
end

-- Rebuild the hall for the session's current floor (rolling a new anomaly unless forced).
local function dress(player: Player, session: Session, forced: string?, keep: boolean?)
	local c = corridorFor(session)
	if not keep then
		local id: string?
		if forced then
			id = if forced == "none" then nil else forced
		else
			id = Rules.pick(function()
				return rng:NextNumber()
			end, session.floor, session.calm, session.profile.data.found, session.last)
		end
		session.anomaly = id
		if id then
			session.calm = 0
			session.last = id
		elseif session.floor > 0 then
			session.calm += 1
		end
	end
	local props = World.dress(c, session.floor, player)
	World.apply(c, props, session.anomaly, player, rng:NextInteger(1, 1e9))
	session.radarUsed = false
	session.armed = false
end

local function placeAtStart(player: Player, session: Session)
	local c = corridorFor(session)
	teleport(player, c.origin * CFrame.new(0, 3.2, H.spawnZ) * CFrame.Angles(0, math.pi, 0))
end

local function startShift(player: Player, session: Session)
	if session.busy or session.inShift then
		return
	end
	session.busy = true
	fxRemote:FireClient(player, "enter")
	task.wait(1.1)
	if not player.Parent then
		return
	end
	local data = session.profile.data
	data.runs += 1
	session.floor = 0
	session.calm = 0
	session.luckyUsed = false
	session.lostFloor = 0
	session.inShift = true
	dress(player, session)
	placeAtStart(player, session)
	session.runStart = now()
	refresh(player)
	fxRemote:FireClient(player, "arrive", { floor = 0, first = not data.tutorialDone })
	session.busy = false
end

local function endShift(player: Player, session: Session)
	session.inShift = false
	session.anomaly = nil
	session.floor = 0
	teleport(player, built.spawn)
	refresh(player)
end

local function escape(player: Player, session: Session)
	local data = session.profile.data
	local t = now() - session.runStart
	local coins = Rules.escapeCoins(t, coinMult(player))
	local newBest = data.bestTime == 0 or t < data.bestTime
	data.escapes += 1
	data.coins += coins
	data.tutorialDone = true
	if newBest then
		data.bestTime = math.floor(t * 10) / 10
	end
	fxRemote:FireClient(player, "escape", { time = t, coins = coins, best = data.bestTime, newBest = newBest, escapes = data.escapes })
	task.wait(1.2)
	endShift(player, session)
	title(player, data)
	for other in sessions do
		if other ~= player then
			notify(other, `🚪 {player.DisplayName} clocked out in {Rules.clock(t)}!`, "big")
		end
	end
end

local function choose(player: Player, session: Session, choice: Rules.Choice, caught: boolean?)
	if session.busy or not session.inShift then
		return
	end
	session.busy = true
	local data = session.profile.data
	local was = session.anomaly
	local outcome, nextFloor = Rules.decide(session.floor, was, choice)
	local info: { [string]: any } = { outcome = outcome, floor = nextFloor, from = session.floor, caught = caught }
	if outcome == "wrong" then
		info.hint = if was then Config.ById[was].hint else "Nothing was wrong with that hall."
		info.canRevive = session.floor > 0
		if session.floor > 0 then
			session.lostFloor = session.floor
			session.lostAt = now()
		end
	else
		data.floorsCleared += 1
		local gain = Config.CoinsPerFloor * coinMult(player)
		if was then
			info.anomaly = Config.ById[was].name
			if not data.found[was] then
				data.found[was] = true
				gain += 10 * coinMult(player)
				info.newFind = true
				info.found = foundCount(data)
			end
		end
		data.coins += gain
		info.coins = gain
	end
	fxRemote:FireClient(player, "loop", info)
	if outcome == "escape" then
		escape(player, session)
		session.busy = false
		return
	end
	task.wait(0.5)
	if not player.Parent or not session.inShift then
		session.busy = false
		return
	end
	session.floor = nextFloor
	dress(player, session)
	placeAtStart(player, session)
	refresh(player)
	fxRemote:FireClient(player, "arrive", { floor = nextFloor })
	session.busy = false
end

local function revive(player: Player, session: Session, paid: boolean): boolean
	if not session.inShift or session.lostFloor == 0 or session.busy then
		return false
	end
	if not paid and now() - session.lostAt > Config.ReviveWindow then
		return false
	end
	local data = session.profile.data
	if not paid then
		if ownsPass(player, "lucky") and not session.luckyUsed then
			session.luckyUsed = true
		elseif data.revives > 0 then
			data.revives -= 1
		else
			return false
		end
	end
	session.busy = true
	session.floor = session.lostFloor
	session.lostFloor = 0
	fxRemote:FireClient(player, "blink")
	task.wait(0.35)
	dress(player, session)
	placeAtStart(player, session)
	refresh(player)
	fxRemote:FireClient(player, "arrive", { floor = session.floor, revived = true })
	session.busy = false
	return true
end

local function radar(player: Player, session: Session)
	if not session.inShift or session.busy then
		return
	end
	if session.floor == 0 then
		notify(player, "Floor 0 is always normal. Just walk to the exit.", "info")
		return
	end
	local data = session.profile.data
	if not session.radarUsed then
		if ownsPass(player, "radar") then
			session.radarUsed = true
		elseif data.radars > 0 then
			data.radars -= 1
			session.radarUsed = true
		else
			fxRemote:FireClient(player, "needRadar")
			return
		end
	end
	fxRemote:FireClient(player, "radar", { anomaly = session.anomaly ~= nil })
	refresh(player)
end

-- Monetization ---------------------------------------------------------------------------

local productHandlers: { [number]: (Player, SaveStore.Profile) -> boolean } = {}
local function product(key: string, fn: (Player, any) -> ())
	local id = Config.Products[key]
	if id and id ~= 0 then
		productHandlers[id] = function(player, profile)
			fn(player, profile.data)
			refresh(player)
			return true
		end
	end
end
product("revive", function(player, data)
	local session = sessions[player]
	if session and session.lostFloor > 0 and now() - session.lostAt < 60 then
		task.spawn(revive, player, session, true)
		notify(player, "💫 Second Chance! Back to where you were.", "reward")
	else
		data.revives += 1
		notify(player, "+1 Second Chance", "reward")
	end
end)
product("revive3", function(player, data)
	data.revives += 3
	notify(player, "+3 Second Chances", "reward")
end)
product("radar3", function(player, data)
	data.radars += 3
	notify(player, "+3 Radar pings", "reward")
end)

monetization = Monetization.new({
	store = store,
	passes = Config.Passes,
	products = productHandlers,
	onPassOwned = function(player, key)
		player:SetAttribute("Pass_" .. key, true)
		refresh(player)
	end,
})
monetization:start()

-- Actions --------------------------------------------------------------------------------

actionRemote.OnServerEvent:Connect(function(player: Player, action: any, arg: any)
	local session = sessions[player]
	if not session or typeof(action) ~= "string" then
		return
	end
	local data = session.profile.data
	if action == "radar" then
		radar(player, session)
	elseif action == "revive" then
		if not revive(player, session, false) and session.lostFloor > 0 then
			fxRemote:FireClient(player, "needRevive")
		end
	elseif action == "leave" then
		if session.inShift and not session.busy then
			session.busy = true
			fxRemote:FireClient(player, "blink")
			task.wait(0.35)
			endShift(player, session)
			session.busy = false
		end
	elseif action == "caught" then
		if session.anomaly == "runner" then
			choose(player, session, "forward", true)
		end
	elseif action == "buy" then
		local cost = if arg == "radar" then Config.RadarCost elseif arg == "revive" then Config.ReviveCost else nil
		if not cost then
			return
		end
		if data.coins < cost then
			notify(player, "Not enough coins. Escape to earn more!", "error")
			return
		end
		data.coins -= cost
		if arg == "radar" then
			data.radars += 1
		else
			data.revives += 1
		end
		fxRemote:FireClient(player, "bought", arg)
		refresh(player)
	elseif action == "tutorial" then
		data.tutorialDone = true
	end
end)

-- Loop: elevator pad + corridor door planes -------------------------------------------

RunService.Heartbeat:Connect(function()
	for player, session in sessions do
		if session.busy then
			continue
		end
		local root = rootOf(player)
		if not root then
			continue
		end
		if not session.inShift then
			local d = root.Position - built.elevator
			if math.abs(d.X) < 6 and math.abs(d.Z) < 3.5 and d.Y < 8 then
				task.spawn(startShift, player, session)
			end
			continue
		end
		local c = session.corridor
		if not c then
			continue
		end
		local lp = c.origin:PointToObjectSpace(root.Position)
		if lp.Y < -30 or math.abs(lp.X) > 60 or lp.Z < -30 or lp.Z > 200 then
			placeAtStart(player, session)
			continue
		end
		if lp.Z > H.armZ then
			session.armed = true
		end
		if session.armed and lp.Z < H.backZ and lp.X < H.width then
			task.spawn(function()
				choose(player, session, "back")
			end)
		elseif lp.X > H.forwardX and lp.Z > H.turnZ then
			task.spawn(function()
				choose(player, session, "forward")
			end)
		end
	end
end)

-- Player lifecycle -----------------------------------------------------------------------

local function claimSlot(player: Player): number?
	for i = 1, Config.MaxPlayers do
		if not slotOwner[i] then
			slotOwner[i] = player
			return i
		end
	end
	return nil
end

local function onCharacter(player: Player, char: Model)
	local session = sessions[player]
	if not session then
		return
	end
	task.defer(function()
		title(player, session.profile.data)
		if session.inShift then
			char:WaitForChild("HumanoidRootPart", 5)
			placeAtStart(player, session)
		end
	end)
end

local function onPlayerAdded(player: Player)
	local slot = claimSlot(player)
	if not slot then
		player:Kick("This server is full, please join another one!")
		return
	end
	local profile = store:attach(player, RunService:IsStudio())
	if not profile or not player.Parent then
		slotOwner[slot] = nil
		return
	end
	local data = profile.data

	local folder = Instance.new("Folder")
	folder.Name = "leaderstats"
	local esc = Instance.new("IntValue")
	esc.Name = "Escapes"
	esc.Parent = folder
	local best = Instance.new("StringValue")
	best.Name = "Best"
	best.Parent = folder
	folder.Parent = player

	sessions[player] = {
		profile = profile,
		slot = slot,
		corridor = nil,
		inShift = false,
		busy = false,
		armed = false,
		floor = 0,
		anomaly = nil,
		last = nil,
		calm = 0,
		runStart = now(),
		radarUsed = false,
		luckyUsed = false,
		lostFloor = 0,
		lostAt = 0,
		leaderstats = { Escapes = esc, Best = best },
	}
	refresh(player)
	player.CharacterAdded:Connect(function(char)
		onCharacter(player, char)
	end)
	if player.Character then
		onCharacter(player, player.Character)
	end

	-- daily reward
	local streak, coins = Rules.daily(data.dailyLast, data.dailyStreak, Rules.day(os.time()))
	if streak and coins then
		data.dailyLast = Rules.day(os.time())
		data.dailyStreak = streak
		data.coins += coins
		task.delay(4, function()
			if player.Parent then
				fxRemote:FireClient(player, "daily", { streak = streak, coins = coins })
				refresh(player)
			end
		end)
	end
	-- build the corridor in the background so the first shift starts instantly
	task.defer(function()
		local session = sessions[player]
		if session then
			local c = corridorFor(session)
			World.dress(c, 0, player)
		end
	end)
end

local function onPlayerRemoving(player: Player)
	local session = sessions[player]
	if not session then
		return
	end
	slotOwner[session.slot] = nil
	sessions[player] = nil
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end
Players.PlayerRemoving:Connect(onPlayerRemoving)
store:start(60)

-- Leaderboards ---------------------------------------------------------------------------

local function field(fn: (any) -> number?): (Player) -> number?
	return function(player: Player): number?
		local s = sessions[player]
		return if s then fn(s.profile.data) else nil
	end
end

Leaderboard.start({
	{
		store = "FastestEscape",
		title = "⏱ FASTEST ESCAPE",
		color = Color3.fromRGB(90, 220, 255),
		cframe = built.boardsAt[1],
		value = field(function(d)
			return if d.bestTime > 0 then Rules.encodeTime(d.bestTime) else nil
		end),
		format = function(v)
			return Rules.clock(Rules.decodeTime(v))
		end,
	},
	{
		store = "MostEscapes",
		title = "🚪 MOST ESCAPES",
		color = Color3.fromRGB(255, 200, 70),
		cframe = built.boardsAt[2],
		value = field(function(d)
			return d.escapes
		end),
		format = function(v)
			return tostring(v)
		end,
	},
	{
		store = "AnomaliesFound",
		title = "👁 ANOMALY HUNTERS",
		color = Color3.fromRGB(255, 90, 90),
		cframe = built.boardsAt[3],
		value = field(foundCount),
		format = function(v)
			return `{v}/{#Config.Anomalies}`
		end,
	},
}, built.map)

-- Studio-only test hook: ServerStorage.Debug:Invoke(player, patch).
--   { coins = n }            set coins
--   { start = true }         start a shift right away
--   { floor = n }            jump to floor n (re-rolls the hall)
--   { anomaly = "id"|"none"} re-dress the current hall with this anomaly
--   { choose = "forward"|"back" } make the decision without walking
--   { get = true }           returns floor/anomaly/inShift
if RunService:IsStudio() then
	local debug = Instance.new("BindableFunction")
	debug.Name = "Debug"
	debug.OnInvoke = function(player: Player, patch: { [string]: any }?)
		local session = sessions[player]
		if not session then
			return nil
		end
		local p: { [string]: any } = patch or {}
		if p.coins then
			session.profile.data.coins = p.coins
		end
		if p.start then
			startShift(player, session)
		end
		if p.floor then
			session.floor = p.floor
			dress(player, session)
		end
		if p.anomaly then
			dress(player, session, p.anomaly)
		end
		if p.choose then
			choose(player, session, p.choose)
		end
		refresh(player)
		return { floor = session.floor, anomaly = session.anomaly or "none", inShift = session.inShift }
	end
	debug.Parent = game:GetService("ServerStorage")
end
