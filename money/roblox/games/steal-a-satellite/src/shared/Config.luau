--!strict
-- Steal a Satellite tuning. Pure data: loaded by server, client and the Lune tests.
-- Colors are { r, g, b } tables so this module also runs under Lune (no Color3 there).

local Config = {}

export type Rgb = { number }

export type Rarity = {
	id: string,
	name: string,
	weight: number, -- belt odds weight (see Formulas.odds)
	color: Rgb,
	lucky: boolean, -- boosted by Server Luck
}

-- Order matters: index = tier.
Config.Rarities = {
	{ id = "common", name = "Common", weight = 540, color = { 200, 205, 215 }, lucky = false },
	{ id = "uncommon", name = "Uncommon", weight = 260, color = { 90, 220, 110 }, lucky = false },
	{ id = "rare", name = "Rare", weight = 125, color = { 70, 160, 255 }, lucky = false },
	{ id = "epic", name = "Epic", weight = 52, color = { 175, 95, 255 }, lucky = true },
	{ id = "legendary", name = "Legendary", weight = 17, color = { 255, 190, 40 }, lucky = true },
	{ id = "mythic", name = "Mythic", weight = 5, color = { 255, 70, 110 }, lucky = true },
	{ id = "cosmic", name = "Cosmic", weight = 0.9, color = { 60, 240, 230 }, lucky = true },
	{ id = "secret", name = "Secret", weight = 0.1, color = { 20, 20, 30 }, lucky = true },
} :: { Rarity }

export type Shape = "box" | "can" | "dish" | "scope" | "orb" | "ring" | "crystal" | "monolith"

export type Satellite = {
	id: string,
	name: string,
	tier: number, -- index into Config.Rarities
	price: number,
	income: number, -- cash per second while it sits in your base
	shape: Shape,
	body: Rgb,
	panel: Rgb,
	scale: number,
}

-- Payback time (price / income) stretches from 15 s to 75 s up the tiers.
Config.Satellites = {
	{ id = "tincan", name = "Tin Can", tier = 1, price = 15, income = 1, shape = "can", body = { 190, 190, 200 }, panel = { 60, 90, 170 }, scale = 0.8 },
	{ id = "beeper", name = "Beeper", tier = 1, price = 30, income = 2, shape = "orb", body = { 215, 215, 225 }, panel = { 70, 70, 80 }, scale = 0.8 },
	{ id = "weatherbud", name = "Weather Buddy", tier = 1, price = 64, income = 4, shape = "box", body = { 245, 245, 250 }, panel = { 50, 110, 200 }, scale = 0.9 },
	{ id = "dishdoodle", name = "Dish Doodle", tier = 2, price = 160, income = 9, shape = "dish", body = { 230, 230, 235 }, panel = { 90, 200, 120 }, scale = 0.95 },
	{ id = "solarkite", name = "Solar Kite", tier = 2, price = 310, income = 17, shape = "box", body = { 240, 200, 60 }, panel = { 40, 80, 190 }, scale = 1 },
	{ id = "hamradio", name = "Ham Radio", tier = 2, price = 520, income = 26, shape = "can", body = { 200, 90, 60 }, panel = { 60, 60, 70 }, scale = 1 },
	{ id = "gpsnano", name = "GPS Nano", tier = 3, price = 1250, income = 52, shape = "box", body = { 70, 150, 255 }, panel = { 30, 40, 90 }, scale = 1 },
	{ id = "spyeye", name = "Spy Eye", tier = 3, price = 2600, income = 100, shape = "scope", body = { 50, 50, 60 }, panel = { 255, 60, 60 }, scale = 1.05 },
	{ id = "cometchaser", name = "Comet Chaser", tier = 3, price = 4200, income = 150, shape = "orb", body = { 120, 220, 255 }, panel = { 255, 255, 255 }, scale = 1.1 },
	{ id = "deepeye", name = "Deep Eye Telescope", tier = 4, price = 9500, income = 300, shape = "scope", body = { 225, 225, 235 }, panel = { 175, 95, 255 }, scale = 1.15 },
	{ id = "laserrelay", name = "Laser Relay", tier = 4, price = 17000, income = 500, shape = "dish", body = { 60, 20, 90 }, panel = { 255, 60, 200 }, scale = 1.15 },
	{ id = "moonmapper", name = "Moon Mapper", tier = 4, price = 27000, income = 760, shape = "ring", body = { 210, 210, 230 }, panel = { 140, 120, 255 }, scale = 1.2 },
	{ id = "quantumrelay", name = "Quantum Relay", tier = 5, price = 65000, income = 1600, shape = "crystal", body = { 255, 200, 60 }, panel = { 255, 245, 200 }, scale = 1.25 },
	{ id = "starforge", name = "Star Forge", tier = 5, price = 130000, income = 3000, shape = "ring", body = { 255, 150, 40 }, panel = { 255, 230, 120 }, scale = 1.3 },
	{ id = "dysonshard", name = "Dyson Shard", tier = 6, price = 420000, income = 8400, shape = "crystal", body = { 255, 70, 110 }, panel = { 255, 190, 210 }, scale = 1.35 },
	{ id = "galaxybrain", name = "Galaxy Brain", tier = 6, price = 950000, income = 17000, shape = "orb", body = { 255, 120, 200 }, panel = { 120, 60, 255 }, scale = 1.4 },
	{ id = "blackhole", name = "Black Hole Probe", tier = 7, price = 3200000, income = 52000, shape = "ring", body = { 15, 15, 25 }, panel = { 60, 240, 230 }, scale = 1.45 },
	{ id = "novacore", name = "Nova Core", tier = 7, price = 8500000, income = 128000, shape = "orb", body = { 60, 240, 230 }, panel = { 255, 255, 255 }, scale = 1.5 },
	{ id = "monolith", name = "The Monolith", tier = 8, price = 32000000, income = 425000, shape = "monolith", body = { 10, 10, 14 }, panel = { 255, 255, 255 }, scale = 1.6 },
} :: { Satellite }

Config.ById = {} :: { [string]: Satellite }
for _, s in Config.Satellites do
	Config.ById[s.id] = s
end

-- Economy ---------------------------------------------------------------------------------

Config.StartCash = 50
Config.BaseSlots = 8
Config.MaxSlots = 16 -- 2 rows of 8 pads per base
Config.BiggerBaseSlots = 4 -- extra pads from the Bigger Base pass
Config.SellFraction = 0.5
Config.OfflineFraction = 0.1 -- share of income paid for time away
Config.OfflineCapSeconds = 2 * 60 * 60

-- Rebirth: costs cash, wipes cash and satellites, adds income and a pad.
Config.RebirthBaseCost = 1000000
Config.RebirthGrowth = 4
Config.RebirthIncomeBonus = 0.5
Config.RebirthMaxExtraSlots = 4
Config.RebirthStartCash = 500

-- Belt --------------------------------------------------------------------------------------

Config.BeltSpawnEvery = 2.2 -- seconds
Config.BeltSpeed = 9 -- studs/s
Config.BeltLength = 360
Config.LuckMultiplier = 2 -- Server Luck doubles the weight of lucky tiers

-- Stealing ------------------------------------------------------------------------------------

Config.WalkSpeed = 24
Config.CarrySpeed = 15
Config.FastCarrySpeed = 21 -- Speedy Thief pass
Config.StealHold = 1.6 -- seconds to hold the steal prompt
Config.LockSeconds = 60
Config.ZapRange = 12
Config.ZapCooldown = 1.2
Config.StunSeconds = 1.5
Config.StunImmunity = 3

-- Space pirates squat in up to PirateBases empty bases. Their shield opens for PirateOpen seconds,
-- then locks for PirateLock; a stolen pad refills after PirateRefill seconds.
Config.PirateBases = 3
Config.PirateLoot = 6
Config.PirateOpen = 35
Config.PirateLock = 15
Config.PirateRefill = 40
-- Pirate raids: every RaidEvery seconds a drone flies to a player's base (someone with at least
-- RaidMinSats satellites and RaidGrace seconds of play, not locked) and tractor-beams up one that
-- isn't their best. Zap it on the way home to get it back plus a bounty of DroneBounty × its price.
Config.RaidEvery = 90
Config.RaidGrace = 180
Config.RaidCooldown = 300
Config.RaidMinSats = 3
Config.RaidGrab = 6
Config.DroneSpeedIn = 45
Config.DroneSpeedOut = 9
Config.DroneZapRange = 32
Config.DroneBounty = 0.05

-- Daily streak: day N pays DailyCashPerDay * min(N, cap) seconds of your income (min DailyMinCash).
Config.DailyStreakCap = 7
Config.DailyIncomeSeconds = 60
Config.DailyMinCash = 100

-- Monetization ------------------------------------------------------------------------------

export type Pass = { id: number, name: string, price: number, desc: string }
export type Product = { id: number, name: string, price: number, kind: string, amount: number }

-- ids are 0 until created on the Creator Dashboard; the shop shows those as "SOON".
Config.GamePasses = {
	x2Cash = { id = 0, name = "2x Cash", price = 199, desc = "Double income from every satellite" },
	biggerBase = { id = 0, name = "Bigger Base", price = 149, desc = "+4 satellite pads" },
	speedyThief = { id = 0, name = "Speedy Thief", price = 99, desc = "Run faster while carrying loot" },
	vip = { id = 0, name = "VIP", price = 249, desc = "+50% income, VIP tag, gold base trim" },
} :: { [string]: Pass }

Config.Products = {
	cashSmall = { id = 0, name = "+10 min of income", price = 29, kind = "incomeMinutes", amount = 10 },
	cashLarge = { id = 0, name = "+2 hours of income", price = 199, kind = "incomeMinutes", amount = 120 },
	shield = { id = 0, name = "Force Shield (10 min)", price = 39, kind = "shield", amount = 600 },
	luck = { id = 0, name = "Server Luck (15 min)", price = 79, kind = "luck", amount = 900 },
} :: { [string]: Product }

return Config
