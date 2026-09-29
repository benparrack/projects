--!strict
-- Grow a Candy Garden tuning. Pure data: loaded by server, client and the Lune tests.

-- Lune has no Color3 global; borrow the roblox library's.
local Color3 = if script then Color3 else (require :: any)("@lune/roblox").Color3

local Config = {}

Config.MaxPlayers = 6 -- one plot each
Config.StartCoins = 20

-- Garden grid (per plot). Rows unlock front to back.
Config.Cols = 8
Config.Rows = 6
Config.Tile = 5 -- studs
Config.StartRows = 2
Config.RowCosts = { 0, 0, 400, 4000, 40000, 400000 } -- cost to unlock row i

Config.RestockEvery = 300 -- seconds; the seed shop rerolls for the whole server
Config.BasketCap = 120 -- candies you can carry before selling
Config.BigBasketCap = 300
Config.HarvestRange = 36 -- studs from your character to the plant

-- Weather: a random event every WeatherEvery (± WeatherJitter) seconds.
Config.WeatherEvery = 420
Config.WeatherJitter = 120
Config.WeatherLength = 120
Config.WeatherMutationChance = 0.35 -- chance a candy harvested during weather gets its mutation

export type Seed = {
	id: string,
	name: string,
	price: number,
	grow: number, -- seconds from planting to the first ripe candy
	regrow: number?, -- nil = single harvest; else seconds between harvests
	value: number, -- sell value of an average candy
	kg: number, -- average weight
	stock: number, -- chance (0..1) it appears in a restock
	amount: { number }, -- min/max stock when it appears
	rarity: string,
	color: Color3, -- main candy colour (the Index / hotbar tint)
	order: number?, -- position in Seeds (filled in below)
}

Config.Seeds = {
	{ id = "gumdrop", name = "Gumdrop", price = 10, grow = 20, value = 18, kg = 0.4, stock = 1, amount = { 6, 14 }, rarity = "Common", color = Color3.fromRGB(255, 90, 120) },
	{ id = "candycorn", name = "Candy Corn", price = 45, grow = 45, value = 75, kg = 0.3, stock = 1, amount = { 3, 8 }, rarity = "Common", color = Color3.fromRGB(255, 170, 40) },
	{ id = "lollipop", name = "Lollipop", price = 180, grow = 90, regrow = 45, value = 55, kg = 0.6, stock = 0.8, amount = { 2, 6 }, rarity = "Uncommon", color = Color3.fromRGB(255, 80, 200) },
	{ id = "cottoncandy", name = "Cotton Candy", price = 700, grow = 150, regrow = 60, value = 170, kg = 0.9, stock = 0.6, amount = { 1, 4 }, rarity = "Rare", color = Color3.fromRGB(255, 170, 220) },
	{ id = "jellybean", name = "Jelly Bean Bush", price = 2400, grow = 240, regrow = 50, value = 330, kg = 0.2, stock = 0.45, amount = { 1, 3 }, rarity = "Rare", color = Color3.fromRGB(120, 220, 90) },
	{ id = "candycane", name = "Candy Cane", price = 9000, grow = 360, regrow = 90, value = 1150, kg = 1.1, stock = 0.3, amount = { 1, 3 }, rarity = "Epic", color = Color3.fromRGB(240, 50, 60) },
	{ id = "chocolate", name = "Chocolate Tree", price = 30000, grow = 600, regrow = 120, value = 3400, kg = 1.6, stock = 0.2, amount = { 1, 2 }, rarity = "Epic", color = Color3.fromRGB(120, 70, 40) },
	{ id = "cupcake", name = "Cupcake", price = 110000, grow = 900, regrow = 150, value = 10500, kg = 2.2, stock = 0.1, amount = { 1, 2 }, rarity = "Legendary", color = Color3.fromRGB(250, 200, 120) },
	{ id = "rainbow", name = "Rainbow Swirl", price = 420000, grow = 1500, regrow = 200, value = 36000, kg = 3, stock = 0.05, amount = { 1, 1 }, rarity = "Mythic", color = Color3.fromRGB(150, 110, 255) },
	{ id = "rockcandy", name = "Rock Candy Crystal", price = 1800000, grow = 2400, regrow = 300, value = 145000, kg = 4.5, stock = 0.02, amount = { 1, 1 }, rarity = "Divine", color = Color3.fromRGB(90, 230, 255) },
} :: { Seed }

Config.SeedById = {} :: { [string]: Seed }
for i, s in Config.Seeds do
	Config.SeedById[s.id] = s
	s.order = i
end

Config.RarityColors = {
	Common = Color3.fromRGB(200, 200, 210),
	Uncommon = Color3.fromRGB(110, 220, 110),
	Rare = Color3.fromRGB(80, 170, 255),
	Epic = Color3.fromRGB(190, 100, 255),
	Legendary = Color3.fromRGB(255, 190, 40),
	Mythic = Color3.fromRGB(255, 80, 160),
	Divine = Color3.fromRGB(90, 255, 230),
} :: { [string]: Color3 }

export type Mutation = { id: string, name: string, mult: number, color: Color3 }

-- Mutations multiply a candy's value. Golden/Rainbow can roll on any harvest; the rest
-- only come from the weather that's active when you pick the candy.
Config.Mutations = {
	{ id = "sugar", name = "Sugar-Coated", mult = 2, color = Color3.fromRGB(235, 245, 255) },
	{ id = "choco", name = "Choco-Dipped", mult = 3, color = Color3.fromRGB(110, 60, 30) },
	{ id = "frozen", name = "Frozen", mult = 4, color = Color3.fromRGB(150, 220, 255) },
	{ id = "golden", name = "Golden", mult = 20, color = Color3.fromRGB(255, 205, 50) },
	{ id = "rainbow", name = "Rainbow", mult = 50, color = Color3.fromRGB(255, 120, 220) },
} :: { Mutation }
Config.MutationById = {} :: { [string]: Mutation }
for _, m in Config.Mutations do
	Config.MutationById[m.id] = m
end
Config.GoldenChance = 0.01
Config.RainbowChance = 0.001
Config.GiantChance = 0.03 -- a "giant" candy weighs ×2.5..4

export type Weather = { id: string, name: string, blurb: string, mutation: string?, growBoost: number, rainbowBoost: number? }
Config.Weathers = {
	{ id = "sprinkles", name = "Sprinkle Rain", blurb = "Plants grow 50% faster · Sugar-Coated candy!", mutation = "sugar", growBoost = 0.5 },
	{ id = "chocostorm", name = "Chocolate Storm", blurb = "Choco-Dipped candy (x3)!", mutation = "choco", growBoost = 0 },
	{ id = "blizzard", name = "Ice Cream Blizzard", blurb = "Frozen candy (x4)!", mutation = "frozen", growBoost = 0 },
	{ id = "rainbowhour", name = "Rainbow Hour", blurb = "Rainbow candy 10x more likely!", growBoost = 0.25, rainbowBoost = 10 },
} :: { Weather }
Config.WeatherById = {} :: { [string]: Weather }
for _, w in Config.Weathers do
	Config.WeatherById[w.id] = w
end
Config.WeatherWeights = { sprinkles = 4, chocostorm = 3, blizzard = 2, rainbowhour = 1 } :: { [string]: number }

Config.DailyBase = 50
Config.DailyStreakCap = 7

-- Robux items. 0 = not created yet on the Creator Dashboard (shop shows SOON).
Config.Passes = {
	sell2x = 0, -- 2x Sell
	fastgrow = 0, -- plants grow 50% faster
	basket = 0, -- Big Basket
	vip = 0, -- +10% sell, VIP tag, rainbow trail
}
Config.PassPrices = { sell2x = 199, fastgrow = 249, basket = 99, vip = 149 }
Config.PassInfo = {
	sell2x = { name = "2x Sell", blurb = "Every candy sells for double." },
	fastgrow = { name = "Fast Grow", blurb = "Your plants grow 50% faster." },
	basket = { name = "Big Basket", blurb = "Carry 300 candies instead of 120." },
	vip = { name = "VIP", blurb = "+10% sell, VIP tag and a rainbow trail." },
}

Config.Products = {
	restock = 0, -- restock the seed shop for the whole server
	growall = 0, -- every plant in your garden ripens now
	weather = 0, -- start a random weather event for the whole server
}
Config.ProductPrices = { restock = 29, growall = 49, weather = 79 }
Config.ProductInfo = {
	restock = { name = "Restock Seeds", blurb = "A fresh seed shop for the whole server." },
	growall = { name = "Grow Everything", blurb = "Every plant in your garden ripens." },
	weather = { name = "Summon Weather", blurb = "Random weather for the whole server." },
}

return Config
