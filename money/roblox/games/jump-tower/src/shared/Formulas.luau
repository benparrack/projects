--!strict
-- Pure game math, shared by server, client and the Lune tests.

local Config = if script then require(script.Parent.Config) else require("./Config")

local Formulas = {}

-- Jump stat -> jump height in studs. The square root keeps late-game towers from getting absurdly tall.
function Formulas.jumpHeight(jump: number): number
	return 8 + 3 * math.sqrt(math.max(jump, 0))
end

-- Jump stat needed to reach a height, the inverse of jumpHeight.
function Formulas.jumpForHeight(height: number): number
	local root = math.max(height - 8, 0) / 3
	return root * root
end

-- Humanoid.JumpPower (launch velocity) that reaches the given height.
function Formulas.jumpPower(height: number): number
	return math.sqrt(2 * Config.Gravity * height)
end

export type GainState = {
	rebirths: number,
	x2Jump: boolean,
	vip: boolean,
	trailBonus: number,
}

function Formulas.gainMultiplier(state: GainState): number
	local m = 1 + state.rebirths
	if state.x2Jump then
		m *= 2
	end
	if state.vip then
		m *= 1.5
	end
	return m * (1 + state.trailBonus)
end

function Formulas.gainPerSecond(state: GainState): number
	return Config.BaseGainPerSecond * Formulas.gainMultiplier(state)
end

function Formulas.rebirthCost(rebirths: number): number
	return Config.RebirthBaseCost * (rebirths + 1) ^ 2
end

function Formulas.winsForZone(zone: number, x2Wins: boolean): number
	local base = Config.Zones[zone].wins
	return if x2Wins then base * 2 else base
end

-- Highest zone whose requirement the jump stat meets (0 = none yet).
function Formulas.clearableZone(jump: number): number
	local best = 0
	for i, zone in Config.Zones do
		if jump >= zone.need then
			best = i
		end
	end
	return best
end

-- Jump stat needed to clear the next zone after `zone` (nil once the whole tower is clearable).
function Formulas.nextZoneNeed(jump: number): (number?, number?)
	local nextZone = Formulas.clearableZone(jump) + 1
	local z = Config.Zones[nextZone]
	if z then
		return z.need, nextZone
	end
	return nil, nil
end

-- Day number since the Unix epoch (UTC); used for the daily streak.
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

function Formulas.dailyWins(streak: number): number
	return Config.DailyWinsPerDay * math.min(streak, Config.DailyStreakCap)
end

-- "1,234", then "12.3K", "4.56M", ...
local SUFFIXES = { "K", "M", "B", "T", "Qa", "Qi" }
function Formulas.abbreviate(n: number): string
	n = math.floor(n)
	if math.abs(n) < 10000 then
		local s = tostring(n)
		local formatted = s:reverse():gsub("(%d%d%d)", "%1,"):reverse()
		return (formatted:gsub("^(-?),", "%1"))
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

-- Per-second rates: small values keep up to two decimals so boosts like +25% stay visible.
function Formulas.rate(n: number): string
	if n >= 100 then
		return Formulas.abbreviate(n)
	end
	local s = string.format("%.2f", math.floor(n * 100 + 1e-6) / 100)
	s = s:gsub("0+$", ""):gsub("%.$", "")
	return s
end

return Formulas
