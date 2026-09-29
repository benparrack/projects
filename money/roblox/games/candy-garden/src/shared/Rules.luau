--!strict
-- Grow a Candy Garden rules: pure functions shared by the server, client and Lune tests.

local Config = if script then require(script.Parent.Config) else require("./Config")

local Rules = {}

export type Rng = () -> number -- uniform in [0, 1)
export type Candy = { s: string, kg: number, m: string? } -- seed id, weight, mutation id

-- Stock for one restock: seed id -> count (only seeds that rolled in).
function Rules.rollStock(rng: Rng): { [string]: number }
	local stock = {}
	for _, seed in Config.Seeds do
		if rng() < seed.stock then
			local lo, hi = seed.amount[1], seed.amount[2]
			stock[seed.id] = lo + math.floor(rng() * (hi - lo + 1))
		end
	end
	return stock
end

-- Rolls the candy picked from a ripe plant. `weather` is the active weather id (or nil).
function Rules.rollCandy(seedId: string, rng: Rng, weather: string?): Candy
	local seed = Config.SeedById[seedId]
	local kg = seed.kg * (0.8 + rng() * 0.8)
	if rng() < Config.GiantChance then
		kg *= 2.5 + rng() * 1.5
	end
	kg = math.floor(kg * 100 + 0.5) / 100
	local w = if weather then Config.WeatherById[weather] else nil
	local rainbowChance = Config.RainbowChance * (if w and w.rainbowBoost then w.rainbowBoost else 1)
	local roll = rng()
	local mut: string? = nil
	if roll < rainbowChance then
		mut = "rainbow"
	elseif roll < rainbowChance + Config.GoldenChance then
		mut = "golden"
	elseif w and w.mutation and rng() < Config.WeatherMutationChance then
		mut = w.mutation
	end
	return { s = seedId, kg = kg, m = mut }
end

function Rules.candyValue(c: Candy, sellMult: number?): number
	local seed = Config.SeedById[c.s]
	if not seed then
		return 0
	end
	local mult = if c.m and Config.MutationById[c.m] then Config.MutationById[c.m].mult else 1
	return math.max(1, math.floor(seed.value * (c.kg / seed.kg) * mult * (sellMult or 1) + 0.5))
end

function Rules.candyName(c: Candy): string
	local seed = Config.SeedById[c.s]
	local base = if seed then seed.name else c.s
	if c.m and Config.MutationById[c.m] then
		return `{Config.MutationById[c.m].name} {base}`
	end
	return base
end

-- Seconds until the first harvest / between harvests, after speed-ups.
function Rules.growTime(seedId: string, fast: boolean): number
	local seed = Config.SeedById[seedId]
	return seed.grow / (if fast then 1.5 else 1)
end

function Rules.regrowTime(seedId: string, fast: boolean): number?
	local seed = Config.SeedById[seedId]
	if not seed.regrow then
		return nil
	end
	return seed.regrow / (if fast then 1.5 else 1)
end

-- 0..1 growth between the cycle start and ripe time.
function Rules.progress(start: number, ready: number, now: number): number
	if ready <= start then
		return 1
	end
	return math.clamp((now - start) / (ready - start), 0, 1)
end

-- Tiles are numbered row-major from 1; row 1 is at the front of the plot.
function Rules.tileIndex(row: number, col: number): number
	return (row - 1) * Config.Cols + col
end

function Rules.tileRow(index: number): number
	return math.floor((index - 1) / Config.Cols) + 1
end

function Rules.tileCol(index: number): number
	return (index - 1) % Config.Cols + 1
end

function Rules.nextRowCost(rows: number): number?
	if rows >= Config.Rows then
		return nil
	end
	return Config.RowCosts[rows + 1]
end

function Rules.basketCap(bigBasket: boolean): number
	return if bigBasket then Config.BigBasketCap else Config.BasketCap
end

function Rules.pickWeather(rng: Rng): string
	local total = 0
	for _, w in Config.Weathers do
		total += Config.WeatherWeights[w.id] or 0
	end
	local r = rng() * total
	for _, w in Config.Weathers do
		r -= Config.WeatherWeights[w.id] or 0
		if r < 0 then
			return w.id
		end
	end
	return Config.Weathers[1].id
end

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

local SUFFIX = { "", "K", "M", "B", "T", "Qa" }
function Rules.short(n: number): string
	if n < 1000 then
		return tostring(math.floor(n))
	end
	local i = 1
	while n >= 1000 and i < #SUFFIX do
		n /= 1000
		i += 1
	end
	local s = if n >= 100 then string.format("%d", math.floor(n)) else string.format("%.1f", math.floor(n * 10) / 10)
	s = s:gsub("%.0$", "")
	return s .. SUFFIX[i]
end

function Rules.clock(seconds: number): string
	seconds = math.max(0, math.ceil(seconds))
	if seconds >= 3600 then
		return string.format("%dh %02dm", seconds // 3600, (seconds % 3600) // 60)
	end
	return string.format("%d:%02d", seconds // 60, seconds % 60)
end

return Rules
