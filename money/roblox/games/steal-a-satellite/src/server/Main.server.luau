--!strict
-- Steal a Satellite server: bases, the launch belt, buying, income, stealing, the zapper,
-- base locks, rebirths, daily/offline rewards, purchases and leaderboards.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local ServerScriptService = game:GetService("ServerScriptService")
local StarterPack = game:GetService("StarterPack")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Formulas = require(Shared.Formulas)
local Rules = require(Shared.Rules)
local SatModel = require(Shared.SatModel)
local SaveStore = require(ServerScriptService.ServerLib.SaveStore)
local Monetization = require(ServerScriptService.ServerLib.Monetization)
local Leaderboard = require(ServerScriptService.ServerLib.Leaderboard)
local World = require(script.Parent.World)

local built = World.build()
Workspace:SetAttribute("LuckUntil", 0)

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

-- Save data ------------------------------------------------------------------------------

local TEMPLATE = {
	cash = Config.StartCash,
	sats = {}, -- { { t = id, s = slot, p = pending cash } }
	rebirths = 0,
	totalEarned = 0,
	steals = 0,
	found = {}, -- id -> true
	dailyLast = -1,
	dailyStreak = 0,
	lastOnline = 0,
	playSeconds = 0,
	receipts = {},
}

local store = SaveStore.new("StealASatellite_v1", TEMPLATE, {
	onFail = function(player, reason)
		player:Kick(`Your data couldn't be loaded ({reason}). Please rejoin in a minute.`)
	end,
})

type Slot = {
	id: string,
	model: Model,
	pending: number,
	carrier: Player?,
}

type Carry = {
	owner: Player?, -- nil when stolen from space pirates
	pirate: number?, -- base index of the pirate base it came from
	slot: number,
	id: string,
	model: Model,
	started: number,
}

type Session = {
	profile: SaveStore.Profile,
	base: World.Base,
	slots: { [number]: Slot },
	carry: Carry?,
	lockedUntil: number,
	shieldUntil: number,
	stunnedUntil: number,
	immuneUntil: number,
	zapReady: number,
	lastAction: number,
	leaderstats: { Cash: StringValue, Steals: IntValue },
}

local sessions: { [Player]: Session } = {}
local baseOwner: { [number]: Player } = {}

local function now(): number
	return Workspace:GetServerTimeNow()
end

local function incomeState(player: Player, data: any): Formulas.IncomeState
	return {
		rebirths = data.rebirths,
		x2Cash = player:GetAttribute("Pass_x2Cash") == true,
		vip = player:GetAttribute("Pass_vip") == true,
	}
end

local function slotCount(player: Player, data: any): number
	return Formulas.slotCount(data.rebirths, player:GetAttribute("Pass_biggerBase") == true)
end

local function slotIds(session: Session): { string }
	local ids = {}
	for _, slot in session.slots do
		table.insert(ids, slot.id)
	end
	return ids
end

local function incomePerSecond(player: Player, session: Session): number
	return Formulas.totalIncome(slotIds(session), incomeState(player, session.profile.data))
end

-- Keeps profile.data.sats in step with the live slots, so saves never miss anything.
local function syncSave(session: Session)
	local out = {}
	for s, slot in session.slots do
		table.insert(out, { t = slot.id, s = s, p = math.floor(slot.pending) })
	end
	session.profile.data.sats = out
end

local refresh: (player: Player) -> ()

-- Satellite models -------------------------------------------------------------------------------

local function rarityColor(id: string): Color3
	return SatModel.rgb(Config.Rarities[Config.ById[id].tier].color)
end

-- Name / rarity / price or income tag above a satellite.
local function infoTag(root: BasePart, id: string, line3: string, height: number)
	local sat = Config.ById[id]
	local rarity = Config.Rarities[sat.tier]
	local gui = Instance.new("BillboardGui")
	gui.Name = "Info"
	-- Sized in studs (not pixels) so neighbouring pads' tags never overlap at any zoom.
	gui.Size = UDim2.fromScale(7.6, 2.9)
	gui.StudsOffsetWorldSpace = Vector3.new(0, height, 0)
	gui.LightInfluence = 0
	gui.MaxDistance = 110
	gui.AlwaysOnTop = false
	gui.Parent = root
	local lines = {
		{ text = sat.name, color = Color3.new(1, 1, 1), y = 0, h = 0.4 },
		{ text = rarity.name:upper(), color = if sat.tier == 8 then Color3.fromRGB(230, 230, 255) else rarityColor(id), y = 0.38, h = 0.28 },
		{ text = line3, color = Color3.fromRGB(120, 255, 140), y = 0.66, h = 0.34 },
	}
	for i, l in lines do
		local label = Instance.new("TextLabel")
		label.Name = "Line" .. i
		label.BackgroundTransparency = 1
		label.Position = UDim2.fromScale(0, l.y)
		label.Size = UDim2.fromScale(1, l.h)
		label.Font = Enum.Font.FredokaOne
		label.TextScaled = true
		label.TextColor3 = l.color
		label.Text = l.text
		label.Parent = gui
		local stroke = Instance.new("UIStroke")
		stroke.Thickness = 2
		stroke.Color = if sat.tier == 8 and i == 2 then Color3.fromRGB(120, 60, 255) else Color3.new(0, 0, 0)
		stroke.Parent = label
	end
end

local function prompt(root: BasePart, name: string, action: string, object: string, hold: number): ProximityPrompt
	local p = Instance.new("ProximityPrompt")
	p.Name = name
	p.ActionText = action
	p.ObjectText = object
	p.HoldDuration = hold
	p.MaxActivationDistance = 11
	p.RequiresLineOfSight = false
	p.KeyboardKeyCode = if name == "Sell" then Enum.KeyCode.F else Enum.KeyCode.E
	p.Parent = root
	return p
end

local onStealPrompt: (thief: Player, owner: Player, slotIndex: number) -> ()
local onSellPrompt: (player: Player, slotIndex: number) -> ()
local onPirateSteal: (thief: Player, baseIndex: number, slotIndex: number) -> ()

-- Space pirates squat in empty bases so there's always something to steal, even in a quiet server.
type PirateLoot = { id: string, model: Model, carrier: Player? }
type Pirates = {
	base: World.Base,
	slots: { [number]: PirateLoot },
	lockedUntil: number,
	nextLock: number,
	refillAt: number,
	crew: Model,
}
local pirates: { [number]: Pirates } = {}

local placePirateModel: (crew: Pirates, slotIndex: number, id: string) -> Model

local function placeModel(owner: Player, session: Session, slotIndex: number, id: string): Model
	local model = SatModel.build(id, session.base.pads[slotIndex])
	model:SetAttribute("OwnerId", owner.UserId)
	model:SetAttribute("Slot", slotIndex)
	local root = model.PrimaryPart :: BasePart
	local income = Formulas.satIncome(id, incomeState(owner, session.profile.data))
	infoTag(root, id, `+{Formulas.cash(income)}/s`, 5 * Config.ById[id].scale)
	local steal = prompt(root, "Steal", "Steal", Config.ById[id].name, Config.StealHold)
	steal.Triggered:Connect(function(thief)
		onStealPrompt(thief, owner, slotIndex)
	end)
	local sell = prompt(root, "Sell", `Sell {Formulas.cash(Formulas.sellPrice(id))}`, Config.ById[id].name, 0.6)
	sell.Triggered:Connect(function(player)
		onSellPrompt(player, slotIndex)
	end)
	model.Parent = session.base.model
	return model
end

function placePirateModel(crew: Pirates, slotIndex: number, id: string): Model
	local model = SatModel.build(id, crew.base.pads[slotIndex])
	model:SetAttribute("OwnerId", -1)
	model:SetAttribute("Slot", slotIndex)
	local root = model.PrimaryPart :: BasePart
	infoTag(root, id, `+{Formulas.cash(Config.ById[id].income)}/s`, 5 * Config.ById[id].scale)
	local steal = prompt(root, "Steal", "Steal", Config.ById[id].name, Config.StealHold)
	steal.Triggered:Connect(function(thief)
		onPirateSteal(thief, crew.base.index, slotIndex)
	end)
	model.Parent = crew.base.model
	return model
end

local function setSlot(owner: Player, session: Session, slotIndex: number, id: string, pending: number?)
	local old = session.slots[slotIndex]
	if old then
		old.model:Destroy()
	end
	session.slots[slotIndex] = { id = id, model = placeModel(owner, session, slotIndex, id), pending = pending or 0, carrier = nil }
	session.profile.data.found[id] = true
	syncSave(session)
end

local function clearSlot(session: Session, slotIndex: number)
	local slot = session.slots[slotIndex]
	if slot then
		slot.model:Destroy()
		session.slots[slotIndex] = nil
		session.base.collectLabels[slotIndex].Text = ""
	end
	syncSave(session)
end

-- Refreshes income tags after multipliers change (rebirth, passes).
local function retag(player: Player, session: Session)
	for _, slot in session.slots do
		local info = slot.model.PrimaryPart and slot.model.PrimaryPart:FindFirstChild("Info")
		local line = info and info:FindFirstChild("Line3") :: TextLabel?
		if line then
			line.Text = `+{Formulas.cash(Formulas.satIncome(slot.id, incomeState(player, session.profile.data)))}/s`
		end
	end
end

-- Pads beyond your slot count are dimmed.
local function setShield(base: World.Base, on: boolean)
	base.shield.Transparency = if on then 0.8 else 1
	for _, bar in base.shield:GetChildren() do
		(bar :: BasePart).Transparency = if on then 0.15 else 1
	end
end

local function paintPads(player: Player, session: Session?)
	local base = if session then session.base else nil
	if not base then
		return
	end
	local count = if session then slotCount(player, session.profile.data) else 0
	for i, pad in base.padParts do
		local open = i <= count
		pad.Color = if open then Color3.fromRGB(70, 72, 92) else Color3.fromRGB(35, 35, 45)
		local ring = pad:FindFirstChild("PadRing") :: BasePart?
		if ring then
			ring.Transparency = if open then 0 else 0.85
		end
		base.collect[i].Transparency = if open then 0 else 1
	end
end

-- Characters ---------------------------------------------------------------------------------

local function rootOf(player: Player): BasePart?
	local character = player.Character
	return character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
end

local function humanoidOf(player: Player): Humanoid?
	local character = player.Character
	return character and character:FindFirstChildOfClass("Humanoid")
end

local function insideBase(base: World.Base, pos: Vector3, margin: number?): boolean
	local p = base.cframe:PointToObjectSpace(pos)
	local m = margin or 0
	return math.abs(p.X) < World.BaseWidth / 2 + m and math.abs(p.Z) < World.BaseDepth / 2 + m and p.Y < 40
end

local function walkSpeed(player: Player, session: Session): number
	if now() < session.stunnedUntil then
		return 0
	elseif session.carry then
		return if player:GetAttribute("Pass_speedyThief") then Config.FastCarrySpeed else Config.CarrySpeed
	end
	return Config.WalkSpeed
end

local function applySpeed(player: Player)
	local session = sessions[player]
	local humanoid = humanoidOf(player)
	if session and humanoid then
		humanoid.WalkSpeed = walkSpeed(player, session)
		humanoid.JumpPower = if now() < session.stunnedUntil then 0 else 55
	end
end

-- Stealing -----------------------------------------------------------------------------------------

local function isLocked(session: Session): boolean
	local t = now()
	return t < session.lockedUntil or t < session.shieldUntil
end

-- Puts a carried satellite back on its owner's pad (or deletes it if the owner is gone).
local function dropCarry(thief: Player, reason: string?)
	local session = sessions[thief]
	local carry = session and session.carry
	if not session or not carry then
		return
	end
	session.carry = nil
	thief:SetAttribute("Carrying", "")
	applySpeed(thief)
	local owner = carry.owner
	local ownerSession = owner and sessions[owner]
	local slot = ownerSession and ownerSession.slots[carry.slot]
	local crew = carry.pirate and pirates[carry.pirate]
	local loot = crew and crew.slots[carry.slot]
	if owner and ownerSession and slot and slot.carrier == thief then
		slot.carrier = nil
		-- Rebuild the model on its pad (the carried one was welded to the thief).
		carry.model:Destroy()
		slot.model = placeModel(owner, ownerSession, carry.slot, slot.id)
		if reason then
			notify(owner, `🛡 Your {Config.ById[slot.id].name} is back home!`, "good")
		end
	elseif crew and loot and loot.carrier == thief then
		loot.carrier = nil
		carry.model:Destroy()
		loot.model = placePirateModel(crew, carry.slot, loot.id)
	else
		carry.model:Destroy()
	end
	if reason then
		notify(thief, reason, "error")
	end
end

local attachCarry: (thief: Player, session: Session, root: BasePart, id: string, from: { owner: Player?, pirate: number?, slot: number }) -> Model

function onStealPrompt(thief: Player, owner: Player, slotIndex: number)
	local session, ownerSession = sessions[thief], sessions[owner]
	if not session or not ownerSession then
		return
	end
	local slot = ownerSession.slots[slotIndex]
	local root = rootOf(thief)
	if not slot or not root then
		return
	end
	local blocker = Rules.stealBlocker({
		isOwner = thief == owner,
		locked = isLocked(ownerSession),
		alreadyCarrying = session.carry ~= nil,
		targetCarried = slot.carrier ~= nil,
		thiefHasRoom = Rules.freeSlot(session.slots, slotCount(thief, session.profile.data)) ~= nil,
		stunned = now() < session.stunnedUntil,
	})
	if blocker then
		if thief ~= owner then
			notify(thief, blocker, "error")
		end
		return
	end
	-- Swap the pad model for a copy welded above the thief's head.
	slot.carrier = thief
	slot.model:Destroy()
	slot.model = attachCarry(thief, session, root, slot.id, { owner = owner, slot = slotIndex })
	local name = Config.ById[slot.id].name
	notify(thief, `Run it back to your base! ⚡ Watch out for zaps`, "info")
	notify(owner, `🚨 {thief.DisplayName} is stealing your {name}! Zap them!`, "alarm")
	fxRemote:FireClient(owner, "alarm", thief.UserId)
end

-- Builds the carried copy of `id` welded above the thief's head and starts the carry.
function attachCarry(thief: Player, session: Session, root: BasePart, id: string, from: { owner: Player?, pirate: number?, slot: number }): Model
	local model = SatModel.build(id, root.CFrame * CFrame.new(0, 5.5, 0))
	for _, d in model:GetDescendants() do
		if d:IsA("BasePart") then
			d.Massless = true
			d.CanCollide = false
		end
	end
	local carriedRoot = model.PrimaryPart :: BasePart
	carriedRoot.Anchored = false
	local weld = Instance.new("WeldConstraint")
	weld.Part0 = root
	weld.Part1 = carriedRoot
	weld.Parent = carriedRoot
	infoTag(carriedRoot, id, "STOLEN!", 4)
	model.Parent = thief.Character
	session.carry = { owner = from.owner, pirate = from.pirate, slot = from.slot, id = id, model = model, started = now() }
	thief:SetAttribute("Carrying", id)
	applySpeed(thief)
	return model
end

local function completeSteal(thief: Player, session: Session)
	local carry = session.carry
	if not carry then
		return
	end
	local owner = carry.owner
	local ownerSession = owner and sessions[owner]
	local slot = ownerSession and ownerSession.slots[carry.slot]
	local crew = carry.pirate and pirates[carry.pirate]
	local loot = crew and crew.slots[carry.slot]
	local free = Rules.freeSlot(session.slots, slotCount(thief, session.profile.data))
	local valid = if crew then loot ~= nil and loot.carrier == thief else slot ~= nil and slot.carrier == thief
	if not valid or not free then
		dropCarry(thief, if not free then "Your base is full!" else nil)
		return
	end
	session.carry = nil
	thief:SetAttribute("Carrying", "")
	carry.model:Destroy()
	if crew then
		crew.slots[carry.slot] = nil
		crew.refillAt = math.min(crew.refillAt, now() + Config.PirateRefill)
	elseif ownerSession then
		ownerSession.slots[carry.slot] = nil
		ownerSession.base.collectLabels[carry.slot].Text = ""
		syncSave(ownerSession)
	end
	setSlot(thief, session, free, carry.id)
	session.profile.data.steals += 1
	applySpeed(thief)
	local name = Config.ById[carry.id].name
	notify(thief, `You stole {name}! 😎`, if Config.ById[carry.id].tier >= 4 then "big" else "win")
	if owner then
		notify(owner, `{thief.DisplayName} stole your {name}! 😭 Steal it back!`, "alarm")
		refresh(owner)
	end
	fxRemote:FireAllClients("steal", session.base.pads[free].Position, carry.id)
	refresh(thief)
end

function onSellPrompt(player: Player, slotIndex: number)
	local session = sessions[player]
	local slot = session and session.slots[slotIndex]
	if not session or not slot or slot.carrier then
		return
	end
	local price = Formulas.sellPrice(slot.id)
	local data = session.profile.data
	data.cash += price + slot.pending
	data.totalEarned += slot.pending
	notify(player, `Sold {Config.ById[slot.id].name} for {Formulas.cash(price)}`, "reward")
	clearSlot(session, slotIndex)
	refresh(player)
end

-- The zapper ---------------------------------------------------------------------------------------

local zapperTemplate = Instance.new("Tool")
zapperTemplate.Name = "Zapper"
zapperTemplate.ToolTip = "Zap thieves to make them drop your satellite"
zapperTemplate.CanBeDropped = false
zapperTemplate.GripPos = Vector3.new(0, -0.2, -0.9)
do
	local handle = Instance.new("Part")
	handle.Name = "Handle"
	handle.Size = Vector3.new(0.5, 0.5, 2.6)
	handle.Material = Enum.Material.Metal
	handle.Color = Color3.fromRGB(60, 60, 80)
	handle.CanCollide = false
	handle.Massless = true
	handle.Parent = zapperTemplate
	local tip = Instance.new("Part")
	tip.Name = "Tip"
	tip.Shape = Enum.PartType.Ball
	tip.Size = Vector3.new(0.8, 0.8, 0.8)
	tip.Material = Enum.Material.Neon
	tip.Color = Color3.fromRGB(120, 220, 255)
	tip.CanCollide = false
	tip.Massless = true
	tip.CFrame = handle.CFrame * CFrame.new(0, 0, -1.5)
	tip.Parent = zapperTemplate
	local weld = Instance.new("WeldConstraint")
	weld.Part0 = handle
	weld.Part1 = tip
	weld.Parent = tip
	local light = Instance.new("PointLight")
	light.Color = tip.Color
	light.Range = 6
	light.Parent = tip
end

local function zapBolt(from: Vector3, to: Vector3)
	-- A jagged neon bolt made of a few segments, visible to everyone for a moment.
	local folder = Instance.new("Folder")
	folder.Name = "Bolt"
	local points = { from }
	for i = 1, 4 do
		local t = i / 5
		table.insert(points, from:Lerp(to, t) + Vector3.new(math.random() - 0.5, math.random() - 0.5, math.random() - 0.5) * 2)
	end
	table.insert(points, to)
	for i = 1, #points - 1 do
		local a, b = points[i], points[i + 1]
		local seg = Instance.new("Part")
		seg.Anchored = true
		seg.CanCollide = false
		seg.CanQuery = false
		seg.CanTouch = false
		seg.Material = Enum.Material.Neon
		seg.Color = Color3.fromRGB(150, 230, 255)
		seg.Size = Vector3.new(0.3, 0.3, (b - a).Magnitude)
		seg.CFrame = CFrame.lookAt((a + b) / 2, b)
		seg.Parent = folder
	end
	folder.Parent = Workspace
	task.delay(0.18, function()
		folder:Destroy()
	end)
end

local function zap(player: Player)
	local session = sessions[player]
	local root = rootOf(player)
	if not session or not root or now() < session.zapReady or now() < session.stunnedUntil then
		return
	end
	session.zapReady = now() + Config.ZapCooldown
	-- Nearest other player in range, preferring whoever is in front.
	local best: Player? = nil
	local bestScore = math.huge
	for other, otherSession in sessions do
		local otherRoot = rootOf(other)
		if other ~= player and otherRoot then
			local offset = otherRoot.Position - root.Position
			local dist = offset.Magnitude
			if dist <= Config.ZapRange and now() >= otherSession.immuneUntil then
				local facing = root.CFrame.LookVector:Dot(offset.Unit)
				local score = dist - facing * 4
				if score < bestScore then
					best, bestScore = other, score
				end
			end
		end
	end
	local tipPos = root.Position + root.CFrame.LookVector * 3 + Vector3.new(0, 1, 0)
	fxRemote:FireAllClients("zap", tipPos)
	if not best then
		zapBolt(tipPos, tipPos + root.CFrame.LookVector * 6)
		return
	end
	local victim = best
	local victimSession = sessions[victim]
	local victimRoot = rootOf(victim) :: BasePart
	zapBolt(tipPos, victimRoot.Position)
	victimSession.stunnedUntil = now() + Config.StunSeconds
	victimSession.immuneUntil = now() + Config.StunImmunity
	local wasCarrying = victimSession.carry ~= nil
	if wasCarrying then
		local carry = victimSession.carry :: Carry
		local owner = carry.owner
		dropCarry(victim, `⚡ {player.DisplayName} zapped you! You dropped the satellite.`)
		if owner ~= player then
			notify(player, "⚡ Zapped a thief! The satellite went home.", "good")
		else
			notify(player, "⚡ Got it back!", "good")
		end
	else
		notify(victim, `⚡ Zapped by {player.DisplayName}!`, "error")
	end
	applySpeed(victim)
	local push = (victimRoot.Position - root.Position) * Vector3.new(1, 0, 1)
	fxRemote:FireClient(victim, "stunned", if push.Magnitude > 0 then push.Unit else Vector3.zero)
	task.delay(Config.StunSeconds + 0.05, function()
		if victim.Parent then
			applySpeed(victim)
		end
	end)
end

zapperTemplate.Parent = StarterPack

-- Refresh ------------------------------------------------------------------------------------------

function refresh(player: Player)
	local session = sessions[player]
	if not session then
		return
	end
	local data = session.profile.data
	player:SetAttribute("Cash", data.cash)
	player:SetAttribute("Income", incomePerSecond(player, session))
	player:SetAttribute("Rebirths", data.rebirths)
	player:SetAttribute("RebirthCost", Formulas.rebirthCost(data.rebirths))
	player:SetAttribute("Steals", data.steals)
	player:SetAttribute("Slots", slotCount(player, data))
	player:SetAttribute("Used", Rules.usedSlots(session.slots))
	player:SetAttribute("BaseIndex", session.base.index)
	player:SetAttribute("LockedUntil", math.max(session.lockedUntil, session.shieldUntil))
	local found = {}
	for id in data.found do
		table.insert(found, id)
	end
	player:SetAttribute("Found", table.concat(found, ","))
	local _, dailyDue = Formulas.advanceStreak(data.dailyLast, data.dailyStreak, Formulas.dayIndex(os.time()))
	player:SetAttribute("DailyReady", dailyDue)
	player:SetAttribute("DailyStreak", data.dailyStreak)
	session.leaderstats.Cash.Value = Formulas.cash(data.cash)
	session.leaderstats.Steals.Value = data.steals
end

-- Monetization ---------------------------------------------------------------------------------

local passIds: { [string]: number } = {}
for key, pass in Config.GamePasses do
	passIds[key] = pass.id
end

local productHandlers = {}
for _, product in Config.Products do
	if product.id ~= 0 then
		productHandlers[product.id] = function(player: Player, profile: SaveStore.Profile): boolean
			local session = sessions[player]
			local data = profile.data
			if product.kind == "incomeMinutes" then
				local income = if session then incomePerSecond(player, session) else 0
				local amount = math.max(income * 60 * product.amount, 500 * product.amount)
				data.cash += amount
				notify(player, `+{Formulas.cash(amount)}!`, "reward")
			elseif product.kind == "shield" then
				if not session then
					return false
				end
				session.shieldUntil = math.max(now(), session.shieldUntil) + product.amount
				notify(player, "🛡 Force Shield up! Nobody can get in.", "reward")
			elseif product.kind == "luck" then
				local luckUntil = math.max(now(), Workspace:GetAttribute("LuckUntil") or 0) + product.amount
				Workspace:SetAttribute("LuckUntil", luckUntil)
				for other in sessions do
					notify(other, `🍀 {player.DisplayName} turned on SERVER LUCK! Rare satellites x2`, "big")
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
		local session = sessions[player]
		if session then
			if key == "vip" then
				for _, d in session.base.model:GetChildren() do
					if d.Name == "Trim" or d.Name == "SignTrim" then
						(d :: BasePart).Color = Color3.fromRGB(255, 200, 50)
					end
				end
			end
			paintPads(player, session)
			retag(player, session)
			applySpeed(player)
			refresh(player)
		end
	end,
})
monetization:start()

-- Player lifecycle ---------------------------------------------------------------------------------

-- Space pirates ------------------------------------------------------------------------------------

local PIRATE_TRIM = Color3.fromRGB(255, 60, 40)

local function buildCrew(base: World.Base): Model
	-- A little pirate robot standing guard by the sign: boxy body, dome head, red eye, eyepatch.
	local crew = Instance.new("Model")
	crew.Name = "PirateCrew"
	local origin = base.cframe * CFrame.new(-World.BaseWidth / 2 + 9, 0, -World.BaseDepth / 2 + 7) * CFrame.Angles(0, math.pi, 0)
	local function add(props: { [string]: any }): BasePart
		local p = Instance.new("Part")
		p.Anchored = true
		p.CanCollide = false
		p.CanQuery = false
		p.CanTouch = false
		p.TopSurface = Enum.SurfaceType.Smooth
		p.BottomSurface = Enum.SurfaceType.Smooth
		for k, v in props do
			(p :: any)[k] = v
		end
		p.Parent = crew
		return p
	end
	add({ Name = "Legs", Size = Vector3.new(2.4, 3, 1.6), CFrame = origin * CFrame.new(0, 3.5, 0), Material = Enum.Material.Metal, Color = Color3.fromRGB(50, 50, 60) })
	add({ Name = "Body", Size = Vector3.new(4, 4, 2.6), CFrame = origin * CFrame.new(0, 7, 0), Material = Enum.Material.Metal, Color = Color3.fromRGB(90, 30, 40) })
	add({ Name = "Belt", Size = Vector3.new(4.1, 0.5, 2.7), CFrame = origin * CFrame.new(0, 5.4, 0), Material = Enum.Material.Neon, Color = PIRATE_TRIM })
	add({ Name = "Head", Shape = Enum.PartType.Ball, Size = Vector3.new(3.2, 3.2, 3.2), CFrame = origin * CFrame.new(0, 10.4, 0), Material = Enum.Material.Metal, Color = Color3.fromRGB(170, 170, 185) })
	add({ Name = "Eye", Shape = Enum.PartType.Ball, Size = Vector3.new(0.9, 0.9, 0.9), CFrame = origin * CFrame.new(0.6, 10.7, -1.35), Material = Enum.Material.Neon, Color = Color3.fromRGB(255, 40, 40) })
	add({ Name = "Patch", Size = Vector3.new(1, 0.9, 0.3), CFrame = origin * CFrame.new(-0.7, 10.7, -1.45), Material = Enum.Material.SmoothPlastic, Color = Color3.fromRGB(15, 15, 20) })
	add({ Name = "Strap", Size = Vector3.new(3.3, 0.25, 3.3), CFrame = origin * CFrame.new(0, 10.8, 0) * CFrame.Angles(0, 0, math.rad(12)), Material = Enum.Material.SmoothPlastic, Color = Color3.fromRGB(15, 15, 20) })
	add({ Name = "Hat", Size = Vector3.new(4.2, 1, 2.2), CFrame = origin * CFrame.new(0, 12.3, 0), Material = Enum.Material.SmoothPlastic, Color = Color3.fromRGB(20, 20, 28) })
	add({ Name = "HatBand", Size = Vector3.new(4.3, 0.3, 2.3), CFrame = origin * CFrame.new(0, 11.9, 0), Material = Enum.Material.Neon, Color = Color3.fromRGB(255, 200, 60) })
	for _, x in { -2.6, 2.6 } do
		add({ Name = "Arm", Size = Vector3.new(1, 3.6, 1), CFrame = origin * CFrame.new(x, 7, 0) * CFrame.Angles(0, 0, math.rad(x > 0 and -10 or 10)), Material = Enum.Material.Metal, Color = Color3.fromRGB(170, 170, 185) })
	end
	local antenna = add({ Name = "Antenna", Size = Vector3.new(0.2, 2, 0.2), CFrame = origin * CFrame.new(0.9, 13.5, 0.3), Material = Enum.Material.Metal, Color = Color3.fromRGB(120, 120, 130) })
	add({ Name = "Blinker", Shape = Enum.PartType.Ball, Size = Vector3.new(0.6, 0.6, 0.6), CFrame = antenna.CFrame * CFrame.new(0, 1.1, 0), Material = Enum.Material.Neon, Color = Color3.fromRGB(255, 60, 60) })
	local tag = World.billboard(crew:FindFirstChild("Head") :: BasePart, UDim2.fromScale(8, 1.6), Vector3.new(0, 4.4, 0), "☠ Captain Bolts", Color3.fromRGB(255, 200, 90), 90)
	tag.Name = "CrewTag"
	crew.Parent = base.model
	return crew
end

local function paintBase(base: World.Base, color: Color3)
	for _, d in base.model:GetChildren() do
		if d.Name == "Trim" or d.Name == "SignTrim" then
			(d :: BasePart).Color = color
		end
	end
end

-- Pirate loot tops out one tier above the best satellite anyone in the server owns.
local function pirateMaxTier(): number
	local best = 1
	for _, session in sessions do
		for _, slot in session.slots do
			best = math.max(best, Config.ById[slot.id].tier)
		end
	end
	return math.clamp(best + 1, 3, 7)
end

local function addPirateLoot(crew: Pirates, treasure: boolean?)
	local free = {}
	for i = 1, Config.BaseSlots do
		if not crew.slots[i] then
			table.insert(free, i)
		end
	end
	if #free == 0 then
		return
	end
	local s = free[math.random(#free)]
	-- A treasure roll is forced to the top of the dice, i.e. the capped tier.
	local id = Formulas.pirateRoll(if treasure then 0.999999 else math.random(), math.random(), pirateMaxTier())
	crew.slots[s] = { id = id, model = placePirateModel(crew, s, id), carrier = nil }
end

local function spawnPirates(index: number)
	local base = built.bases[index]
	local crew: Pirates = { base = base, slots = {}, lockedUntil = 0, nextLock = now() + Config.PirateOpen, refillAt = now() + Config.PirateRefill, crew = buildCrew(base) }
	pirates[index] = crew
	base.ownerLabel.Text = "☠ SPACE PIRATES ☠"
	base.insideLabel.Text = "☠ PIRATE LOOT ☠"
	paintBase(base, PIRATE_TRIM)
	for i, pad in base.padParts do
		pad.Color = Color3.fromRGB(70, 72, 92)
		local ring = pad:FindFirstChild("PadRing") :: BasePart?
		if ring then
			ring.Transparency = if i <= Config.BaseSlots then 0 else 0.85
		end
		base.collect[i].Transparency = 1
	end
	for i = 1, Config.PirateLoot do
		addPirateLoot(crew, i == 1)
	end
end

local function evictPirates(index: number)
	local crew = pirates[index]
	if not crew then
		return
	end
	pirates[index] = nil
	for _, loot in crew.slots do
		local thief = loot.carrier
		local thiefSession = thief and sessions[thief]
		if thief and thiefSession and thiefSession.carry and thiefSession.carry.pirate == index then
			thiefSession.carry.model:Destroy()
			thiefSession.carry = nil
			thief:SetAttribute("Carrying", "")
			applySpeed(thief)
			notify(thief, "The pirates warped away with their loot!", "error")
		end
		loot.model:Destroy()
	end
	crew.crew:Destroy()
	local base = crew.base
	base.ownerLabel.Text = "EMPTY BASE"
	base.insideLabel.Text = ""
	setShield(base, false)
	base.lockLabel.Text = "🔓 LOCK BASE"
	base.lockLabel.TextColor3 = Color3.fromRGB(255, 120, 120)
	base.lockPlate.Color = Color3.fromRGB(255, 70, 70)
	paintBase(base, base.color)
	for i in base.padParts do
		base.collect[i].Transparency = 0
	end
end

function onPirateSteal(thief: Player, index: number, slotIndex: number)
	local session = sessions[thief]
	local crew = pirates[index]
	local loot = crew and crew.slots[slotIndex]
	local root = rootOf(thief)
	if not session or not crew or not loot or not root then
		return
	end
	local blocker = Rules.stealBlocker({
		isOwner = false,
		locked = now() < crew.lockedUntil,
		alreadyCarrying = session.carry ~= nil,
		targetCarried = loot.carrier ~= nil,
		thiefHasRoom = Rules.freeSlot(session.slots, slotCount(thief, session.profile.data)) ~= nil,
		stunned = now() < session.stunnedUntil,
	})
	if blocker then
		notify(thief, blocker, "error")
		return
	end
	loot.carrier = thief
	loot.model:Destroy()
	loot.model = attachCarry(thief, session, root, loot.id, { pirate = index, slot = slotIndex })
	notify(thief, "☠ Yoink! Run it back to your base before the pirates lock up!", "info")
end

-- Heartbeat: shove players out of locked pirate bases.
RunService.Heartbeat:Connect(function()
	local t = now()
	for _, crew in pirates do
		if t < crew.lockedUntil then
			for player in sessions do
				local root = rootOf(player)
				if root and insideBase(crew.base, root.Position, 1) then
					local out = crew.base.cframe * CFrame.new(0, 4, -World.BaseDepth / 2 - 8)
					local character = player.Character :: Model
					character:PivotTo(CFrame.lookAt(out.Position, out.Position + crew.base.cframe.LookVector))
					notify(player, "☠ The pirates locked their base!", "error")
				end
			end
		end
	end
end)

-- Once a second: keep pirates in empty bases, run their lock cycle and restock.
task.spawn(function()
	while true do
		task.wait(1)
		local t = now()
		local wanted = Config.PirateBases
		local count = 0
		for _ in pirates do
			count += 1
		end
		for i in built.bases do
			if count >= wanted then
				break
			end
			-- Only move into a base nobody owns, and never take the last empty base so a joiner never evicts.
			local empty = 0
			for j in built.bases do
				if not baseOwner[j] and not pirates[j] then
					empty += 1
				end
			end
			if not baseOwner[i] and not pirates[i] and empty > 1 then
				spawnPirates(i)
				count += 1
			end
		end
		for _, crew in pirates do
			local base = crew.base
			if t >= crew.nextLock and t >= crew.lockedUntil then
				crew.lockedUntil = t + Config.PirateLock
				crew.nextLock = crew.lockedUntil + Config.PirateOpen
			end
			local left = crew.lockedUntil - t
			if left > 0 then
				setShield(base, true)
				base.lockLabel.Text = `☠ LOCKED {math.ceil(left)}s`
				base.lockLabel.TextColor3 = Color3.fromRGB(255, 120, 120)
				base.lockPlate.Color = PIRATE_TRIM
			else
				setShield(base, false)
				local open = crew.nextLock - t
				base.lockLabel.Text = `☠ OPEN · locks in {math.ceil(open)}s`
				base.lockLabel.TextColor3 = if open <= 5 then Color3.fromRGB(255, 200, 80) else Color3.fromRGB(140, 255, 150)
				base.lockPlate.Color = Color3.fromRGB(80, 80, 90)
			end
			if t >= crew.refillAt then
				crew.refillAt = t + Config.PirateRefill
				local have = 0
				for _ in crew.slots do
					have += 1
				end
				if have < Config.PirateLoot then
					addPirateLoot(crew)
				end
			end
			-- The crew's antenna blinks.
			local blinker = crew.crew:FindFirstChild("Blinker") :: BasePart?
			if blinker then
				blinker.Transparency = if math.floor(t) % 2 == 0 then 0 else 0.7
			end
		end
	end
end)

local function claimBase(player: Player): World.Base?
	-- Prefer a truly empty base; otherwise kick the pirates out of one.
	for i, b in built.bases do
		if not baseOwner[i] and not pirates[i] then
			baseOwner[i] = player
			return b
		end
	end
	for i, b in built.bases do
		if not baseOwner[i] then
			evictPirates(i)
			baseOwner[i] = player
			return b
		end
	end
	return nil
end

local function onCharacter(player: Player, character: Model)
	local session = sessions[player]
	if not session then
		return
	end
	local humanoid = character:WaitForChild("Humanoid", 10) :: Humanoid?
	local root = character:WaitForChild("HumanoidRootPart", 10) :: BasePart?
	if not humanoid or not root then
		return
	end
	humanoid.UseJumpPower = true
	applySpeed(player)
	-- The engine places a fresh character after CharacterAdded fires, so wait a frame before moving it home.
	if not character:IsDescendantOf(Workspace) then
		character.AncestryChanged:Wait()
	end
	RunService.Heartbeat:Wait()
	character:PivotTo(session.base.spawn)
	humanoid.Died:Connect(function()
		dropCarry(player, "You dropped the satellite!")
	end)
end

local function onPlayerAdded(player: Player)
	local base = claimBase(player)
	if not base then
		player:Kick("This server is full, please join another one!")
		return
	end
	local profile = store:attach(player, RunService:IsStudio())
	if not profile or not player.Parent then
		baseOwner[base.index] = nil
		return
	end
	local data = profile.data

	local folder = Instance.new("Folder")
	folder.Name = "leaderstats"
	local cashStat = Instance.new("StringValue")
	cashStat.Name = "Cash"
	cashStat.Parent = folder
	local stealStat = Instance.new("IntValue")
	stealStat.Name = "Steals"
	stealStat.Parent = folder
	folder.Parent = player

	local session: Session = {
		profile = profile,
		base = base,
		slots = {},
		carry = nil,
		lockedUntil = 0,
		shieldUntil = 0,
		stunnedUntil = 0,
		immuneUntil = 0,
		zapReady = 0,
		lastAction = 0,
		leaderstats = { Cash = cashStat, Steals = stealStat },
	}
	sessions[player] = session

	base.ownerLabel.Text = `{player.DisplayName}'s Base`
	base.insideLabel.Text = "HOME SWEET HOME"

	-- Restore satellites.
	local count = slotCount(player, data)
	local pendingBySlot = {}
	for _, entry in data.sats do
		if type(entry.s) == "number" then
			pendingBySlot[entry.s] = entry.p
		end
	end
	for s, id in Rules.loadSlots(data.sats, count, Config.ById) do
		setSlot(player, session, s, id, tonumber(pendingBySlot[s]) or 0)
	end
	syncSave(session)
	paintPads(player, session)

	-- Offline earnings.
	if data.lastOnline > 0 then
		local amount = Formulas.offlineEarnings(os.time() - data.lastOnline, incomePerSecond(player, session))
		if amount > 0 then
			data.cash += amount
			data.totalEarned += amount
			task.delay(3, notify, player, `🌙 While you were away your satellites made {Formulas.cash(amount)}!`, "reward")
		end
	end
	data.lastOnline = os.time()

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

local function onPlayerRemoving(player: Player)
	local session = sessions[player]
	if not session then
		return
	end
	-- Anything this player was carrying goes home; anything being stolen from them is cancelled.
	dropCarry(player)
	for s, slot in session.slots do
		local thief = slot.carrier
		local thiefSession = thief and sessions[thief]
		if thief and thiefSession and thiefSession.carry then
			thiefSession.carry.model:Destroy()
			thiefSession.carry = nil
			thief:SetAttribute("Carrying", "")
			applySpeed(thief)
			notify(thief, "The owner left, the satellite vanished!", "error")
		end
		slot.model:Destroy()
		session.base.collectLabels[s].Text = ""
	end
	session.profile.data.lastOnline = os.time()
	local base = session.base
	base.ownerLabel.Text = "EMPTY BASE"
	base.insideLabel.Text = ""
	setShield(base, false)
	base.lockLabel.Text = "🔓 LOCK BASE"
	for _, d in base.model:GetChildren() do
		if d.Name == "Trim" or d.Name == "SignTrim" then
			(d :: BasePart).Color = base.color
		end
	end
	baseOwner[base.index] = nil
	sessions[player] = nil
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end
Players.PlayerRemoving:Connect(onPlayerRemoving)
store:start(60)

-- Base interactions ----------------------------------------------------------------------------

local function playerFromHit(hit: BasePart): Player?
	local model = hit:FindFirstAncestorOfClass("Model")
	return model and Players:GetPlayerFromCharacter(model)
end

for _, base in built.bases do
	for i, plate in base.collect do
		local debounce = 0
		plate.Touched:Connect(function(hit)
			local player = playerFromHit(hit)
			local owner = baseOwner[base.index]
			if not player or player ~= owner or os.clock() - debounce < 0.3 then
				return
			end
			debounce = os.clock()
			local session = sessions[player]
			local slot = session and session.slots[i]
			if not session or not slot or slot.pending < 1 then
				return
			end
			local amount = math.floor(slot.pending)
			slot.pending -= amount
			session.profile.data.cash += amount
			session.profile.data.totalEarned += amount
			base.collectLabels[i].Text = ""
			fxRemote:FireClient(player, "collect", plate.Position, amount)
			refresh(player)
		end)
	end
	base.lockPlate.Touched:Connect(function(hit)
		local player = playerFromHit(hit)
		local session = player and sessions[player]
		if not player or not session or player ~= baseOwner[base.index] or isLocked(session) then
			return
		end
		session.lockedUntil = now() + Config.LockSeconds
		notify(player, `🔒 Base locked for {Config.LockSeconds}s!`, "good")
		fxRemote:FireClient(player, "lock")
		refresh(player)
	end)
end

-- The launch belt --------------------------------------------------------------------------------

local beltFolder = Instance.new("Folder")
beltFolder.Name = "BeltSatellites"
beltFolder.Parent = Workspace

local function buyFromBelt(player: Player, model: Model, id: string)
	local session = sessions[player]
	if not session or model.Parent ~= beltFolder or model:GetAttribute("Sold") then
		return
	end
	local sat = Config.ById[id]
	local data = session.profile.data
	local free = Rules.freeSlot(session.slots, slotCount(player, data))
	if data.cash < sat.price then
		notify(player, `Need {Formulas.cash(sat.price - data.cash)} more!`, "error")
		return
	elseif not free then
		notify(player, "Your base is full! Sell or rebirth for more pads.", "error")
		return
	end
	model:SetAttribute("Sold", true)
	data.cash -= sat.price
	local from = (model.PrimaryPart :: BasePart).Position
	model:Destroy()
	local isNew = not data.found[id]
	setSlot(player, session, free, id)
	fxRemote:FireAllClients("buy", from, session.base.pads[free].Position, id)
	if sat.tier >= 5 then
		for other in sessions do
			if other ~= player then
				notify(other, `{player.DisplayName} bought a {Config.Rarities[sat.tier].name} {sat.name}! 👀`, "info")
			end
		end
	end
	notify(player, `{if isNew then "NEW! " else ""}{sat.name} is flying to your base!`, if sat.tier >= 4 then "big" else "reward")
	refresh(player)
end

local function spawnOnBelt()
	local luck = now() < (Workspace:GetAttribute("LuckUntil") or 0)
	local id = Formulas.roll(math.random(), math.random(), luck)
	local sat = Config.ById[id]
	local model = SatModel.build(id, CFrame.new(built.beltStart))
	local root = model.PrimaryPart :: BasePart
	infoTag(root, id, Formulas.cash(sat.price), 5 * sat.scale)
	local buy = prompt(root, "Buy", `Buy {Formulas.cash(sat.price)}`, sat.name, 0)
	buy.Triggered:Connect(function(player)
		buyFromBelt(player, model, id)
	end)
	model:SetAttribute("BeltSpawn", now())
	model.Parent = beltFolder
	if sat.tier >= 6 then
		for player in sessions do
			notify(player, `✨ A {Config.Rarities[sat.tier].name} {sat.name} is on the belt!`, "big")
		end
	end
end

-- Belt satellites are anchored and moved along the track here; clients smooth the motion.
task.spawn(function()
	local nextSpawn = 0
	RunService.Heartbeat:Connect(function()
		local t = now()
		if t >= nextSpawn then
			nextSpawn = t + Config.BeltSpawnEvery
			spawnOnBelt()
		end
		for _, model in beltFolder:GetChildren() do
			if model:IsA("Model") then
				local age = t - ((model:GetAttribute("BeltSpawn") :: number?) or t)
				local x = built.beltStart.X + age * Config.BeltSpeed
				if x > built.beltEnd.X + 6 then
					model:Destroy()
				else
					model:PivotTo(CFrame.new(x, built.beltStart.Y + math.sin(age * 2) * 0.4, built.beltStart.Z) * CFrame.Angles(0, age * 0.8, 0))
				end
			end
		end
	end)
end)

-- Per-frame checks: deliveries, locked bases, stale carries ----------------------------------------

RunService.Heartbeat:Connect(function()
	local t = now()
	for player, session in sessions do
		local root = rootOf(player)
		if session.carry and root then
			if insideBase(session.base, root.Position) then
				completeSteal(player, session)
			elseif t - session.carry.started > 120 then
				dropCarry(player, "Too slow! The satellite flew home.")
			end
		end
		-- Push intruders out of locked bases.
		if isLocked(session) then
			for other in sessions do
				local otherRoot = rootOf(other)
				if other ~= player and otherRoot and insideBase(session.base, otherRoot.Position, 1) then
					local out = session.base.cframe * CFrame.new(0, 4, -World.BaseDepth / 2 - 8)
					local character = other.Character :: Model
					character:PivotTo(CFrame.lookAt(out.Position, out.Position + session.base.cframe.LookVector))
					notify(other, "🔒 That base is locked!", "error")
				end
			end
		end
	end
end)

-- Once-a-second tick: income, labels, lock displays --------------------------------------------

task.spawn(function()
	while true do
		task.wait(1)
		local t = now()
		for player, session in sessions do
			local data = session.profile.data
			local state = incomeState(player, data)
			for s, slot in session.slots do
				if not slot.carrier then
					slot.pending += Formulas.satIncome(slot.id, state)
					session.base.collectLabels[s].Text = if slot.pending >= 1 then Formulas.cash(slot.pending) else ""
				end
			end
			syncSave(session)
			data.playSeconds += 1
			data.lastOnline = os.time()
			local base = session.base
			local lockLeft = math.max(session.lockedUntil, session.shieldUntil) - t
			if lockLeft > 0 then
				setShield(base, true)
				base.lockLabel.Text = if t < session.shieldUntil
					then `🛡 SHIELD {math.floor(lockLeft / 60)}:{string.format("%02d", math.floor(lockLeft % 60))}`
					else `🔒 LOCKED {math.ceil(lockLeft)}s`
				base.lockLabel.TextColor3 = Color3.fromRGB(120, 220, 255)
				base.lockPlate.Color = Color3.fromRGB(80, 170, 255)
			else
				setShield(base, false)
				base.lockLabel.Text = "🔓 LOCK BASE"
				base.lockLabel.TextColor3 = Color3.fromRGB(255, 120, 120)
				base.lockPlate.Color = Color3.fromRGB(255, 70, 70)
			end
			refresh(player)
		end
	end
end)

-- Actions ---------------------------------------------------------------------------------------

local actions: { [string]: (Player, Session, any) -> () } = {}

function actions.rebirth(player, session)
	local data = session.profile.data
	local cost = Formulas.rebirthCost(data.rebirths)
	if data.cash < cost then
		notify(player, `Need {Formulas.cash(cost)} to rebirth`, "error")
		return
	end
	dropCarry(player)
	for s, slot in session.slots do
		local thief = slot.carrier
		if thief then
			dropCarry(thief, "The owner rebirthed, the satellite vanished!")
		end
		clearSlot(session, s)
	end
	data.rebirths += 1
	data.cash = Config.RebirthStartCash
	paintPads(player, session)
	notify(player, `REBIRTH {data.rebirths}! +{math.floor(Config.RebirthIncomeBonus * 100)}% income forever`, "big")
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
	local amount = Formulas.dailyReward(streak, incomePerSecond(player, session))
	data.cash += amount
	notify(player, `Day {streak} reward: {Formulas.cash(amount)}!`, "win")
end

function actions.zap(player)
	zap(player)
end

function actions.home(player, session)
	if session.carry then
		notify(player, "Can't teleport while carrying loot!", "error")
		return
	end
	local character = player.Character
	if character then
		character:PivotTo(session.base.spawn)
	end
end

actionRemote.OnServerEvent:Connect(function(player, name, arg)
	local session = sessions[player]
	local handler = if type(name) == "string" then actions[name] else nil
	if not session or not handler or os.clock() - session.lastAction < 0.2 then
		return
	end
	session.lastAction = os.clock()
	handler(player, session, arg)
	refresh(player)
end)

-- Leaderboards --------------------------------------------------------------------------------------

do
	local function field(name: string): (Player) -> number?
		return function(player: Player): number?
			local session = sessions[player]
			return if session then session.profile.data[name] else nil
		end
	end
	local x = built.beltStart.X - 30
	local function at(z: number): CFrame
		return CFrame.lookAt(Vector3.new(x, 13, z), Vector3.new(x + 40, 13, z * 0.6))
	end
	Leaderboard.start({
		{ store = "TopSteals", title = "🦹 TOP THIEVES", color = Color3.fromRGB(255, 90, 170), cframe = at(-44), value = field("steals"), format = Formulas.abbreviate },
		{ store = "TopEarned", title = "💰 TOP EARNERS", color = Color3.fromRGB(255, 210, 70), cframe = at(44), value = field("totalEarned"), format = Formulas.cash },
	}, built.map)
end

-- Studio-only test hook: ServerStorage.Debug:Invoke(player, patch) merges fields into the
-- player's data and returns a snapshot. Never created in live servers.
if RunService:IsStudio() then
	local debug = Instance.new("BindableFunction")
	debug.Name = "Debug"
	debug.OnInvoke = function(player: Player, patch: { [string]: any }?)
		local session = sessions[player]
		if not session then
			return nil
		end
		for k, v in (patch or {}) :: { [string]: any } do
			if k == "give" then
				local free = Rules.freeSlot(session.slots, slotCount(player, session.profile.data))
				if free then
					setSlot(player, session, free, v)
				end
			elseif (session :: any)[k] ~= nil and k ~= "profile" then
				(session :: any)[k] = v
			else
				session.profile.data[k] = v
			end
		end
		refresh(player)
		local slots = {}
		for s, slot in session.slots do
			slots[s] = { id = slot.id, pending = slot.pending, carrier = slot.carrier and slot.carrier.Name }
		end
		return { data = session.profile.data, slots = slots, carrying = session.carry and session.carry.id, base = session.base.index }
	end
	debug.Parent = game:GetService("ServerStorage")
end
