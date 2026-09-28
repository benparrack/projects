--!strict
-- All tunable numbers for +1 Jump Tower live here.
-- Colors are {r, g, b} arrays (not Color3) so this module also loads under Lune for tests.

export type Pass = { id: number, name: string, price: number, desc: string }
export type Product = { id: number, name: string, price: number, kind: string, amount: number }

local Config = {}

-- Jump stat gained per second before multipliers.
Config.BaseGainPerSecond = 1

-- Each zone: the Jump stat needed to clear it, and the Wins its pad pays out.
Config.Zones = {
	{ name = "Meadow", need = 50, wins = 1, color = { 110, 220, 120 } },
	{ name = "Canyon", need = 150, wins = 3, color = { 240, 170, 80 } },
	{ name = "Glacier", need = 450, wins = 8, color = { 120, 210, 255 } },
	{ name = "Jungle", need = 1350, wins = 20, color = { 60, 190, 110 } },
	{ name = "Volcano", need = 4050, wins = 50, color = { 255, 90, 60 } },
	{ name = "Clouds", need = 12150, wins = 120, color = { 235, 235, 255 } },
	{ name = "Aurora", need = 36450, wins = 300, color = { 170, 110, 255 } },
	{ name = "Space", need = 109350, wins = 800, color = { 255, 220, 90 } },
}

-- Per-zone look. The client blends Lighting between these by altitude (see Altitude.client).
-- clock = ClockTime, sky/decay = Atmosphere Color/Decay, haze/density = Atmosphere, ambient = OutdoorAmbient,
-- ledge/core = materials, deco = scenery kind built around the tower (see World.decorate).
Config.Themes = {
	{ clock = 14.5, sky = { 200, 225, 255 }, decay = { 110, 140, 190 }, density = 0.3, haze = 1.2, ambient = { 140, 140, 160 }, ledge = "Grass", core = "Cobblestone", deco = "meadow" },
	{ clock = 16.2, sky = { 255, 205, 150 }, decay = { 190, 110, 70 }, density = 0.32, haze = 1.6, ambient = { 170, 130, 110 }, ledge = "Sandstone", core = "Sandstone", deco = "canyon" },
	{ clock = 12, sky = { 205, 235, 255 }, decay = { 120, 170, 220 }, density = 0.36, haze = 2, ambient = { 150, 170, 200 }, ledge = "Ice", core = "Glacier", deco = "glacier" },
	{ clock = 10.5, sky = { 185, 235, 185 }, decay = { 60, 130, 90 }, density = 0.34, haze = 1.8, ambient = { 110, 150, 110 }, ledge = "LeafyGrass", core = "Rock", deco = "jungle" },
	{ clock = 18.1, sky = { 255, 150, 100 }, decay = { 120, 30, 20 }, density = 0.4, haze = 2.4, ambient = { 170, 90, 70 }, ledge = "Basalt", core = "Basalt", deco = "volcano" },
	{ clock = 13, sky = { 255, 255, 255 }, decay = { 190, 210, 255 }, density = 0.3, haze = 0.6, ambient = { 190, 190, 215 }, ledge = "Snow", core = "Marble", deco = "clouds" },
	{ clock = 20.4, sky = { 150, 110, 255 }, decay = { 40, 180, 170 }, density = 0.22, haze = 0.4, ambient = { 110, 90, 170 }, ledge = "Glass", core = "Slate", deco = "aurora" },
	{ clock = 0, sky = { 30, 20, 60 }, decay = { 10, 10, 30 }, density = 0.05, haze = 0, ambient = { 120, 110, 160 }, ledge = "Foil", core = "DiamondPlate", deco = "space" },
}

Config.PillarsPerZone = 5
-- The tower is a central core with square ledges spiralling up around it.
Config.CoreRadius = 34
Config.PillarSize = 20 -- ledge top face is PillarSize x PillarSize studs
Config.LedgeGap = 5 -- horizontal gap between consecutive ledges' edges
Config.PlazaRadius = 110
Config.SpawnPoint = { 0, 4, 80 } -- on the plaza ring, facing the core
-- Each step's rise is at most this fraction of the zone's full jump height, so the requirement shown is never tighter than the real one.
Config.StepSlack = 0.92
-- ...minus this many studs, so the small early hops aren't pixel-perfect.
Config.StepMargin = 3

Config.Gravity = 196.2
Config.WalkSpeed = 22

-- Rebirth: costs Jump, resets it to 0, and adds +1x to the gain multiplier.
Config.RebirthBaseCost = 300

-- Playtime gifts: one every GiftInterval seconds, up to GiftsPerSession per session.
Config.GiftInterval = 5 * 60
Config.GiftsPerSession = 8

-- Daily streak: day N pays DailyWinsPerDay * min(N, DailyStreakCap) wins.
Config.DailyWinsPerDay = 5
Config.DailyStreakCap = 7

-- Trails are bought with Wins and add a permanent gain bonus while equipped.
Config.Trails = {
	{ id = "spark", name = "Spark", cost = 5, bonus = 0.10, colors = { { 255, 255, 255 }, { 255, 230, 120 } } },
	{ id = "mint", name = "Mint", cost = 25, bonus = 0.25, colors = { { 120, 255, 200 }, { 40, 160, 255 } } },
	{ id = "ember", name = "Ember", cost = 100, bonus = 0.50, colors = { { 255, 200, 60 }, { 255, 40, 40 } } },
	{ id = "galaxy", name = "Galaxy", cost = 400, bonus = 1.00, colors = { { 120, 80, 255 }, { 255, 80, 220 } } },
	{ id = "rainbow", name = "Rainbow", cost = 1500, bonus = 2.00, colors = { { 255, 60, 60 }, { 60, 120, 255 } } },
	{ id = "vip", name = "VIP Gold", cost = -1, bonus = 0.50, colors = { { 255, 215, 0 }, { 255, 255, 200 } } }, -- VIP pass only
}

-- Monetization. Ids are 0 until the pass/product is created on the Roblox dashboard;
-- items with id 0 are hidden from the shop.
Config.GamePasses = {
	x2Jump = { id = 0, name = "2x Jump", price = 149, desc = "Double Jump gain forever" },
	x2Wins = { id = 0, name = "2x Wins", price = 99, desc = "Double Wins from every pad" },
	vip = { id = 0, name = "VIP", price = 249, desc = "+50% Jump gain, gold trail, VIP tag" },
} :: { [string]: Pass }

Config.Products = {
	boostSmall = { id = 0, name = "+5 min of Jump", price = 25, kind = "jumpMinutes", amount = 5 },
	boostLarge = { id = 0, name = "+60 min of Jump", price = 149, kind = "jumpMinutes", amount = 60 },
	skipZone = { id = 0, name = "Skip a Zone", price = 49, kind = "skipZone", amount = 1 },
} :: { [string]: Product }

return Config
