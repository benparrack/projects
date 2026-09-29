--!strict
-- Grow a Candy Garden server: plots, planting and growth (keeps growing while you're offline),
-- ripe candy rolls and weather mutations, the server-wide seed shop, selling, row unlocks,
-- daily rewards, purchases and leaderboards.

local HttpService = game:GetService("HttpService")
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

local town = World.build()

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
	return os.time()
end

-- Save data ------------------------------------------------------------------------------

type PlantData = {
	s: string, -- seed id
	t0: number, -- start of the current growth cycle (os.time)
	r: number, -- ripe at (os.time; weather pulls it closer)
	h: number, -- harvests so far
	c: Rules.Candy?, -- the candy rolled when it ripened
}

local TEMPLATE = {
	coins = Config.StartCoins,
	seeds = { gumdrop = 3 },
	basket = {}, -- { Candy }
	rows = Config.StartRows,
	plants = {}, -- tile (string) -> PlantData
	earned = 0,
	best = 0, -- best single candy value sold
	harvested = 0,
	found = {}, -- seed id -> true, "seed:mutation" -> true
	restockId = 0,
	bought = {}, -- seed id -> count bought from the current restock
	dailyLast = -1,
	dailyStreak = 0,
	tutorialDone = false,
	receipts = {},
}

local store = SaveStore.new("CandyGarden_v1", TEMPLATE, {
	onFail = function(player, reason)
		player:Kick(`Your garden couldn't be loaded ({reason}). Please rejoin in a minute.`)
	end,
})

type Session = {
	profile: SaveStore.Profile,
	plot: World.Plot,
	vis: { [number]: string }, -- tile -> last built look ("seed/step/ripe/mut")
	lastAction: number,
	leaderstats: { Coins: StringValue, Earned: StringValue },
}

local sessions: { [Player]: Session } = {}
local plotOwner: { [number]: Player } = {}
local rng = Random.new()
local function roll(): number
	return rng:NextNumber()
end

local monetization: any

local function ownsPass(player: Player, key: string): boolean
	return monetization ~= nil and monetization:ownsPass(player, key)
end

local function sellMult(player: Player): number
	return (if ownsPass(player, "sell2x") then 2 else 1) * (if ownsPass(player, "vip") then 1.1 else 1)
end

local function basketCap(player: Player): number
	return Rules.basketCap(ownsPass(player, "basket"))
end

-- Shop + weather (server-wide) -------------------------------------------------------------

local shop = { id = 1, stock = Rules.rollStock(roll), at = now() + Config.RestockEvery }
local weather: { id: string?, ends: number, next: number } = {
	id = nil,
	ends = 0,
	next = now() + Config.WeatherEvery + rng:NextInteger(-Config.WeatherJitter, Config.WeatherJitter),
}

local function publishShop()
	Workspace:SetAttribute("Stock", HttpService:JSONEncode(shop.stock))
	Workspace:SetAttribute("RestockId", shop.id)
	Workspace:SetAttribute("RestockAt", shop.at)
end

local function restock(announce: boolean)
	shop.id += 1
	shop.stock = Rules.rollStock(roll)
	shop.at = now() + Config.RestockEvery
	publishShop()
	if announce then
		local rare
		for i = #Config.Seeds, 1, -1 do
			local seed = Config.Seeds[i]
			if shop.stock[seed.id] and (seed.order or 0) >= 5 then
				rare = seed
				break
			end
		end
		fxRemote:FireAllClients("restock", { rare = rare and rare.id })
	end
end
publishShop()

local function startWeather(id: string)
	weather.id = id
	weather.ends = now() + Config.WeatherLength
	Workspace:SetAttribute("Weather", id)
	Workspace:SetAttribute("WeatherEnds", weather.ends)
	fxRemote:FireAllClients("weather", { id = id })
end

local function endWeather()
	weather.id = nil
	weather.next = now() + Config.WeatherEvery + rng:NextInteger(-Config.WeatherJitter, Config.WeatherJitter)
	Workspace:SetAttribute("Weather", nil)
	Workspace:SetAttribute("WeatherEnds", nil)
end

-- State to the client ----------------------------------------------------------------------

local function basketValue(player: Player, data: any): number
	local total = 0
	for _, c in data.basket do
		total += Rules.candyValue(c, sellMult(player))
	end
	return total
end

local function refresh(player: Player)
	local session = sessions[player]
	if not session then
		return
	end
	local data = session.profile.data
	if data.restockId ~= shop.id then
		data.restockId = shop.id
		data.bought = {}
	end
	player:SetAttribute("Coins", data.coins)
	player:SetAttribute("Seeds", HttpService:JSONEncode(data.seeds))
	player:SetAttribute("Bought", HttpService:JSONEncode(data.bought))
	player:SetAttribute("BasketCount", #data.basket)
	player:SetAttribute("BasketValue", basketValue(player, data))
	player:SetAttribute("BasketCap", basketCap(player))
	player:SetAttribute("Rows", data.rows)
	player:SetAttribute("Plot", session.plot.index)
	player:SetAttribute("Earned", data.earned)
	player:SetAttribute("Best", data.best)
	player:SetAttribute("Tutorial", data.tutorialDone)
	local found = {}
	for k in data.found do
		table.insert(found, k)
	end
	player:SetAttribute("Found", table.concat(found, ","))
	session.leaderstats.Coins.Value = Rules.short(data.coins)
	session.leaderstats.Earned.Value = Rules.short(data.earned)
end

local function tag(player: Player)
	local char = player.Character
	local head = char and char:FindFirstChild("Head") :: BasePart?
	if not head or not ownsPass(player, "vip") then
		return
	end
	local old = head:FindFirstChild("VipTag")
	if old then
		old:Destroy()
	end
	local g = Instance.new("BillboardGui")
	g.Name = "VipTag"
	g.Size = UDim2.fromScale(3, 0.8)
	g.StudsOffsetWorldSpace = Vector3.new(0, 2.3, 0)
	g.MaxDistance = 60
	g.LightInfluence = 0
	g.Parent = head
	local l = Instance.new("TextLabel")
	l.Size = UDim2.fromScale(1, 1)
	l.BackgroundTransparency = 1
	l.Font = Enum.Font.FredokaOne
	l.TextScaled = true
	l.Text = "⭐ VIP"
	l.TextColor3 = Color3.fromRGB(255, 215, 70)
	l.Parent = g
	local s = Instance.new("UIStroke")
	s.Thickness = 2
	s.Parent = l

	-- rainbow trail
	local root = (char :: Model):FindFirstChild("HumanoidRootPart") :: BasePart?
	if root and not root:FindFirstChild("VipTrail") then
		local a0 = Instance.new("Attachment")
		a0.Name = "VipTrail0"
		a0.Position = Vector3.new(0, 0.6, 0)
		a0.Parent = root
		local a1 = Instance.new("Attachment")
		a1.Name = "VipTrail1"
		a1.Position = Vector3.new(0, -1.2, 0)
		a1.Parent = root
		local tr = Instance.new("Trail")
		tr.Name = "VipTrail"
		tr.Attachment0 = a0
		tr.Attachment1 = a1
		tr.Lifetime = 0.5
		tr.LightEmission = 0.6
		tr.Transparency = NumberSequence.new(0.2, 1)
		tr.Color = ColorSequence.new({
			ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 90, 160)),
			ColorSequenceKeypoint.new(0.25, Color3.fromRGB(255, 220, 80)),
			ColorSequenceKeypoint.new(0.5, Color3.fromRGB(90, 220, 255)),
			ColorSequenceKeypoint.new(0.75, Color3.fromRGB(140, 255, 120)),
			ColorSequenceKeypoint.new(1, Color3.fromRGB(200, 120, 255)),
		})
		tr.Parent = root
	end
end

-- Plants -------------------------------------------------------------------------------------

local GROW_STEPS = 8

local function plantLook(p: PlantData, t: number): (number, boolean, string)
	if p.c then
		return 1, true, `{p.s}/ripe/{p.c.m or ""}`
	end
	if p.h > 0 then
		return 1, false, `{p.s}/regrow`
	end
	local step = math.floor(Rules.progress(p.t0, p.r, t) * GROW_STEPS)
	return 0.15 + 0.85 * step / GROW_STEPS, false, `{p.s}/{step}`
end

local function addHarvestPrompt(m: Model)
	local root = m.PrimaryPart
	if not root then
		return
	end
	local pp = Instance.new("ProximityPrompt")
	pp.Name = "Harvest"
	pp.ActionText = "Harvest"
	pp.ObjectText = ""
	pp.HoldDuration = 0
	pp.MaxActivationDistance = 9
	pp.RequiresLineOfSight = false
	pp.KeyboardKeyCode = Enum.KeyCode.E
	pp.UIOffset = Vector2.new(0, 30)
	pp.Parent = root
end

-- Rebuild a tile's model if its look changed; keeps the timing attributes fresh.
local function showPlant(session: Session, tile: number, p: PlantData?, t: number)
	local plot = session.plot
	if not p then
		if session.vis[tile] then
			session.vis[tile] = nil
			local old = plot.plants:FindFirstChild("P" .. tile)
			if old then
				old:Destroy()
			end
			World.wetTile(plot.tiles[tile], false)
		end
		return
	end
	local scale, ripe, look = plantLook(p, t)
	local m = plot.plants:FindFirstChild("P" .. tile) :: Model?
	if session.vis[tile] ~= look or not m then
		local prevRipe = m ~= nil and m:GetAttribute("Ripe") == true
		m = World.plantModel(plot, tile, p.s, scale, ripe, p.c and p.c.m)
		session.vis[tile] = look
		World.wetTile(plot.tiles[tile], not ripe)
		if ripe then
			addHarvestPrompt(m :: Model)
			if not prevRipe then
				fxRemote:FireAllClients("ripe", { plot = plot.index, tile = tile })
			end
		end
	end
	local model = m :: Model
	model:SetAttribute("Start", p.t0)
	model:SetAttribute("Ready", p.r)
	if p.c then
		model:SetAttribute("Value", Rules.candyValue(p.c))
		model:SetAttribute("Kg", p.c.kg)
		model:SetAttribute("Mut", p.c.m)
	end
end

local function grow(_player: Player, session: Session, t: number, dt: number)
	local data = session.profile.data
	local w = if weather.id then Config.WeatherById[weather.id] else nil
	for key, p: PlantData in data.plants do
		local tile = tonumber(key) :: number
		if not p.c then
			if w and w.growBoost > 0 then
				p.r -= w.growBoost * dt
			end
			if t >= p.r then
				p.c = Rules.rollCandy(p.s, roll, weather.id)
			end
		elseif w and w.mutation and not p.c.m and rng:NextNumber() < Config.WeatherMutationChance / 60 * dt then
			p.c.m = w.mutation
			fxRemote:FireAllClients("mutate", { plot = session.plot.index, tile = tile, m = w.mutation })
		end
		showPlant(session, tile, p, t)
	end
end

local function tileNear(player: Player, session: Session, tile: number): boolean
	local char = player.Character
	local root = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not root then
		return false
	end
	local pos = (session.plot.cf * World.tileLocal(tile)).Position
	return (root.Position - pos).Magnitude <= Config.HarvestRange
end

-- Returns the candy harvested, or nil.
local function harvest(player: Player, session: Session, tile: number, quiet: boolean?): Rules.Candy?
	local data = session.profile.data
	local p: PlantData? = data.plants[tostring(tile)]
	if not p or not p.c then
		return nil
	end
	if #data.basket >= basketCap(player) then
		if not quiet then
			fxRemote:FireClient(player, "full")
		end
		return nil
	end
	local candy = p.c
	table.insert(data.basket, candy)
	data.harvested += 1
	local newSeed = not data.found[p.s]
	data.found[p.s] = true
	if candy.m then
		data.found[`{p.s}:{candy.m}`] = true
	end
	p.h += 1
	p.c = nil
	local t = now()
	local regrow = Rules.regrowTime(p.s, ownsPass(player, "fastgrow"))
	if regrow then
		p.t0 = t
		p.r = t + regrow
	else
		data.plants[tostring(tile)] = nil
	end
	showPlant(session, tile, data.plants[tostring(tile)], t)
	fxRemote:FireClient(player, "harvest", {
		plot = session.plot.index,
		tile = tile,
		s = candy.s,
		kg = candy.kg,
		m = candy.m,
		value = Rules.candyValue(candy, sellMult(player)),
		new = newSeed,
	})
	return candy
end

-- Plots ------------------------------------------------------------------------------------

local function claimPlot(player: Player): World.Plot?
	for i, plot in town.plots do
		if not plotOwner[i] then
			plotOwner[i] = player
			return plot
		end
	end
	return nil
end

local function dressPlot(player: Player, session: Session)
	local plot = session.plot
	plot.sign.Text = `{player.DisplayName}'s Garden`
	World.setRows(plot, session.profile.data.rows, true)
	plot.model:SetAttribute("Owner", player.UserId)
end

local function freePlot(plot: World.Plot)
	plot.plants:ClearAllChildren()
	plot.sign.Text = "Free Garden"
	plot.model:SetAttribute("Owner", nil)
	World.setRows(plot, Config.StartRows, false)
	for _, t in plot.tiles do
		World.wetTile(t, false)
	end
end

local function teleport(player: Player, cf: CFrame)
	local char = player.Character
	local root = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if char and root then
		root.AssemblyLinearVelocity = Vector3.zero
		char:PivotTo(cf)
	end
end

local function nearStand(player: Player, cf: CFrame): boolean
	local char = player.Character
	local root = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	return root ~= nil and (root.Position - cf.Position).Magnitude < 26
end

-- Actions ------------------------------------------------------------------------------------

local function sellAll(player: Player, session: Session)
	local data = session.profile.data
	if #data.basket == 0 then
		notify(player, "Your basket is empty. Harvest some candy first!", "error")
		return
	end
	local mult = sellMult(player)
	local total, best, bestCandy = 0, 0, nil
	for _, c in data.basket do
		local v = Rules.candyValue(c, mult)
		total += v
		if v > best then
			best, bestCandy = v, c
		end
	end
	local count = #data.basket
	data.basket = {}
	data.coins += total
	data.earned += total
	data.best = math.max(data.best, best)
	fxRemote:FireClient(player, "sold", { total = total, count = count, best = bestCandy and Rules.candyName(bestCandy), bestValue = best })
	refresh(player)
end

local function unlockRow(player: Player, session: Session)
	local data = session.profile.data
	local cost = Rules.nextRowCost(data.rows)
	if not cost then
		return
	end
	if data.coins < cost then
		notify(player, `You need 💰{Rules.short(cost)} to unlock the next row.`, "error")
		return
	end
	data.coins -= cost
	data.rows += 1
	World.setRows(session.plot, data.rows, true)
	fxRemote:FireClient(player, "unlock", { rows = data.rows })
	refresh(player)
end

local handlers: { [string]: (Player, Session, any) -> () } = {}

handlers.plant = function(player, session, arg)
	local data = session.profile.data
	if typeof(arg) ~= "table" then
		return
	end
	local tile, seedId = tonumber(arg.tile), arg.seed
	if not tile or tile ~= tile // 1 or tile < 1 or tile > Config.Rows * Config.Cols then
		return
	end
	if typeof(seedId) ~= "string" or not Config.SeedById[seedId] then
		return
	end
	if Rules.tileRow(tile) > data.rows then
		notify(player, "Unlock this row first!", "error")
		return
	end
	if data.plants[tostring(tile)] then
		return
	end
	if (data.seeds[seedId] or 0) <= 0 then
		notify(player, "You're out of those seeds. Visit the Seed Shop!", "error")
		return
	end
	if not tileNear(player, session, tile) then
		return
	end
	data.seeds[seedId] -= 1
	if data.seeds[seedId] <= 0 then
		data.seeds[seedId] = nil
	end
	local t = now()
	data.plants[tostring(tile)] = { s = seedId, t0 = t, r = t + Rules.growTime(seedId, ownsPass(player, "fastgrow")), h = 0 }
	showPlant(session, tile, data.plants[tostring(tile)], t)
	fxRemote:FireClient(player, "planted", { plot = session.plot.index, tile = tile, s = seedId })
	if not data.tutorialDone and data.harvested == 0 then
		player:SetAttribute("TutorialStep", 2)
	end
	refresh(player)
end

handlers.harvest = function(player, session, arg)
	local tile = tonumber(arg)
	if not tile or not tileNear(player, session, tile) then
		return
	end
	if harvest(player, session, tile) then
		refresh(player)
	end
end

handlers.harvestAll = function(player, session)
	local data = session.profile.data
	local got = 0
	local keys = {}
	for key, p in data.plants do
		if p.c then
			table.insert(keys, tonumber(key) :: number)
		end
	end
	table.sort(keys)
	for _, tile in keys do
		if #data.basket >= basketCap(player) then
			fxRemote:FireClient(player, "full")
			break
		end
		if tileNear(player, session, tile) and harvest(player, session, tile, true) then
			got += 1
		end
	end
	if got == 0 and #data.basket < basketCap(player) then
		notify(player, "Nothing ripe nearby yet!", "error")
	end
	refresh(player)
end

handlers.shovel = function(player, session, arg)
	local tile = tonumber(arg)
	local data = session.profile.data
	if not tile or not data.plants[tostring(tile)] then
		return
	end
	data.plants[tostring(tile)] = nil
	showPlant(session, tile, nil, now())
	fxRemote:FireClient(player, "shoveled", { plot = session.plot.index, tile = tile })
end

handlers.buy = function(player, session, arg)
	local data = session.profile.data
	local seed = if typeof(arg) == "string" then Config.SeedById[arg] else nil
	if not seed then
		return
	end
	refresh(player) -- rolls the per-restock counter over if needed
	local left = (shop.stock[seed.id] or 0) - (data.bought[seed.id] or 0)
	if left <= 0 then
		notify(player, `{seed.name} is sold out. Restock in {Rules.clock(shop.at - now())}!`, "error")
		return
	end
	if data.coins < seed.price then
		notify(player, `You need 💰{Rules.short(seed.price)} for {seed.name}.`, "error")
		return
	end
	data.coins -= seed.price
	data.bought[seed.id] = (data.bought[seed.id] or 0) + 1
	data.seeds[seed.id] = (data.seeds[seed.id] or 0) + 1
	fxRemote:FireClient(player, "bought", { s = seed.id })
	refresh(player)
end

handlers.sell = function(player, session)
	if nearStand(player, town.sellStand) then
		sellAll(player, session)
	end
end

handlers.unlock = function(player, session)
	unlockRow(player, session)
end

handlers.teleport = function(player, session, arg)
	if arg == "garden" then
		teleport(player, session.plot.spawn)
	elseif arg == "seeds" then
		teleport(player, town.seedStand)
	elseif arg == "sell" then
		teleport(player, town.sellStand)
	end
end

handlers.tutorialDone = function(player, session)
	session.profile.data.tutorialDone = true
	refresh(player)
end

actionRemote.OnServerEvent:Connect(function(player: Player, action: any, arg: any)
	local session = sessions[player]
	if not session or typeof(action) ~= "string" then
		return
	end
	local fn = handlers[action]
	if not fn then
		return
	end
	-- a light flood guard (per-tile actions are cheap and validated, and drag-planting sends
	-- them quickly, so they're exempt)
	local t = os.clock()
	local perTile = action == "harvest" or action == "plant" or action == "shovel"
	if not perTile and t - session.lastAction < 0.08 then
		return
	end
	session.lastAction = t
	fn(player, session, arg)
end)

town.seedPrompt.Triggered:Connect(function(player)
	fxRemote:FireClient(player, "openShop")
end)
town.sellPrompt.Triggered:Connect(function(player)
	local session = sessions[player]
	if session then
		sellAll(player, session)
	end
end)
for _, plot in town.plots do
	plot.unlockPrompt.Triggered:Connect(function(player)
		local session = sessions[player]
		if session and session.plot == plot then
			unlockRow(player, session)
		end
	end)
end
-- Harvest prompts live on ripe plants; only the owner's work.
game:GetService("ProximityPromptService").PromptTriggered:Connect(function(pp: ProximityPrompt, player: Player)
	if pp.Name ~= "Harvest" then
		return
	end
	local session = sessions[player]
	local m = pp:FindFirstAncestorOfClass("Model")
	if not session or not m or not m:IsDescendantOf(session.plot.plants) then
		return
	end
	local tile = m:GetAttribute("Tile")
	if typeof(tile) == "number" and harvest(player, session, tile) then
		refresh(player)
	end
end)

-- Monetization -------------------------------------------------------------------------------

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

product("restock", function(player)
	restock(true)
	for p in sessions do
		refresh(p)
	end
	fxRemote:FireAllClients("toast", { text = `🌱 {player.DisplayName} restocked the Seed Shop!` })
end)
product("growall", function(player, data)
	local t = now()
	for _, p in data.plants do
		if not p.c then
			p.r = t
		end
	end
	notify(player, "✨ Everything in your garden is ripe!", "reward")
end)
product("weather", function(player)
	startWeather(Rules.pickWeather(roll))
	fxRemote:FireAllClients("toast", { text = `⛅ {player.DisplayName} summoned the weather!` })
end)

monetization = Monetization.new({
	store = store,
	passes = Config.Passes,
	products = productHandlers,
	onPassOwned = function(player, key)
		player:SetAttribute("Pass_" .. key, true)
		if key == "vip" then
			tag(player)
		end
		refresh(player)
	end,
})
monetization:start()

-- Players ------------------------------------------------------------------------------------

local function onPlayerAdded(player: Player)
	local plot = claimPlot(player)
	if not plot then
		player:Kick("This server is full, please join another one!")
		return
	end
	local profile = store:attach(player, RunService:IsStudio())
	if not profile or not player.Parent then
		plotOwner[plot.index] = nil
		return
	end
	local data = profile.data

	local folder = Instance.new("Folder")
	folder.Name = "leaderstats"
	local coins = Instance.new("StringValue")
	coins.Name = "Coins"
	coins.Parent = folder
	local earned = Instance.new("StringValue")
	earned.Name = "Earned"
	earned.Parent = folder
	folder.Parent = player

	local session: Session = {
		profile = profile,
		plot = plot,
		vis = {},
		lastAction = 0,
		leaderstats = { Coins = coins, Earned = earned },
	}
	sessions[player] = session
	-- drop anything on rows that don't exist any more (config changes)
	for key in data.plants do
		local tile = tonumber(key)
		if not tile or Rules.tileRow(tile) > data.rows or not Config.SeedById[data.plants[key].s] then
			data.plants[key] = nil
		end
	end
	dressPlot(player, session)
	grow(player, session, now(), 0)
	refresh(player)

	local function onCharacter(char: Model)
		char:WaitForChild("HumanoidRootPart", 5)
		task.wait()
		teleport(player, plot.spawn)
		tag(player)
	end
	player.CharacterAdded:Connect(onCharacter)
	if player.Character then
		task.spawn(onCharacter, player.Character)
	end

	local streak, reward = Rules.daily(data.dailyLast, data.dailyStreak, Rules.day(now()))
	if streak and reward then
		data.dailyLast = Rules.day(now())
		data.dailyStreak = streak
		data.coins += reward
		task.delay(4, function()
			if player.Parent then
				fxRemote:FireClient(player, "daily", { streak = streak, coins = reward })
				refresh(player)
			end
		end)
	end
end

local function onPlayerRemoving(player: Player)
	local session = sessions[player]
	if not session then
		return
	end
	sessions[player] = nil
	plotOwner[session.plot.index] = nil
	freePlot(session.plot)
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end
Players.PlayerRemoving:Connect(onPlayerRemoving)
store:start(60)

-- Main loop ----------------------------------------------------------------------------------

task.spawn(function()
	local last = os.clock()
	while true do
		task.wait(0.5)
		local c = os.clock()
		local dt = c - last
		last = c
		local t = now()
		if t >= shop.at then
			restock(true)
		end
		if weather.id and t >= weather.ends then
			endWeather()
		elseif not weather.id and t >= weather.next then
			startWeather(Rules.pickWeather(roll))
		end
		for player, session in sessions do
			local ok, err = pcall(function(): any
				grow(player, session, t, dt)
				return nil
			end)
			if not ok then
				warn("[CandyGarden] tick", err)
			end
		end
	end
end)

-- Leaderboards -------------------------------------------------------------------------------

local function field(fn: (any) -> number?): (Player) -> number?
	return function(player: Player): number?
		local s = sessions[player]
		return if s then fn(s.profile.data) else nil
	end
end

Leaderboard.start({
	{
		store = "CandyEarned",
		title = "💰 TOP GARDENERS",
		color = Color3.fromRGB(255, 200, 70),
		cframe = town.boards[1],
		value = field(function(d)
			return math.floor(d.earned)
		end),
		format = Rules.short,
	},
	{
		store = "BestCandy",
		title = "🍭 BEST CANDY",
		color = Color3.fromRGB(255, 110, 190),
		cframe = town.boards[2],
		value = field(function(d)
			return math.floor(d.best)
		end),
		format = function(v)
			return "💰" .. Rules.short(v)
		end,
	},
}, Workspace:WaitForChild("Map"))

-- Studio-only test hook: ServerStorage.Debug:Invoke(player, patch).
--   { coins = n }          set coins
--   { seeds = {id=n} }     give seeds
--   { ripen = true }       every plant ripens now
--   { weather = "id"|"none" }
--   { restock = true }
--   { plantAll = "seedId" } fill every unlocked empty tile
--   { plantMap = {t12="seedId"} }
--   { rows = n }
--   { mutate = "id" }      every ripe candy gets this mutation
--   { get = true }         returns a summary
if RunService:IsStudio() then
	local debug = Instance.new("BindableFunction")
	debug.Name = "Debug"
	debug.OnInvoke = function(player: Player, patch: { [string]: any }?)
		local session = sessions[player]
		if not session then
			return nil
		end
		local data = session.profile.data
		local p: { [string]: any } = patch or {}
		local t = now()
		if p.coins then
			data.coins = p.coins
		end
		if p.seeds then
			for id, n in p.seeds do
				data.seeds[id] = (data.seeds[id] or 0) + n
			end
		end
		if p.rows then
			data.rows = p.rows
			World.setRows(session.plot, data.rows, true)
		end
		if p.plantAll then
			for tile = 1, data.rows * Config.Cols do
				if not data.plants[tostring(tile)] then
					data.plants[tostring(tile)] = { s = p.plantAll, t0 = t, r = t + Rules.growTime(p.plantAll, false), h = 0 }
				end
			end
		end
		if p.plantMap then
			for key, id in p.plantMap do
				local tile = tonumber((string.gsub(tostring(key), "^t", "")))
				if tile then
					data.plants[tostring(tile)] = { s = id, t0 = t, r = t + Rules.growTime(id, false), h = 0 }
				end
			end
		end
		if p.ripen then
			for _, pl in data.plants do
				pl.r = t
			end
		end
		if p.weather == "none" then
			endWeather()
		elseif p.weather then
			startWeather(p.weather)
		end
		if p.restock then
			restock(true)
		end
		if p.mutate then
			for _, pl in data.plants do
				if pl.c then
					pl.c.m = p.mutate
				end
			end
		end
		grow(player, session, t, 0)
		refresh(player)
		local n, ripe = 0, 0
		for _, pl in data.plants do
			n += 1
			if pl.c then
				ripe += 1
			end
		end
		return { coins = data.coins, plants = n, ripe = ripe, basket = #data.basket, weather = weather.id or "none" }
	end
	debug.Parent = game:GetService("ServerStorage")
end
