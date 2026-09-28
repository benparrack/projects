-- Headless tests for Steal a Satellite's pure logic.
-- Run from money/roblox/games/steal-a-satellite:  lune run tests/run

local Config = require("../src/shared/Config")
local Formulas = require("../src/shared/Formulas")
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
local function near(a: number, b: number, msg: string?)
	if math.abs(a - b) > 1e-9 then
		error(`{msg or "expected near"}: {a} ~= {b}`, 2)
	end
end

test("catalog is consistent", function()
	local seen = {}
	for i, s in Config.Satellites do
		assert(not seen[s.id], "duplicate id " .. s.id)
		seen[s.id] = true
		assert(Config.Rarities[s.tier], "bad tier " .. s.id)
		if i > 1 then
			local prev = Config.Satellites[i - 1]
			assert(s.price > prev.price, "prices must rise: " .. s.id)
			assert(s.income > prev.income, "income must rise: " .. s.id)
			assert(s.tier >= prev.tier, "tiers must not drop: " .. s.id)
		end
	end
	for tier = 1, #Config.Rarities do
		local any = false
		for _, s in Config.Satellites do
			any = any or s.tier == tier
		end
		assert(any, "empty tier " .. tier)
	end
end)

test("payback grows up the tiers", function()
	local first = Config.Satellites[1]
	local last = Config.Satellites[#Config.Satellites]
	assert(first.price / first.income <= 16)
	assert(last.price / last.income >= 70)
end)

test("tier odds sum to 1, luck boosts lucky tiers", function()
	for _, luck in { false, true } do
		local sum = 0
		for _, p in Formulas.tierOdds(luck) do
			sum += p
		end
		near(sum, 1)
	end
	local base, lucky = Formulas.tierOdds(false), Formulas.tierOdds(true)
	assert(lucky[5] > base[5] * 1.8, "legendary boosted")
	assert(lucky[1] < base[1], "common shrinks")
end)

test("satellite odds sum to 1", function()
	local sum = 0
	for _, s in Config.Satellites do
		sum += Formulas.satOdds(s.id, false)
	end
	near(sum, 1)
end)

test("roll hits the right tier edges", function()
	eq(Config.ById[Formulas.roll(0, 0, false)].tier, 1)
	eq(Config.ById[Formulas.roll(0.9999999, 0.5, false)].tier, 8)
	eq(Formulas.roll(0, 0.99999, false), "weatherbud")
end)

test("roll distribution roughly matches odds", function()
	math.randomseed(42)
	local counts = {}
	local n = 200000
	for _ = 1, n do
		local id = Formulas.roll(math.random(), math.random(), false)
		local t = Config.ById[id].tier
		counts[t] = (counts[t] or 0) + 1
	end
	local odds = Formulas.tierOdds(false)
	for t = 1, 4 do
		assert(math.abs(counts[t] / n - odds[t]) < 0.01, "tier " .. t)
	end
end)

test("income multiplier stacks", function()
	eq(Formulas.incomeMultiplier({ rebirths = 0, x2Cash = false, vip = false }), 1)
	eq(Formulas.incomeMultiplier({ rebirths = 2, x2Cash = true, vip = true }), 2 * 2 * 1.5)
	eq(Formulas.totalIncome({ "tincan", "beeper", "nope" }, { rebirths = 0, x2Cash = false, vip = false }), 3)
end)

test("slots, rebirth cost, sell, offline, daily", function()
	eq(Formulas.slotCount(0, false), 8)
	eq(Formulas.slotCount(2, true), 14)
	eq(Formulas.slotCount(50, true), 16)
	eq(Formulas.rebirthCost(0), 1000000)
	eq(Formulas.rebirthCost(2), 16000000)
	eq(Formulas.sellPrice("tincan"), 7)
	eq(Formulas.offlineEarnings(100, 10), 100)
	eq(Formulas.offlineEarnings(10 ^ 9, 10), 7200)
	eq(Formulas.offlineEarnings(-5, 10), 0)
	eq(Formulas.dailyReward(1, 0), 100)
	eq(Formulas.dailyReward(30, 100), 42000)
end)

test("formatting", function()
	eq(Formulas.abbreviate(1234), "1,234")
	eq(Formulas.abbreviate(32000000), "32.0M")
	eq(Formulas.cash(15), "$15")
	eq(Formulas.oddsLabel(0.54), "54%")
	eq(Formulas.oddsLabel(0.125), "12.5%")
	eq(Formulas.oddsLabel(0.0001), "1 in 10,000")
end)

test("freeSlot / usedSlots", function()
	eq(Rules.freeSlot({}, 8), 1)
	eq(Rules.freeSlot({ [1] = "a", [2] = "b" }, 8), 3)
	eq(Rules.freeSlot({ [1] = "a", [2] = "b" }, 2), nil)
	eq(Rules.usedSlots({ [1] = "a", [5] = "b" }), 2)
end)

test("steal blockers", function()
	local ok = { isOwner = false, locked = false, alreadyCarrying = false, targetCarried = false, thiefHasRoom = true, stunned = false }
	eq(Rules.stealBlocker(ok), nil)
	for _, key in { "isOwner", "locked", "alreadyCarrying", "targetCarried", "stunned" } do
		local c = table.clone(ok);
		(c :: any)[key] = true
		assert(Rules.stealBlocker(c), key)
	end
	local full = table.clone(ok)
	full.thiefHasRoom = false
	assert(Rules.stealBlocker(full))
end)

test("load/save slots round-trip and repair", function()
	local slots = Rules.loadSlots({
		{ t = "tincan", s = 1 },
		{ t = "beeper", s = 1 }, -- duplicate slot -> packed
		{ t = "ghost", s = 3 }, -- unknown id -> dropped
		{ t = "spyeye", s = 99 }, -- out of range -> packed
	}, 8, Config.ById)
	eq(slots[1], "tincan")
	eq(slots[2], "beeper")
	eq(slots[3], "spyeye")
	eq(Rules.usedSlots(slots), 3)
	local saved = Rules.saveSlots(slots)
	eq(#saved, 3)
	eq(saved[3].t, "spyeye")
	-- More satellites than pads keeps what fits.
	local many = {}
	for i = 1, 10 do
		table.insert(many, { t = "tincan", s = i })
	end
	eq(Rules.usedSlots(Rules.loadSlots(many, 8, Config.ById)), 8)
end)

test("pirate rolls respect the tier cap", function()
	math.randomseed(7)
	for _ = 1, 2000 do
		local id = Formulas.pirateRoll(math.random(), math.random(), 3)
		assert(Config.ById[id].tier <= 3, id)
	end
	-- Rolls under the cap are untouched.
	eq(Formulas.pirateRoll(0, 0, 8), Formulas.roll(0, 0, true))
	-- The very top of the dice lands in the cap tier when capped.
	eq(Config.ById[Formulas.pirateRoll(0.99999, 0.5, 2)].tier, 2)
end)

print(`{passed} passed, {failed} failed`)
if failed > 0 then
	error("tests failed")
end
