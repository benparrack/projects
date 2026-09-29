--!strict
-- Anomaly Shift tuning. Pure data: loaded by server, client and the Lune tests.

local Config = {}

Config.Floors = 8 -- a correct choice on floor 8 escapes
Config.AnomalyChance = 0.6 -- per floor after floor 0
Config.MaxCalmStreak = 2 -- never more than this many anomaly-free floors in a row
Config.EasyUntilFloor = 2 -- floors 1..2 only roll easy/medium anomalies

Config.CoinsPerFloor = 5
Config.EscapeCoins = 100
Config.SpeedBonusMax = 100 -- extra coins for a fast escape
Config.SpeedBonusUntil = 300 -- seconds; bonus falls to 0 at this run time
Config.ReviveWindow = 8 -- seconds to use a Second Chance after a mistake

Config.RadarCost = 80 -- coins
Config.ReviveCost = 150 -- coins

Config.DailyBase = 40
Config.DailyStreakCap = 7

Config.MaxPlayers = 12

-- Corridor geometry (studs, corridor-local; the player walks toward +Z).
Config.Hall = {
	width = 14,
	height = 12,
	startZ = 24, -- start room is z -4..24
	endZ = 164,
	turnZ = 150, -- the right-hand turn to the exit opens at z 150..164
	exitX = 30,
	armZ = 30, -- must walk this far in before turning back counts
	backZ = 1, -- behind this = went back
	forwardX = 24, -- past this in the turn = went forward
	spawnZ = 9,
}

export type Anomaly = {
	id: string,
	name: string, -- shown in the Index once found
	hint: string, -- shown when you walked past it
	tier: number, -- 1 easy, 2 medium, 3 hard
}

Config.Anomalies = {
	{ id = "redlights", name = "Red Alert", hint = "The lights were red.", tier = 1 },
	{ id = "flicker", name = "Bad Wiring", hint = "The lights were flickering.", tier = 1 },
	{ id = "figure", name = "The Visitor", hint = "Someone was standing at the end of the hall.", tier = 1 },
	{ id = "bigplant", name = "Overgrown", hint = "The plant was enormous.", tier = 1 },
	{ id = "wetsigns", name = "Caution Caution", hint = "There were far too many wet floor signs.", tier = 1 },
	{ id = "runner", name = "The Runner", hint = "Something ran at you. You should have turned back.", tier = 1 },
	{ id = "spinchair", name = "Restless Chair", hint = "The office chair was spinning by itself.", tier = 1 },
	{ id = "darklight", name = "Burnt Out", hint = "One of the lights was out.", tier = 2 },
	{ id = "poster", name = "New Policy", hint = "The safety poster said something different.", tier = 2 },
	{ id = "extradoor", name = "One Door Too Many", hint = "There was one door too many.", tier = 2 },
	{ id = "clock", name = "Wrong Time", hint = "The clock showed an impossible time.", tier = 2 },
	{ id = "vending", name = "Hungry Machine", hint = "The vending machine was watching you.", tier = 2 },
	{ id = "stalker", name = "Don't Look Away", hint = "Someone crept closer whenever you looked away.", tier = 2 },
	{ id = "puddle", name = "Spill", hint = "There was a red puddle on the floor.", tier = 2 },
	{ id = "drip", name = "Leak", hint = "The ceiling vent was dripping.", tier = 2 },
	{ id = "painting", name = "Upside Down", hint = "The painting was upside down.", tier = 2 },
	{ id = "cooler", name = "Bad Water", hint = "The water cooler was full of red water.", tier = 2 },
	{ id = "knocking", name = "Someone's Home", hint = "Someone was knocking on a door.", tier = 2 },
	{ id = "handprints", name = "Let Me Out", hint = "There were handprints on the wall.", tier = 2 },
	{ id = "shadow", name = "Doorway", hint = "A door was open, and something stood in it.", tier = 2 },
	{ id = "nodoor", name = "Sealed", hint = "One of the doors was missing.", tier = 3 },
	{ id = "noextinguisher", name = "Fire Hazard", hint = "The fire extinguisher was gone.", tier = 3 },
	{ id = "clockback", name = "Rewind", hint = "The clock was running backwards.", tier = 3 },
	{ id = "tixe", name = "TIXE", hint = "The exit sign was backwards.", tier = 3 },
	{ id = "roomnumber", name = "Room 666", hint = "A room number was wrong.", tier = 3 },
	{ id = "camera", name = "Watched", hint = "The security camera was following you.", tier = 3 },
	{ id = "employee", name = "Employee of the Month", hint = "The employee of the month was you.", tier = 3 },
	{ id = "longbench", name = "Sit Down", hint = "The bench had someone's shoes under it.", tier = 3 },
} :: { Anomaly }

Config.ById = {} :: { [string]: Anomaly }
for _, a in Config.Anomalies do
	Config.ById[a.id] = a
end

-- Titles by total escapes (shown over your head and on the HUD).
Config.Titles = {
	{ at = 0, name = "Intern" },
	{ at = 1, name = "Night Clerk" },
	{ at = 3, name = "Night Guard" },
	{ at = 10, name = "Supervisor" },
	{ at = 25, name = "Manager" },
	{ at = 60, name = "Director" },
	{ at = 150, name = "CEO of Nowhere" },
}

-- Robux items. 0 = not created yet on the Creator Dashboard (shop shows SOON).
Config.Passes = {
	coins2x = 2002616413, -- 2x Coins
	lucky = 2002430434, -- Lucky Badge: one free Second Chance every run
	radar = 2001494495, -- Radar Pro: one free radar ping every floor
}
Config.PassPrices = { coins2x = 149, lucky = 199, radar = 249 }

Config.Products = {
	revive = 3715479361, -- Second Chance (keep your floor)
	radar3 = 3715479430, -- 3 radar pings
	revive3 = 3715479468, -- 3 Second Chances
}
Config.ProductPrices = { revive = 25, radar3 = 39, revive3 = 59 }

return Config
