--!strict
-- Anomaly Shift pure rules: the loop decision, anomaly picks, rewards, titles.
-- No Roblox APIs so the Lune tests can load it.

local Config = if script then require(script.Parent.Config) else require("./Config")

local Rules = {}

export type Choice = "forward" | "back"
export type Outcome = "correct" | "wrong" | "escape"

-- Going forward is right when the hall was normal; turning back is right when it wasn't.
function Rules.decide(floor: number, anomaly: string?, choice: Choice): (Outcome, number)
	local right = (anomaly == nil) == (choice == "forward")
	if not right then
		return "wrong", 0
	end
	if floor >= Config.Floors then
		return "escape", floor
	end
	return "correct", floor + 1
end

-- Rolls the next floor's anomaly (nil = a normal hall).
-- rng() returns [0, 1). found marks anomalies already in the player's Index; unseen ones
-- are twice as likely so the Index keeps filling. last is never repeated back to back.
function Rules.pick(rng: () -> number, floor: number, calmStreak: number, found: { [string]: boolean }, last: string?): string?
	if floor == 0 then
		return nil
	end
	if calmStreak < Config.MaxCalmStreak and rng() >= Config.AnomalyChance then
		return nil
	end
	local pool: { typeof(Config.Anomalies[1]) } = {}
	local weights: { number } = {}
	local total = 0
	for _, a in Config.Anomalies do
		if a.id == last then
			continue
		end
		if floor <= Config.EasyUntilFloor and a.tier > 2 then
			continue
		end
		local w = if found[a.id] then 1 else 2
		table.insert(pool, a)
		table.insert(weights, w)
		total += w
	end
	local r = rng() * total
	for i, a in pool do
		r -= weights[i]
		if r < 0 then
			return a.id
		end
	end
	return pool[#pool].id
end

function Rules.speedBonus(seconds: number): number
	local t = math.clamp(1 - seconds / Config.SpeedBonusUntil, 0, 1)
	return math.floor(Config.SpeedBonusMax * t)
end

function Rules.escapeCoins(seconds: number, mult: number): number
	return math.floor((Config.EscapeCoins + Rules.speedBonus(seconds)) * mult)
end

function Rules.title(escapes: number): string
	local name = Config.Titles[1].name
	for _, t in Config.Titles do
		if escapes >= t.at then
			name = t.name
		end
	end
	return name
end

function Rules.nextTitle(escapes: number): (string?, number?)
	for _, t in Config.Titles do
		if escapes < t.at then
			return t.name, t.at
		end
	end
	return nil, nil
end

-- Day number for daily rewards (UTC days since epoch).
function Rules.day(now: number): number
	return math.floor(now / 86400)
end

-- Returns new streak and coins, or nil if already claimed today.
function Rules.daily(lastDay: number, streak: number, today: number): (number?, number?)
	if lastDay == today then
		return nil, nil
	end
	local s = if lastDay == today - 1 then math.min(streak + 1, Config.DailyStreakCap) else 1
	return s, Config.DailyBase * s
end

-- Fastest-escape leaderboard stores a descending-sortable value.
function Rules.encodeTime(seconds: number): number
	return math.max(1, 360000 - math.floor(seconds * 10))
end

function Rules.decodeTime(v: number): number
	return (360000 - v) / 10
end

function Rules.clock(seconds: number): string
	seconds = math.max(0, seconds)
	local m = math.floor(seconds / 60)
	local s = seconds - m * 60
	return string.format("%d:%04.1f", m, s)
end

return Rules
