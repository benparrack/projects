-- Headless tests for +1 Jump Tower's pure logic and the shared server libs.
-- Run from money/roblox/games/jump-tower:  lune run tests/run

local Config = require("../src/shared/Config")
local Formulas = require("../src/shared/Formulas")
local TowerLayout = require("../src/shared/TowerLayout")
local SaveStore = require("../../../lib/server/SaveStore")
local Monetization = require("../../../lib/server/Monetization")

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

-- Formulas -------------------------------------------------------------------------------

test("jumpForHeight inverts jumpHeight", function()
	for _, j in { 0, 1, 50, 1234, 109350 } do
		assert(math.abs(Formulas.jumpForHeight(Formulas.jumpHeight(j)) - j) < 1e-6)
	end
end)

test("gain multiplier stacks", function()
	eq(Formulas.gainPerSecond({ rebirths = 0, x2Jump = false, vip = false, trailBonus = 0 }), 1)
	eq(Formulas.gainPerSecond({ rebirths = 2, x2Jump = true, vip = true, trailBonus = 1 }), 3 * 2 * 1.5 * 2)
end)

test("clearableZone / nextZoneNeed", function()
	eq(Formulas.clearableZone(0), 0)
	eq(Formulas.clearableZone(50), 1)
	eq(Formulas.clearableZone(449), 2)
	local need, zone = Formulas.nextZoneNeed(60)
	eq(need, 150)
	eq(zone, 2)
	eq(Formulas.nextZoneNeed(1e9), nil)
end)

test("daily streak", function()
	eq(select(2, Formulas.advanceStreak(10, 3, 10)), false, "same day")
	local s, due = Formulas.advanceStreak(10, 3, 11)
	eq(s, 4)
	eq(due, true)
	eq(Formulas.advanceStreak(10, 3, 13), 1, "broken streak resets")
	eq(Formulas.dailyWins(100), Config.DailyWinsPerDay * Config.DailyStreakCap)
end)

test("abbreviate", function()
	eq(Formulas.abbreviate(0), "0")
	eq(Formulas.abbreviate(999), "999")
	eq(Formulas.abbreviate(1234), "1,234")
	eq(Formulas.abbreviate(12345), "12.3K")
	eq(Formulas.abbreviate(1500000), "1.50M")
	eq(Formulas.abbreviate(999999), "999K")
	eq(Formulas.abbreviate(-5000), "-5,000")
end)

test("rate keeps small boosts visible", function()
	eq(Formulas.rate(1), "1")
	eq(Formulas.rate(1.25), "1.25")
	eq(Formulas.rate(2.2), "2.2")
	eq(Formulas.rate(99.999), "99.99")
	eq(Formulas.rate(12345), "12.3K")
end)

-- Tower layout ---------------------------------------------------------------------------

local pillars = TowerLayout.build()

test("pillar count and zone ends", function()
	eq(#pillars, #Config.Zones * Config.PillarsPerZone)
	for _, p in pillars do
		if p.isZoneEnd then
			eq(p.need, Config.Zones[p.zone].need, "zone end needs the zone requirement")
		end
	end
end)

test("every step is climbable with its stated requirement", function()
	for _, p in pillars do
		assert(p.rise <= Formulas.jumpHeight(p.need) + 1e-9, `pillar {p.index} too tall`)
		assert(p.rise > 0)
	end
	-- A fresh player (jump 0) can make the very first hop.
	assert(pillars[1].rise <= Formulas.jumpHeight(0))
end)

test("requirements never decrease along the spiral", function()
	for i = 2, #pillars do
		assert(pillars[i].need >= pillars[i - 1].need)
		assert(pillars[i].top > pillars[i - 1].top)
	end
end)

test("ledges hug the core, sit over the plaza, and never stack too tightly", function()
	for i, a in pillars do
		local r = math.sqrt(a.x * a.x + a.z * a.z)
		assert(math.abs(r - (Config.CoreRadius + Config.PillarSize / 2)) < 1e-6, `ledge {i} off the core`)
		assert(r + Config.PillarSize < Config.PlazaRadius, `ledge {i} not over the plaza`)
		for j = i + 1, #pillars do
			local b = pillars[j]
			local d = math.sqrt((a.x - b.x) ^ 2 + (a.z - b.z) ^ 2)
			if j == i + 1 then
				assert(d >= Config.PillarSize + Config.LedgeGap - 1e-6, `ledges {i} and {j} too close (d={d})`)
			elseif d < Config.PillarSize * math.sqrt(2) then
				-- Footprints can overlap a lap later; then there must be plenty of headroom.
				assert(b.top - a.top > 40, `ledge {j} hangs too low over ledge {i}`)
			end
		end
	end
end)

test("launch speed stays sane at the top", function()
	local v = Formulas.jumpPower(Formulas.jumpHeight(Config.Zones[#Config.Zones].need))
	assert(v < 1000, `JumpPower {v} too high`)
end)

-- SaveStore with an in-memory DataStore -------------------------------------------------

local function memoryDataStore()
	local db = {}
	return {
		db = db,
		UpdateAsync = function(_, key, fn)
			local current = db[key]
			local new = fn(current and table.clone(current) or nil)
			if new ~= nil then
				db[key] = new
			end
			return new
		end,
	}
end

local TEMPLATE = { jump = 0, wins = 0, trails = {}, receipts = {}, nested = { a = 1, b = 2 } }
local fakePlayer = { UserId = 42 }
local clock = 1000
local noWait = function() end

test("load fills template, save persists and releases", function()
	local ds = memoryDataStore()
	local store = SaveStore.new("t", TEMPLATE, { dataStore = ds, jobId = "A", wait = noWait, now = function()
		return clock
	end })
	local profile = store:attach(fakePlayer)
	assert(profile)
	eq(profile.data.jump, 0)
	profile.data.jump = 77
	store:release(fakePlayer)
	eq(ds.db.p_42.data.jump, 77)
	eq(ds.db.p_42.lock, nil, "lock released")
end)

test("reconcile adds new nested keys to old saves", function()
	local ds = memoryDataStore()
	ds.db.p_42 = { data = { jump = 5, nested = { a = 9 } } }
	local store = SaveStore.new("t", TEMPLATE, { dataStore = ds, jobId = "A", wait = noWait })
	local profile = store:attach(fakePlayer)
	assert(profile)
	eq(profile.data.jump, 5)
	eq(profile.data.nested.a, 9)
	eq(profile.data.nested.b, 2)
	assert(profile.data.receipts)
end)

test("a fresh lock from another server blocks until the last attempt, then is taken over", function()
	local ds = memoryDataStore()
	ds.db.p_42 = { data = { jump = 5 }, lock = { job = "B", time = clock } }
	local waits = 0
	local store = SaveStore.new("t", TEMPLATE, {
		dataStore = ds,
		jobId = "A",
		wait = function()
			waits += 1
		end,
		now = function()
			return clock
		end,
	})
	local profile = store:attach(fakePlayer)
	assert(profile)
	eq(waits, 4, "retried before stealing")
	eq(ds.db.p_42.lock.job, "A")
end)

test("save detects a stolen session and marks the profile lost", function()
	local ds = memoryDataStore()
	local store = SaveStore.new("t", TEMPLATE, { dataStore = ds, jobId = "A", wait = noWait })
	local profile = store:attach(fakePlayer)
	assert(profile)
	profile.data.jump = 1
	ds.db.p_42.lock = { job = "B", time = clock }
	ds.db.p_42.data = { jump = 999 }
	eq(store:saveProfile(profile), false)
	eq(profile.lost, true)
	eq(ds.db.p_42.data.jump, 999, "newer data not clobbered")
end)

test("failed load calls onFail outside Studio", function()
	local failedWith = nil
	local store = SaveStore.new("t", TEMPLATE, {
		dataStore = {
			UpdateAsync = function()
				error("throttled")
			end,
		},
		jobId = "A",
		wait = noWait,
		onFail = function(_, reason)
			failedWith = reason
		end,
	})
	eq(store:attach(fakePlayer), nil)
	assert(failedWith and string.find(failedWith, "throttled"))
end)

-- Monetization receipts -----------------------------------------------------------------

test("receipts grant exactly once", function()
	local ds = memoryDataStore()
	local store = SaveStore.new("t", TEMPLATE, { dataStore = ds, jobId = "A", wait = noWait })
	local profile = store:attach(fakePlayer)
	assert(profile)
	local grants = 0
	local m = Monetization.new({
		store = store,
		passes = {},
		products = {
			[111] = function(_, prof)
				grants += 1
				prof.data.jump += 100
				return true
			end,
		},
		getPlayer = function(id)
			return if id == 42 then fakePlayer else nil
		end,
		decisions = { Granted = "G", NotProcessedYet = "N" },
	})
	local receipt = { PlayerId = 42, ProductId = 111, PurchaseId = "abc" }
	eq(m:processReceipt(receipt), "G")
	eq(m:processReceipt(receipt), "G")
	eq(grants, 1)
	eq(ds.db.p_42.data.jump, 100, "grant saved before confirming")
	eq(m:processReceipt({ PlayerId = 7, ProductId = 111, PurchaseId = "x" }), "N", "player offline")
	eq(m:processReceipt({ PlayerId = 42, ProductId = 999, PurchaseId = "y" }), "N", "unknown product")
end)

print(`{passed} passed, {failed} failed`)
if failed > 0 then
	error("tests failed")
end
