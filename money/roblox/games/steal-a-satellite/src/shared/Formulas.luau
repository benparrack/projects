--!strict
-- Pure game math, shared by server, client and the Lune tests.

local Config = if script then require(script.Parent.Config) else require("./Config")

local Formulas = {}

export type IncomeState = {
	rebirths: number,
	x2Cash: boolean,
	vip: boolean,
}

function Formulas.incomeMultiplier(state: IncomeState): number
	local m = 1 + Config.RebirthIncomeBonus * state.rebirths
	if state.x2Cash then
		m *= 2
	end
	if state.vip then
		m *= 1.5
	end
	return m
end

-- Cash per second for one satellite type.
function Formulas.satIncome(id: string, state: IncomeState): number
	local sat = Config.ById[id]
	return if sat then sat.income * Formulas.incomeMultiplier(state) else 0
end

-- Cash per second for a list of satellite ids.
function Formulas.totalIncome(ids: { string }, state: IncomeState): number
	local total = 0
	for _, id in ids do
		total += Formulas.satIncome(id, state)
	end
	return total
end

function Formulas.slotCount(rebirths: number, biggerBase: boolean): number
	local n = Config.BaseSlots + math.min(rebirths, Config.RebirthMaxExtraSlots)
	if biggerBase then
		n += Config.BiggerBaseSlots
	end
	return math.min(n, Config.MaxSlots)
end

function Formulas.rebirthCost(rebirths: number): number
	return Config.RebirthBaseCost * Config.RebirthGrowth ^ rebirths
end

function Formulas.sellPrice(id: string): number
	local sat = Config.ById[id]
	return if sat then math.floor(sat.price * Config.SellFraction) else 0
end

function Formulas.offlineEarnings(secondsAway: number, incomePerSecond: number): number
	local t = math.clamp(secondsAway, 0, Config.OfflineCapSeconds)
	return math.floor(t * incomePerSecond * Config.OfflineFraction)
end

function Formulas.dayIndex(unixTime: number): number
	return math.floor(unixTime / 86400)
end

-- Returns the new streak and whether a reward is due today.
function Formulas.advanceStreak(lastDay: number, streak: number, today: number): (number, boolean)
	if lastDay == today then
		return streak, false
	elseif lastDay == today - 1 then
		return streak + 1, true
	end
	return 1, true
end

function Formulas.dailyReward(streak: number, incomePerSecond: number): number
	local days = math.min(math.max(streak, 1), Config.DailyStreakCap)
	return math.max(Config.DailyMinCash * days, math.floor(incomePerSecond * Config.DailyIncomeSeconds * days))
end

-- Belt odds ----------------------------------------------------------------------------------

-- Chance (0..1) of each rarity tier coming down the belt.
function Formulas.tierOdds(luck: boolean): { number }
	local weights = {}
	local total = 0
	for i, r in Config.Rarities do
		local w = r.weight
		if luck and r.lucky then
			w *= Config.LuckMultiplier
		end
		weights[i] = w
		total += w
	end
	for i, w in weights do
		weights[i] = w / total
	end
	return weights
end

local byTier: { { any } } = {}
for _, s in Config.Satellites do
	byTier[s.tier] = byTier[s.tier] or {}
	table.insert(byTier[s.tier], s)
end

-- Chance (0..1) of one specific satellite: its tier's odds split evenly inside the tier.
function Formulas.satOdds(id: string, luck: boolean): number
	local sat = Config.ById[id]
	if not sat then
		return 0
	end
	return Formulas.tierOdds(luck)[sat.tier] / #byTier[sat.tier]
end

-- Picks the next belt satellite. `r1` and `r2` are uniform [0,1) numbers.
function Formulas.roll(r1: number, r2: number, luck: boolean): string
	local odds = Formulas.tierOdds(luck)
	local acc = 0
	local tier = #odds
	for i, p in odds do
		acc += p
		if r1 < acc then
			tier = i
			break
		end
	end
	local list = byTier[tier]
	return list[math.min(#list, math.floor(r2 * #list) + 1)].id
end

-- A belt-style roll whose tier is capped at `maxTier` (space pirate loot scales with the server's progress).
function Formulas.pirateRoll(r1: number, r2: number, maxTier: number): string
	local id = Formulas.roll(r1, r2, true)
	local tier = Config.ById[id].tier
	if tier <= maxTier then
		return id
	end
	local list = byTier[math.max(1, maxTier)]
	return list[math.min(#list, math.floor(r2 * #list) + 1)].id
end

-- "1 in 2,500" style label for tiny odds, percentages otherwise.
function Formulas.oddsLabel(p: number): string
	if p >= 0.01 then
		local s = string.format("%.1f%%", p * 100)
		return (s:gsub("%.0%%", "%%"))
	end
	local n = math.floor(1 / p + 0.5)
	return "1 in " .. (if n < 1000000 then Formulas.commas(n) else Formulas.abbreviate(n))
end

-- Number formatting --------------------------------------------------------------------------

local SUFFIXES = { "K", "M", "B", "T", "Qa", "Qi" }

function Formulas.commas(n: number): string
	local s = tostring(math.floor(n))
	local formatted = s:reverse():gsub("(%d%d%d)", "%1,"):reverse()
	return (formatted:gsub("^(-?),", "%1"))
end

function Formulas.abbreviate(n: number): string
	n = math.floor(n)
	if math.abs(n) < 10000 then
		return Formulas.commas(n)
	end
	local i = 0
	local v = n
	while math.abs(v) >= 1000 and i < #SUFFIXES do
		v /= 1000
		i += 1
	end
	local digits = if math.abs(v) >= 100 then 0 elseif math.abs(v) >= 10 then 1 else 2
	local s = string.format("%." .. digits .. "f", math.floor(v * 10 ^ digits) / 10 ^ digits)
	return s .. SUFFIXES[i]
end

function Formulas.cash(n: number): string
	return "$" .. Formulas.abbreviate(n)
end

return Formulas
