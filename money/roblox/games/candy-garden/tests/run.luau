-- Headless tests for Grow a Candy Garden's pure logic.
-- Run from money/roblox/games/candy-garden:  lune run tests/run

local Config = require("../src/shared/Config")
local Rules = require("../src/shared/Rules")

local passed, failed = 0, 0
local function test(name: string, fn: () -> ())
	local ok, err = pcall(fn)
	if ok then
		passed += 1
	else
		failed += 1
		print(`FAIL {name}: {err}`)
	end
end
local function eq(a: any, b: any, msg: string?)
	if a ~= b then
		error(`{msg or "expected equal"}: {tostring(a)} ~= {tostring(b)}`, 2)
	end
end

local function const(v: number): () -> number
	return function()
		return v
	end
end

local function seq(values: { number }): () -> number
	local i = 0
	return function()
		i = i % #values + 1
		return values[i]
	end
end

test("seeds are ordered by price and have sane numbers", function()
	for i, s in Config.Seeds do
		assert(s.amount[1] <= s.amount[2], s.id)
		assert(s.stock > 0 and s.stock <= 1, s.id)
		if i > 1 then
			assert(s.price > Config.Seeds[i - 1].price, s.id)
		end
		-- a seed must pay back within two hours (plants also grow while you are offline)
		local harvests = if s.regrow then 1 + math.floor((7200 - s.grow) / s.regrow) else 1
		assert(harvests * s.value >= s.price, `{s.id} never pays back in two hours`)
	end
end)

test("stock always has gumdrops, rare seeds only on low rolls", function()
	local all = Rules.rollStock(const(0))
	eq(all.gumdrop, Config.SeedById.gumdrop.amount[1])
	eq(all.rockcandy, 1)
	local none = Rules.rollStock(const(0.99))
	eq(none.gumdrop, Config.SeedById.gumdrop.amount[2])
	eq(none.rockcandy, nil)
	eq(none.lollipop, nil)
end)

test("candy weights stay in range without a giant roll", function()
	local c = Rules.rollCandy("lollipop", const(0.5), nil)
	local kg = Config.SeedById.lollipop.kg
	assert(c.kg >= kg * 0.8 and c.kg <= kg * 1.6, tostring(c.kg))
	eq(c.m, nil)
end)

test("low rolls give giant rainbow candy", function()
	local c = Rules.rollCandy("gumdrop", const(0), nil)
	eq(c.m, "rainbow")
	assert(c.kg >= Config.SeedById.gumdrop.kg * 0.8 * 2.5 - 0.01)
end)

test("weather mutation only while that weather is active", function()
	-- weight 0.5, no giant (0.5), mutation roll 0.5 (not golden), weather roll 0.1
	local r = seq({ 0.5, 0.5, 0.5, 0.1 })
	eq(Rules.rollCandy("gumdrop", r, "blizzard").m, "frozen")
	r = seq({ 0.5, 0.5, 0.5, 0.1 })
	eq(Rules.rollCandy("gumdrop", r, nil).m, nil)
	r = seq({ 0.5, 0.5, 0.5, 0.9 })
	eq(Rules.rollCandy("gumdrop", r, "blizzard").m, nil)
end)

test("rainbow hour boosts rainbow odds", function()
	-- roll just above the normal rainbow chance but below the boosted one
	local r = seq({ 0.5, 0.5, Config.RainbowChance * 5 })
	eq(Rules.rollCandy("gumdrop", r, "rainbowhour").m, "rainbow")
	r = seq({ 0.5, 0.5, Config.RainbowChance * 5 })
	eq(Rules.rollCandy("gumdrop", r, nil).m, "golden")
end)

test("candy value scales with weight, mutation and sell multiplier", function()
	local seed = Config.SeedById.candycane
	eq(Rules.candyValue({ s = "candycane", kg = seed.kg }), seed.value)
	eq(Rules.candyValue({ s = "candycane", kg = seed.kg * 2 }), seed.value * 2)
	eq(Rules.candyValue({ s = "candycane", kg = seed.kg, m = "golden" }), seed.value * 20)
	eq(Rules.candyValue({ s = "candycane", kg = seed.kg }, 2), seed.value * 2)
	eq(Rules.candyValue({ s = "nope", kg = 1 }), 0)
end)

test("candy names include the mutation", function()
	eq(Rules.candyName({ s = "lollipop", kg = 1 }), "Lollipop")
	eq(Rules.candyName({ s = "lollipop", kg = 1, m = "frozen" }), "Frozen Lollipop")
end)

test("grow times and fast grow", function()
	eq(Rules.growTime("gumdrop", false), 20)
	eq(Rules.growTime("candycorn", true), 30)
	eq(Rules.regrowTime("gumdrop", false), nil)
	eq(Rules.regrowTime("lollipop", false), 45)
end)

test("progress clamps", function()
	eq(Rules.progress(100, 200, 50), 0)
	eq(Rules.progress(100, 200, 150), 0.5)
	eq(Rules.progress(100, 200, 500), 1)
	eq(Rules.progress(100, 100, 100), 1)
end)

test("tile indexing round-trips", function()
	for row = 1, Config.Rows do
		for col = 1, Config.Cols do
			local i = Rules.tileIndex(row, col)
			eq(Rules.tileRow(i), row)
			eq(Rules.tileCol(i), col)
		end
	end
	eq(Rules.tileIndex(Config.Rows, Config.Cols), Config.Rows * Config.Cols)
end)

test("row costs", function()
	eq(Rules.nextRowCost(Config.StartRows), Config.RowCosts[Config.StartRows + 1])
	eq(Rules.nextRowCost(Config.Rows), nil)
end)

test("weather picks follow the weights", function()
	eq(Rules.pickWeather(const(0)), "sprinkles")
	eq(Rules.pickWeather(const(0.999)), "rainbowhour")
	local counts = {}
	local n = 0
	for i = 0, 99 do
		local id = Rules.pickWeather(const(i / 100))
		counts[id] = (counts[id] or 0) + 1
		n += 1
	end
	eq(counts.sprinkles, 40)
	eq(counts.rainbowhour, 10)
end)

test("daily streak", function()
	local s, c = Rules.daily(0, 0, 100)
	eq(s, 1)
	eq(c, Config.DailyBase)
	s, c = Rules.daily(99, 3, 100)
	eq(s, 4)
	s = Rules.daily(100, 3, 100)
	eq(s, nil)
	s = Rules.daily(99, Config.DailyStreakCap, 100)
	eq(s, Config.DailyStreakCap)
end)

test("short numbers and clocks", function()
	eq(Rules.short(999), "999")
	eq(Rules.short(1000), "1K")
	eq(Rules.short(1250), "1.2K")
	eq(Rules.short(2500000), "2.5M")
	eq(Rules.short(123456789), "123M")
	eq(Rules.clock(65), "1:05")
	eq(Rules.clock(3725), "1h 02m")
end)

print(`{passed} passed, {failed} failed`)
if failed > 0 then
	error("tests failed")
end
