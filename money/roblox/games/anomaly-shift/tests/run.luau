-- Headless tests for Anomaly Shift's pure logic.
-- Run from money/roblox/games/anomaly-shift:  lune run tests/run

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

-- Deterministic rng for picks.
local function seq(values: { number }): () -> number
	local i = 0
	return function()
		i = i % #values + 1
		return values[i]
	end
end

test("catalog ids are unique and tiers valid", function()
	local seen = {}
	for _, a in Config.Anomalies do
		assert(not seen[a.id], "duplicate " .. a.id)
		seen[a.id] = true
		assert(a.tier >= 1 and a.tier <= 3, "tier " .. a.id)
		assert(#a.hint > 0 and #a.name > 0, "text " .. a.id)
		eq(Config.ById[a.id], a)
	end
	assert(#Config.Anomalies >= 20, "want 20+ anomalies")
end)

test("decide: forward on a normal hall climbs", function()
	local o, f = Rules.decide(3, nil, "forward")
	eq(o, "correct")
	eq(f, 4)
end)

test("decide: back on an anomaly climbs", function()
	local o, f = Rules.decide(0, "redlights", "back")
	eq(o, "correct")
	eq(f, 1)
end)

test("decide: mistakes reset to 0", function()
	local o, f = Rules.decide(7, "clock", "forward")
	eq(o, "wrong")
	eq(f, 0)
	o, f = Rules.decide(5, nil, "back")
	eq(o, "wrong")
	eq(f, 0)
end)

test("decide: right call on the last floor escapes", function()
	local o = Rules.decide(Config.Floors, nil, "forward")
	eq(o, "escape")
	o = Rules.decide(Config.Floors, "tixe", "back")
	eq(o, "escape")
	o = Rules.decide(Config.Floors, "tixe", "forward")
	eq(o, "wrong")
end)

test("pick: floor 0 is always normal", function()
	for _ = 1, 20 do
		eq(Rules.pick(math.random, 0, 5, {}, nil), nil)
	end
end)

test("pick: calm streak cap forces an anomaly", function()
	-- rng 0.99 would normally mean "no anomaly"
	local id = Rules.pick(seq({ 0.99, 0.5 }), 3, Config.MaxCalmStreak, {}, nil)
	assert(id ~= nil, "expected an anomaly after the calm cap")
	eq(Rules.pick(seq({ 0.99, 0.5 }), 3, 0, {}, nil), nil)
end)

test("pick: early floors skip hard anomalies, never repeat last", function()
	for i = 1, 300 do
		local r = (i - 0.5) / 300
		local id = Rules.pick(seq({ 0, r }), 1, 0, {}, "redlights")
		assert(id, "expected an id")
		assert(Config.ById[id].tier <= 2, "hard anomaly on floor 1: " .. id)
		assert(id ~= "redlights", "repeated last")
	end
end)

test("pick: unseen anomalies favoured", function()
	local found = {}
	for _, a in Config.Anomalies do
		if a.id ~= "figure" then
			found[a.id] = true
		end
	end
	local hits, n = 0, 4000
	for _ = 1, n do
		if Rules.pick(math.random, 5, Config.MaxCalmStreak, found, nil) == "figure" then
			hits += 1
		end
	end
	local expected = 2 / (#Config.Anomalies + 1)
	assert(math.abs(hits / n - expected) < 0.03, `figure rate {hits / n} vs {expected}`)
end)

test("rewards and speed bonus", function()
	eq(Rules.speedBonus(0), Config.SpeedBonusMax)
	eq(Rules.speedBonus(Config.SpeedBonusUntil * 2), 0)
	eq(Rules.escapeCoins(Config.SpeedBonusUntil, 1), Config.EscapeCoins)
	eq(Rules.escapeCoins(Config.SpeedBonusUntil, 2), Config.EscapeCoins * 2)
end)

test("titles", function()
	eq(Rules.title(0), "Intern")
	eq(Rules.title(1), "Night Clerk")
	eq(Rules.title(12), "Supervisor")
	eq(Rules.title(9999), "CEO of Nowhere")
	local n, at = Rules.nextTitle(4)
	eq(n, "Supervisor")
	eq(at, 10)
	eq(Rules.nextTitle(9999), nil)
end)

test("daily streak", function()
	local s, c = Rules.daily(-1, 0, 100)
	eq(s, 1)
	eq(c, Config.DailyBase)
	s, c = Rules.daily(99, 3, 100)
	eq(s, 4)
	eq(c, Config.DailyBase * 4)
	eq(Rules.daily(100, 3, 100), nil)
	s = Rules.daily(90, 5, 100)
	eq(s, 1)
	s = Rules.daily(99, Config.DailyStreakCap, 100)
	eq(s, Config.DailyStreakCap)
end)

test("time encoding sorts faster first and round-trips", function()
	assert(Rules.encodeTime(60) > Rules.encodeTime(61), "faster must be larger")
	eq(Rules.decodeTime(Rules.encodeTime(83.4)), 83.4)
	eq(Rules.clock(83.4), "1:23.4")
	eq(Rules.clock(5), "0:05.0")
end)

print(`{passed} passed, {failed} failed`)
if failed > 0 then
	error("tests failed")
end
