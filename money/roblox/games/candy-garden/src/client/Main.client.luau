--!strict
-- Grow a Candy Garden HUD: coins + basket, teleports, weather + restock timers, the seed
-- hotbar and click/drag planting + harvesting, the Seed Shop, Index, Robux shop, tutorial
-- hints, plant hover info and toasts.

local HttpService = game:GetService("HttpService")
local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Rules = require(Shared:WaitForChild("Rules"))
local PlantModel = require(Shared:WaitForChild("PlantModel"))
local Ui = require(script.Parent:WaitForChild("Ui"))
local Sfx = require(script.Parent:WaitForChild("Sfx"))

local player = Players.LocalPlayer
local remotes = ReplicatedStorage:WaitForChild("Remotes")
local action = remotes:WaitForChild("Action") :: RemoteEvent
local notifyRemote = remotes:WaitForChild("Notify") :: RemoteEvent
local fxRemote = remotes:WaitForChild("Fx") :: RemoteEvent

local C = Ui.Colors
local PINK = Color3.fromRGB(255, 110, 180)
local MINT = Color3.fromRGB(70, 210, 150)
local GOLD = C.gold

local gui = Ui.new("ScreenGui", {
	Name = "Hud",
	ResetOnSpawn = false,
	IgnoreGuiInset = true,
	ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
	Parent = player:WaitForChild("PlayerGui"),
})

local function tween(inst: Instance, t: number, props: { [string]: any }, style: Enum.EasingStyle?, dir: Enum.EasingDirection?)
	local tw = TweenService:Create(inst, TweenInfo.new(t, style or Enum.EasingStyle.Quad, dir or Enum.EasingDirection.Out), props)
	tw:Play()
	return tw
end

local function decode(attr: string): { [string]: any }
	local raw = player:GetAttribute(attr)
	if typeof(raw) ~= "string" or raw == "" then
		return {}
	end
	local ok, t = pcall(HttpService.JSONDecode, HttpService, raw)
	return if ok and typeof(t) == "table" then t else {}
end

local function serverNow(): number
	return Workspace:GetServerTimeNow()
end

-- A little 3D candy in a ViewportFrame (shop rows, hotbar, Index).
local function candyView(parent: Instance, seedId: string, props: { [string]: any }, mut: string?): ViewportFrame
	local vp = Ui.new("ViewportFrame", {
		BackgroundTransparency = 1,
		Ambient = Color3.fromRGB(200, 190, 210),
		LightColor = Color3.fromRGB(255, 250, 240),
		LightDirection = Vector3.new(-1, -1.5, -1),
	})
	for k, v in props do
		(vp :: any)[k] = v
	end
	local m = PlantModel.candy(seedId, CFrame.new(), mut)
	m.Parent = vp
	local cf, size = m:GetBoundingBox()
	local r = math.max(size.X, size.Y, size.Z)
	local cam = Instance.new("Camera")
	cam.FieldOfView = 30
	cam.CFrame = CFrame.lookAt(cf.Position + Vector3.new(0.6, 0.45, -1).Unit * r * 2.2, cf.Position)
	cam.Parent = vp
	vp.CurrentCamera = cam
	vp.Parent = parent
	return vp
end

local function silhouette(vp: ViewportFrame, on: boolean)
	vp.ImageColor3 = if on then Color3.new(0, 0, 0) else Color3.new(1, 1, 1)
	vp.ImageTransparency = if on then 0.3 else 0
end

-- Panels ---------------------------------------------------------------------------------------

local openPanel: Frame? = nil
local function panel(name: string, size: UDim2, title: string, color: Color3): (Frame, Frame)
	local p = Ui.new("Frame", {
		Name = name,
		Size = size,
		Position = UDim2.fromScale(0.5, 0.5),
		AnchorPoint = Vector2.new(0.5, 0.5),
		BackgroundColor3 = C.panel,
		Visible = false,
		ZIndex = 20,
		Parent = gui,
	}, {
		Ui.corner(18),
		Ui.stroke(Color3.fromRGB(255, 255, 255), 4),
		Ui.gradient(C.panelLight, C.panel),
		Ui.new("UISizeConstraint", { MaxSize = Vector2.new(760, 580) }),
	})
	local header = Ui.new("Frame", { Size = UDim2.new(1, 0, 0, 58), BackgroundColor3 = color, ZIndex = 21, Parent = p }, {
		Ui.corner(18),
		Ui.gradient(color:Lerp(Color3.new(1, 1, 1), 0.2), color),
	})
	-- square off the header's bottom corners
	Ui.new("Frame", { Size = UDim2.new(1, 0, 0, 18), Position = UDim2.new(0, 0, 1, -18), BackgroundColor3 = color, BorderSizePixel = 0, ZIndex = 21, Parent = header })
	Ui.label({ Text = title, Size = UDim2.new(1, -90, 0, 40), Position = UDim2.fromOffset(20, 9), TextXAlignment = Enum.TextXAlignment.Left, ZIndex = 22, Parent = header })
	Ui.button({ Text = "X", Size = UDim2.fromOffset(42, 42), Position = UDim2.new(1, -52, 0, 8), ZIndex = 23, Parent = p }, C.red, function()
		p.Visible = false
		openPanel = nil
	end)
	local body = Ui.new("Frame", { Size = UDim2.new(1, -32, 1, -78), Position = UDim2.fromOffset(16, 68), BackgroundTransparency = 1, ZIndex = 21, Parent = p })
	return p, body
end

local function toggle(p: Frame, force: boolean?)
	if openPanel and openPanel ~= p then
		openPanel.Visible = false
	end
	p.Visible = if force ~= nil then force else not p.Visible
	openPanel = if p.Visible then p else nil
	if p.Visible then
		Ui.pop(p, 0.85)
	end
end

-- Toasts -----------------------------------------------------------------------------------------

local toastList = Ui.new("Frame", {
	Size = UDim2.fromOffset(480, 220),
	Position = UDim2.new(0.5, 0, 0, 158),
	AnchorPoint = Vector2.new(0.5, 0),
	BackgroundTransparency = 1,
	ZIndex = 40,
	Parent = gui,
}, { Ui.new("UIListLayout", { Padding = UDim.new(0, 6), HorizontalAlignment = Enum.HorizontalAlignment.Center }) })

local function toast(text: string, kind: string?)
	local color = if kind == "error" then Color3.fromRGB(255, 120, 120) elseif kind == "reward" then Color3.fromRGB(120, 255, 150) elseif kind == "big" then GOLD else C.text
	local t = Ui.label({
		Text = text,
		Size = UDim2.new(1, 0, 0, 34),
		TextColor3 = color,
		BackgroundTransparency = 0.2,
		BackgroundColor3 = Color3.fromRGB(60, 20, 60),
		ZIndex = 41,
		Parent = toastList,
	})
	Ui.new("UIPadding", { PaddingLeft = UDim.new(0, 12), PaddingRight = UDim.new(0, 12), PaddingTop = UDim.new(0, 5), PaddingBottom = UDim.new(0, 5), Parent = t })
	Ui.corner(17).Parent = t
	Ui.pop(t, 0.8)
	if kind == "error" then
		Sfx.play("click", 0.4, 0.6)
	elseif kind == "reward" then
		Sfx.play("reward", 0.5)
	end
	task.delay(3.2, function()
		tween(t, 0.3, { TextTransparency = 1, BackgroundTransparency = 1 })
		task.wait(0.3)
		t:Destroy()
	end)
end
notifyRemote.OnClientEvent:Connect(toast)

-- Top-left: coins + basket -------------------------------------------------------------------------

local stats = Ui.new("Frame", {
	Size = UDim2.fromOffset(230, 104),
	Position = UDim2.fromOffset(16, 64),
	BackgroundTransparency = 1,
	Parent = gui,
}, { Ui.new("UIListLayout", { Padding = UDim.new(0, 8) }) })
local function pill(color: Color3): (Frame, TextLabel)
	local f = Ui.new("Frame", { Size = UDim2.fromOffset(230, 46), BackgroundColor3 = Color3.fromRGB(60, 20, 60), BackgroundTransparency = 0.25, Parent = stats }, {
		Ui.corner(23),
		Ui.stroke(color, 3),
	})
	local l = Ui.label({ Text = "", Size = UDim2.new(1, -24, 1, -12), Position = UDim2.fromOffset(14, 6), TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = color, Parent = f })
	return f, l
end
local coinPill, coinLabel = pill(GOLD)
local basketPill, basketLabel = pill(Color3.fromRGB(255, 170, 220))

-- Top center: teleports, weather, restock --------------------------------------------------------

local top = Ui.new("Frame", {
	Size = UDim2.fromOffset(420, 52),
	Position = UDim2.new(0.5, 0, 0, 10),
	AnchorPoint = Vector2.new(0.5, 0),
	BackgroundTransparency = 1,
	Parent = gui,
}, { Ui.new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 10), HorizontalAlignment = Enum.HorizontalAlignment.Center }) })

local shopPanel, shopBody = panel("SeedShop", UDim2.fromScale(0.6, 0.76), "🌱 SEED SHOP", Color3.fromRGB(70, 190, 100))
local indexPanel, indexBody = panel("Index", UDim2.fromScale(0.62, 0.72), "📖 CANDY INDEX", Color3.fromRGB(120, 90, 230))
local robuxPanel, robuxBody = panel("Store", UDim2.fromScale(0.56, 0.72), "⭐ SWEET STORE", Color3.fromRGB(240, 170, 40))

Ui.button({ Name = "Garden", Text = "🏡 Garden", Size = UDim2.fromOffset(130, 48), Parent = top }, Color3.fromRGB(110, 190, 80), function()
	action:FireServer("teleport", "garden")
end)
Ui.button({ Name = "Seeds", Text = "🌱 Seeds", Size = UDim2.fromOffset(130, 48), Parent = top }, MINT, function()
	action:FireServer("teleport", "seeds")
	toggle(shopPanel, true)
end)
Ui.button({ Name = "Sell", Text = "💰 Sell", Size = UDim2.fromOffset(130, 48), Parent = top }, PINK, function()
	action:FireServer("teleport", "sell")
	task.delay(0.25, function()
		action:FireServer("sell")
	end)
end)

local weatherBox = Ui.new("Frame", {
	Size = UDim2.fromOffset(380, 58),
	Position = UDim2.new(0.5, 0, 0, 70),
	AnchorPoint = Vector2.new(0.5, 0),
	BackgroundColor3 = Color3.fromRGB(60, 20, 60),
	BackgroundTransparency = 0.2,
	Visible = false,
	Parent = gui,
}, { Ui.corner(16), Ui.stroke(Color3.new(1, 1, 1), 3) })
local weatherTitle = Ui.label({ Text = "", Size = UDim2.new(1, -20, 0, 30), Position = UDim2.fromOffset(10, 4), Parent = weatherBox })
local weatherSub = Ui.label({ Text = "", Size = UDim2.new(1, -20, 0, 18), Position = UDim2.fromOffset(10, 34), TextColor3 = C.muted, Parent = weatherBox })

local WEATHER_ICON = { sprinkles = "🌈", chocostorm = "🍫", blizzard = "❄️", rainbowhour = "🌟" }
local WEATHER_COLOR = {
	sprinkles = Color3.fromRGB(255, 150, 210),
	chocostorm = Color3.fromRGB(170, 100, 60),
	blizzard = Color3.fromRGB(150, 220, 255),
	rainbowhour = Color3.fromRGB(255, 220, 90),
}

-- Right side buttons --------------------------------------------------------------------------------

local side = Ui.new("Frame", {
	Size = UDim2.fromOffset(150, 240),
	Position = UDim2.new(1, -16, 0.5, -30),
	AnchorPoint = Vector2.new(1, 0.5),
	BackgroundTransparency = 1,
	Parent = gui,
}, { Ui.new("UIListLayout", { Padding = UDim.new(0, 10), HorizontalAlignment = Enum.HorizontalAlignment.Right, VerticalAlignment = Enum.VerticalAlignment.Center, SortOrder = Enum.SortOrder.LayoutOrder }) })
Ui.button({ Name = "StoreButton", Text = "⭐ Store", Size = UDim2.fromOffset(140, 50), LayoutOrder = 1, Parent = side }, Color3.fromRGB(240, 170, 40), function()
	toggle(robuxPanel)
end)
Ui.button({ Name = "IndexButton", Text = "📖 Index", Size = UDim2.fromOffset(140, 50), LayoutOrder = 2, Parent = side }, Color3.fromRGB(120, 90, 230), function()
	toggle(indexPanel)
end)
local restockLabel = Ui.label({ Text = "", Size = UDim2.fromOffset(150, 40), LayoutOrder = 3, TextColor3 = Color3.fromRGB(190, 255, 200), Parent = side })

-- Seed Shop ----------------------------------------------------------------------------------------

local function robuxPrompt(kind: "pass" | "product", id: number)
	if id == 0 then
		toast("Coming soon!", "info")
		return
	end
	if kind == "pass" then
		MarketplaceService:PromptGamePassPurchase(player, id)
	else
		MarketplaceService:PromptProductPurchase(player, id)
	end
end

local shopTimer = Ui.label({ Text = "", Size = UDim2.new(0.6, 0, 0, 28), TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = C.muted, ZIndex = 22, Parent = shopBody })
Ui.button({ Text = `R$ {Config.ProductPrices.restock} Restock Now`, Size = UDim2.new(0.38, 0, 0, 34), Position = UDim2.new(0.62, 0, 0, -3), ZIndex = 22, Parent = shopBody }, Color3.fromRGB(60, 170, 90), function()
	robuxPrompt("product", Config.Products.restock)
end)
local seedList = Ui.new("ScrollingFrame", {
	Size = UDim2.new(1, 0, 1, -40),
	Position = UDim2.fromOffset(0, 40),
	BackgroundTransparency = 1,
	ScrollBarThickness = 6,
	AutomaticCanvasSize = Enum.AutomaticSize.Y,
	CanvasSize = UDim2.new(),
	ZIndex = 21,
	Parent = shopBody,
}, { Ui.new("UIListLayout", { Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder }) })

type SeedRow = { frame: Frame, stock: TextLabel, buy: TextButton, view: ViewportFrame }
local seedRows: { [string]: SeedRow } = {}
for i, seed in Config.Seeds do
	local rc = Config.RarityColors[seed.rarity]
	local row = Ui.new("Frame", { Size = UDim2.new(1, -10, 0, 78), BackgroundColor3 = C.panelLight, LayoutOrder = i, ZIndex = 21, Parent = seedList }, {
		Ui.corner(14),
		Ui.stroke(rc, 2),
	})
	local view = candyView(row, seed.id, { Size = UDim2.fromOffset(66, 66), Position = UDim2.fromOffset(8, 6), ZIndex = 22 })
	Ui.label({ Text = seed.name, Size = UDim2.new(1, -250, 0, 28), Position = UDim2.fromOffset(84, 8), TextXAlignment = Enum.TextXAlignment.Left, ZIndex = 22, Parent = row })
	local growText = if seed.regrow then `grows {Rules.clock(seed.grow)} · regrows {Rules.clock(seed.regrow)}` else `grows {Rules.clock(seed.grow)} · one harvest`
	Ui.label({ Text = `{seed.rarity} · {growText}`, Size = UDim2.new(1, -250, 0, 18), Position = UDim2.fromOffset(84, 36), TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = rc, ZIndex = 22, Parent = row })
	local stock = Ui.label({ Text = "", Size = UDim2.new(1, -250, 0, 16), Position = UDim2.fromOffset(84, 56), TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = C.muted, ZIndex = 22, Parent = row })
	local buy = Ui.button({ Text = `💰{Rules.short(seed.price)}`, Size = UDim2.fromOffset(140, 50), Position = UDim2.new(1, -152, 0.5, -25), ZIndex = 22, Parent = row }, Color3.fromRGB(70, 190, 100), function()
		action:FireServer("buy", seed.id)
	end)
	seedRows[seed.id] = { frame = row, stock = stock, buy = buy, view = view }
end

local function refreshShop()
	local stock = {}
	local raw = Workspace:GetAttribute("Stock")
	if typeof(raw) == "string" then
		local ok, t = pcall(HttpService.JSONDecode, HttpService, raw)
		if ok then
			stock = t
		end
	end
	local bought = decode("Bought")
	local owned = decode("Seeds")
	local coins = player:GetAttribute("Coins") or 0
	for id, r in seedRows do
		local left = (stock[id] or 0) - (bought[id] or 0)
		local have = owned[id] or 0
		local haveText = if have > 0 then ` · you have {have}` else ""
		if left > 0 then
			r.stock.Text = `x{left} in stock{haveText}`
			r.stock.TextColor3 = Color3.fromRGB(190, 255, 200)
			r.buy.Active = true
			r.buy.AutoButtonColor = false
			r.buy.TextTransparency = if coins >= Config.SeedById[id].price then 0 else 0.45
			r.frame.BackgroundTransparency = 0
			silhouette(r.view, false)
		else
			r.stock.Text = `NO STOCK{haveText}`
			r.stock.TextColor3 = Color3.fromRGB(255, 140, 140)
			r.buy.TextTransparency = 0.6
			r.frame.BackgroundTransparency = 0.35
			silhouette(r.view, false)
		end
	end
end

-- Robux store ---------------------------------------------------------------------------------------

local storeList = Ui.new("ScrollingFrame", {
	Size = UDim2.fromScale(1, 1),
	BackgroundTransparency = 1,
	ScrollBarThickness = 6,
	AutomaticCanvasSize = Enum.AutomaticSize.Y,
	CanvasSize = UDim2.new(),
	ZIndex = 21,
	Parent = robuxBody,
}, { Ui.new("UIListLayout", { Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder }) })

local passButtons: { [string]: TextButton } = {}
local function storeRow(order: number, icon: string, name: string, desc: string, price: string, color: Color3, onBuy: () -> ()): TextButton
	local row = Ui.new("Frame", { Size = UDim2.new(1, -10, 0, 70), BackgroundColor3 = C.panelLight, LayoutOrder = order, ZIndex = 21, Parent = storeList }, { Ui.corner(14) })
	Ui.label({ Text = icon, Size = UDim2.fromOffset(50, 50), Position = UDim2.fromOffset(10, 10), ZIndex = 22, Parent = row })
	Ui.label({ Text = name, Size = UDim2.new(1, -210, 0, 28), Position = UDim2.fromOffset(70, 8), TextXAlignment = Enum.TextXAlignment.Left, ZIndex = 22, Parent = row })
	Ui.label({ Text = desc, Size = UDim2.new(1, -210, 0, 20), Position = UDim2.fromOffset(70, 40), TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = C.muted, ZIndex = 22, Parent = row })
	return Ui.button({ Text = price, Size = UDim2.fromOffset(120, 46), Position = UDim2.new(1, -132, 0.5, -23), ZIndex = 22, Parent = row }, color, onBuy)
end
Ui.label({ Text = "Game Passes", Size = UDim2.new(1, 0, 0, 26), TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = GOLD, LayoutOrder = 0, ZIndex = 22, Parent = storeList })
local PASS_ICON = { sell2x = "💰", fastgrow = "⚡", basket = "🧺", vip = "⭐" }
for i, key in { "sell2x", "fastgrow", "basket", "vip" } do
	local info = Config.PassInfo[key]
	passButtons[key] = storeRow(i, PASS_ICON[key], info.name, info.blurb, `R$ {Config.PassPrices[key]}`, Color3.fromRGB(60, 170, 90), function()
		robuxPrompt("pass", Config.Passes[key])
	end)
end
Ui.label({ Text = "Boosts", Size = UDim2.new(1, 0, 0, 26), TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = MINT, LayoutOrder = 10, ZIndex = 22, Parent = storeList })
local PRODUCT_ICON = { restock = "🌱", growall = "✨", weather = "⛅" }
for i, key in { "growall", "weather", "restock" } do
	local info = Config.ProductInfo[key]
	storeRow(10 + i, PRODUCT_ICON[key], info.name, info.blurb, `R$ {Config.ProductPrices[key]}`, Color3.fromRGB(70, 150, 255), function()
		robuxPrompt("product", Config.Products[key])
	end)
end
local function refreshPasses()
	for key, b in passButtons do
		if player:GetAttribute("Pass_" .. key) then
			b.Text = "OWNED"
			b.Active = false
		end
	end
end
player.AttributeChanged:Connect(function(name)
	if string.sub(name, 1, 5) == "Pass_" then
		refreshPasses()
	end
end)

-- Index -----------------------------------------------------------------------------------------

local indexCount = Ui.label({ Text = "", Size = UDim2.new(1, 0, 0, 26), TextColor3 = C.muted, ZIndex = 22, Parent = indexBody })
local grid = Ui.new("ScrollingFrame", {
	Size = UDim2.new(1, 0, 1, -60),
	Position = UDim2.fromOffset(0, 34),
	BackgroundTransparency = 1,
	ScrollBarThickness = 6,
	AutomaticCanvasSize = Enum.AutomaticSize.Y,
	CanvasSize = UDim2.new(),
	ZIndex = 21,
	Parent = indexBody,
}, { Ui.new("UIGridLayout", { CellSize = UDim2.new(0.25, -12, 0, 168), CellPadding = UDim2.fromOffset(10, 10), SortOrder = Enum.SortOrder.LayoutOrder }) })
type IndexCard = { view: ViewportFrame, name: TextLabel, dots: { [string]: Frame } }
local cards: { [string]: IndexCard } = {}
for i, seed in Config.Seeds do
	local rc = Config.RarityColors[seed.rarity]
	local f = Ui.new("Frame", { BackgroundColor3 = C.panelLight, LayoutOrder = i, ZIndex = 22, Parent = grid }, { Ui.corner(12), Ui.stroke(rc, 2) })
	local view = candyView(f, seed.id, { Size = UDim2.new(1, -20, 0, 90), Position = UDim2.fromOffset(10, 6), ZIndex = 23 })
	local name = Ui.label({ Text = "???", Size = UDim2.new(1, -12, 0, 22), Position = UDim2.fromOffset(6, 98), ZIndex = 23, Parent = f })
	Ui.label({ Text = seed.rarity, Size = UDim2.new(1, -12, 0, 16), Position = UDim2.fromOffset(6, 120), TextColor3 = rc, ZIndex = 23, Parent = f })
	local dotRow = Ui.new("Frame", { Size = UDim2.new(1, -12, 0, 16), Position = UDim2.fromOffset(6, 142), BackgroundTransparency = 1, ZIndex = 23, Parent = f }, {
		Ui.new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 5), HorizontalAlignment = Enum.HorizontalAlignment.Center }),
	})
	local dots = {}
	for _, m in Config.Mutations do
		dots[m.id] = Ui.new("Frame", { Size = UDim2.fromOffset(14, 14), BackgroundColor3 = m.color, BackgroundTransparency = 0.85, ZIndex = 24, Parent = dotRow }, { Ui.corner(7), Ui.stroke(Color3.new(0, 0, 0), 1) })
	end
	cards[seed.id] = { view = view, name = name, dots = dots }
end
do
	local parts = {}
	for _, m in Config.Mutations do
		local c = if m.id == "choco" then Color3.fromRGB(215, 150, 95) else m.color
		table.insert(parts, `<font color="#{c:ToHex()}">{m.name} x{m.mult}</font>`)
	end
	Ui.label({
		Text = table.concat(parts, "   "),
		RichText = true,
		Size = UDim2.new(1, 0, 0, 20),
		Position = UDim2.new(0, 0, 1, -22),
		TextColor3 = C.muted,
		ZIndex = 22,
		Parent = indexBody,
	})
end

local function refreshIndex()
	local found = {}
	local raw = player:GetAttribute("Found")
	if typeof(raw) == "string" then
		for _, k in string.split(raw, ",") do
			found[k] = true
		end
	end
	local n = 0
	for id, card in cards do
		local seen = found[id] == true
		if seen then
			n += 1
		end
		silhouette(card.view, not seen)
		card.name.Text = if seen then Config.SeedById[id].name else "???"
		for mid, dot in card.dots do
			dot.BackgroundTransparency = if found[`{id}:{mid}`] then 0 else 0.85
		end
	end
	indexCount.Text = `{n}/{#Config.Seeds} candies discovered`
end

-- Hotbar -----------------------------------------------------------------------------------------

local selected: string? = nil -- seed id, "shovel" or nil (harvest)
local hotbar = Ui.new("Frame", {
	Size = UDim2.new(1, -40, 0, 88),
	Position = UDim2.new(0.5, 0, 1, -14),
	AnchorPoint = Vector2.new(0.5, 1),
	BackgroundTransparency = 1,
	Parent = gui,
}, { Ui.new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 8), HorizontalAlignment = Enum.HorizontalAlignment.Center, VerticalAlignment = Enum.VerticalAlignment.Bottom, SortOrder = Enum.SortOrder.LayoutOrder }) })

type Slot = { button: TextButton, count: TextLabel, stroke: UIStroke }
local slots: { [string]: Slot } = {}
local modeLabel = Ui.label({ Text = "", Size = UDim2.fromOffset(500, 26), Position = UDim2.new(0.5, 0, 1, -110), AnchorPoint = Vector2.new(0.5, 1), TextColor3 = Color3.new(1, 1, 1), Parent = gui })

local function refreshSelection()
	for id, s in slots do
		local on = selected == id
		s.stroke.Color = if on then Color3.fromRGB(255, 240, 120) else Color3.new(1, 1, 1)
		s.stroke.Thickness = if on then 5 else 2
		tween(s.button, 0.12, { Position = UDim2.fromOffset(0, if on then -8 else 0) })
	end
	if selected == "shovel" then
		modeLabel.Text = "🪓 Click a plant to dig it up"
	elseif selected then
		modeLabel.Text = `🌱 Click the soil to plant {Config.SeedById[selected].name}`
	else
		modeLabel.Text = ""
	end
end

local function slotButton(id: string, order: number, color: Color3): Slot
	local holder = Ui.new("Frame", { Size = UDim2.fromOffset(78, 78), BackgroundTransparency = 1, LayoutOrder = order, Parent = hotbar })
	local b = Ui.new("TextButton", {
		Size = UDim2.fromScale(1, 1),
		BackgroundColor3 = Color3.fromRGB(60, 20, 60),
		BackgroundTransparency = 0.15,
		Text = "",
		AutoButtonColor = false,
		Parent = holder,
	}, { Ui.corner(16) })
	local stroke = Ui.new("UIStroke", { Color = Color3.new(1, 1, 1), Thickness = 2, ApplyStrokeMode = Enum.ApplyStrokeMode.Border, Parent = b })
	Ui.new("Frame", { Size = UDim2.new(1, -12, 0, 5), Position = UDim2.new(0, 6, 1, -9), BackgroundColor3 = color, BorderSizePixel = 0, Parent = b }, { Ui.corner(3) })
	local count = Ui.label({ Text = "", Size = UDim2.fromOffset(40, 22), Position = UDim2.new(1, -44, 0, 2), TextXAlignment = Enum.TextXAlignment.Right, TextColor3 = Color3.new(1, 1, 1), ZIndex = 3, Parent = b })
	b.Activated:Connect(function()
		selected = if selected == id then nil else id
		Sfx.play("click", 0.4, 1.2)
		refreshSelection()
	end)
	local s = { button = b, count = count, stroke = stroke }
	slots[id] = s
	return s
end

do
	local harvest = Ui.button({ Name = "HarvestAll", Text = "🧺\nCollect", Size = UDim2.fromOffset(84, 78), LayoutOrder = -2, Parent = hotbar }, Color3.fromRGB(255, 140, 60), function()
		action:FireServer("harvestAll")
	end)
	harvest.TextScaled = true
	local shovel = slotButton("shovel", 1000, Color3.fromRGB(150, 150, 160))
	Ui.label({ Text = "🪓", Size = UDim2.new(1, -16, 1, -24), Position = UDim2.fromOffset(8, 6), Parent = shovel.button })
end

local function refreshHotbar()
	local seeds = decode("Seeds")
	for _, seed in Config.Seeds do
		local n = seeds[seed.id] or 0
		local s = slots[seed.id]
		if n > 0 and not s then
			local ns = slotButton(seed.id, seed.order or 0, seed.color)
			s = ns
			candyView(ns.button, seed.id, { Size = UDim2.new(1, -14, 1, -18), Position = UDim2.fromOffset(7, 6), ZIndex = 2 })
			Ui.pop(ns.button, 0.5)
		end
		if s then
			s.count.Text = if n > 0 then `x{n}` else ""
			local holder = s.button.Parent :: Frame
			holder.Visible = n > 0
		end
		if n <= 0 and selected == seed.id then
			selected = nil
		end
	end
	refreshSelection()
end

UserInputService.InputBegan:Connect(function(input, processed)
	if processed then
		return
	end
	local k = input.KeyCode
	if k == Enum.KeyCode.Q then
		selected = nil
		refreshSelection()
		return
	end
	local n = if k.Value >= Enum.KeyCode.One.Value and k.Value <= Enum.KeyCode.Nine.Value then k.Value - Enum.KeyCode.One.Value + 1 else nil
	if not n then
		return
	end
	local owned = decode("Seeds")
	local i = 0
	for _, seed in Config.Seeds do
		if (owned[seed.id] or 0) > 0 then
			i += 1
			if i == n then
				selected = if selected == seed.id then nil else seed.id
				Sfx.play("click", 0.4, 1.2)
				refreshSelection()
				return
			end
		end
	end
end)

-- Pointer: plant / harvest / shovel -----------------------------------------------------------------

local function myPlot(): Model?
	local i = player:GetAttribute("Plot")
	local map = Workspace:FindFirstChild("Map")
	local plots = map and map:FindFirstChild("Plots")
	return if i and plots then plots:FindFirstChild("Plot" .. tostring(i)) :: Model? else nil
end

local highlight = Instance.new("SelectionBox")
highlight.LineThickness = 0.08
highlight.SurfaceTransparency = 0.75
highlight.Parent = gui

local hover = Ui.new("BillboardGui", { Size = UDim2.fromOffset(220, 74), StudsOffsetWorldSpace = Vector3.new(0, 5, 0), AlwaysOnTop = true, MaxDistance = 80, Enabled = false, Parent = gui })
local hoverBg = Ui.new("Frame", { Size = UDim2.fromScale(1, 1), BackgroundColor3 = Color3.fromRGB(60, 20, 60), BackgroundTransparency = 0.2, Parent = hover }, { Ui.corner(14), Ui.stroke(Color3.new(1, 1, 1), 2) })
local hoverName = Ui.label({ Text = "", Size = UDim2.new(1, -16, 0, 28), Position = UDim2.fromOffset(8, 4), Parent = hoverBg })
local hoverSub = Ui.label({ Text = "", Size = UDim2.new(1, -16, 0, 20), Position = UDim2.fromOffset(8, 32), TextColor3 = C.muted, Parent = hoverBg })
local hoverBar = Ui.new("Frame", { Size = UDim2.new(1, -24, 0, 8), Position = UDim2.fromOffset(12, 58), BackgroundColor3 = Color3.fromRGB(40, 10, 40), Parent = hoverBg }, { Ui.corner(4) })
local hoverFill = Ui.new("Frame", { Size = UDim2.fromScale(0.5, 1), BackgroundColor3 = MINT, Parent = hoverBar }, { Ui.corner(4) })

type Target = { tile: number, part: BasePart, plant: Model? }

local function pick(pos: Vector2): Target?
	local plot = myPlot()
	if not plot then
		return nil
	end
	local cam = Workspace.CurrentCamera
	local ray = cam:ViewportPointToRay(pos.X, pos.Y)
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Include
	params.FilterDescendantsInstances = { plot:FindFirstChild("Tiles") :: Instance, plot:FindFirstChild("Plants") :: Instance }
	local hit = Workspace:Raycast(ray.Origin, ray.Direction * 300, params)
	if not hit then
		return nil
	end
	local inst: Instance? = hit.Instance
	local tile = hit.Instance:GetAttribute("Tile")
	local plantModel: Model? = nil
	while inst and inst ~= plot do
		if inst:IsA("Model") and inst:GetAttribute("Tile") then
			plantModel = inst
			tile = inst:GetAttribute("Tile")
			break
		end
		inst = inst.Parent
	end
	if typeof(tile) ~= "number" then
		return nil
	end
	local tiles = plot:FindFirstChild("Tiles") :: Instance
	local part = tiles:FindFirstChild("T" .. tile) :: BasePart?
	if not part then
		return nil
	end
	if not plantModel then
		plantModel = (plot:FindFirstChild("Plants") :: Instance):FindFirstChild("P" .. tile) :: Model?
	end
	return { tile = tile, part = part, plant = plantModel }
end

local lastSent: { [number]: number } = {}
local function use(t: Target, dragging: boolean)
	local clock = os.clock()
	if lastSent[t.tile] and clock - lastSent[t.tile] < 0.35 then
		return
	end
	if selected == "shovel" then
		if t.plant and not dragging then
			lastSent[t.tile] = clock
			action:FireServer("shovel", t.tile)
		end
	elseif t.plant then
		if t.plant:GetAttribute("Ripe") then
			lastSent[t.tile] = clock
			action:FireServer("harvest", t.tile)
		end
	elseif selected and not t.part:GetAttribute("Locked") then
		lastSent[t.tile] = clock
		action:FireServer("plant", { tile = t.tile, seed = selected })
	elseif t.part:GetAttribute("Locked") and not dragging then
		toast("Unlock this row at the golden stand beside your garden!", "error")
	end
end

local pressing = false
UserInputService.InputBegan:Connect(function(input, processed)
	if processed then
		return
	end
	if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
		pressing = true
		local t = pick(Vector2.new(input.Position.X, input.Position.Y))
		if t then
			use(t, false)
		end
	end
end)
UserInputService.InputEnded:Connect(function(input)
	if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
		pressing = false
	end
end)
UserInputService.InputChanged:Connect(function(input)
	if pressing and (input.UserInputType == Enum.UserInputType.MouseMovement or input.UserInputType == Enum.UserInputType.Touch) then
		local t = pick(Vector2.new(input.Position.X, input.Position.Y))
		if t then
			use(t, true)
		end
	end
end)

-- Only your own plants show harvest prompts.
local function claimPrompt(pp: Instance)
	if pp:IsA("ProximityPrompt") and pp.Name == "Harvest" then
		local plot = myPlot()
		pp.Enabled = plot ~= nil and pp:IsDescendantOf(plot)
	end
end
Workspace.DescendantAdded:Connect(claimPrompt)

-- Hover info + tile highlight (every frame).
local function hoverUpdate()
	if not gui.Enabled then
		highlight.Adornee = nil
		hover.Enabled = false
		return
	end
	local pos = UserInputService:GetMouseLocation()
	local t = if UserInputService.TouchEnabled and not UserInputService.MouseEnabled then nil else pick(pos)
	if not t then
		highlight.Adornee = nil
		hover.Enabled = false
		return
	end
	highlight.Adornee = t.part
	local locked = t.part:GetAttribute("Locked") == true
	local good = if selected == "shovel" then t.plant ~= nil elseif t.plant then t.plant:GetAttribute("Ripe") == true elseif selected then not locked else false
	local col = if good then Color3.fromRGB(120, 255, 140) elseif locked then Color3.fromRGB(255, 120, 120) else Color3.new(1, 1, 1)
	highlight.Color3 = col
	highlight.SurfaceColor3 = col
	local m = t.plant
	if not m then
		hover.Enabled = false
		return
	end
	local seed = Config.SeedById[m:GetAttribute("Seed") :: string]
	if not seed then
		hover.Enabled = false
		return
	end
	hover.Enabled = true
	hover.Adornee = t.part
	if m:GetAttribute("Ripe") then
		local mut = m:GetAttribute("Mut") :: string?
		local candy = { s = seed.id, kg = (m:GetAttribute("Kg") :: number?) or seed.kg, m = mut }
		hoverName.Text = Rules.candyName(candy)
		hoverName.TextColor3 = if mut and Config.MutationById[mut] then Config.MutationById[mut].color else Color3.new(1, 1, 1)
		hoverSub.Text = `{candy.kg} kg · 💰{Rules.short(Rules.candyValue(candy))}`
		hoverFill.Size = UDim2.fromScale(1, 1)
		hoverFill.BackgroundColor3 = GOLD
	else
		local start, ready = m:GetAttribute("Start") :: number?, m:GetAttribute("Ready") :: number?
		local nowT = serverNow()
		hoverName.Text = seed.name
		hoverName.TextColor3 = Color3.new(1, 1, 1)
		if start and ready then
			hoverSub.Text = `Ripe in {Rules.clock(ready - nowT)}`
			hoverFill.Size = UDim2.fromScale(Rules.progress(start, ready, nowT), 1)
		end
		hoverFill.BackgroundColor3 = MINT
	end
end

-- Tutorial ------------------------------------------------------------------------------------------

local tip = Ui.new("Frame", {
	Size = UDim2.fromOffset(470, 54),
	Position = UDim2.new(0.5, 0, 1, -146),
	AnchorPoint = Vector2.new(0.5, 1),
	BackgroundColor3 = Color3.fromRGB(255, 240, 120),
	Visible = false,
	Parent = gui,
}, { Ui.corner(16), Ui.stroke(Color3.fromRGB(150, 80, 20), 3) })
local tipLabel = Ui.label({ Text = "", Size = UDim2.new(1, -24, 1, -12), Position = UDim2.fromOffset(12, 6), TextColor3 = Color3.fromRGB(110, 50, 20), Parent = tip })
local tipStroke = tipLabel:FindFirstChildOfClass("UIStroke")
if tipStroke then
	tipStroke.Transparency = 1
end
local tipBounce = 0

local function plantCounts(): (number, number)
	local plot = myPlot()
	local plants = plot and plot:FindFirstChild("Plants")
	local n, ripe = 0, 0
	if plants then
		for _, m in plants:GetChildren() do
			n += 1
			if m:GetAttribute("Ripe") then
				ripe += 1
			end
		end
	end
	return n, ripe
end

local sawBuy = false
local function tutorialText(): string?
	if player:GetAttribute("Tutorial") then
		return nil
	end
	local n, ripe = plantCounts()
	local basket = player:GetAttribute("BasketCount") or 0
	local earned = player:GetAttribute("Earned") or 0
	local seeds = decode("Seeds")
	local anySeeds = next(seeds) ~= nil
	if earned > 0 then
		if sawBuy then
			action:FireServer("tutorialDone")
			return nil
		end
		return "🌱 Great! Now buy more seeds at the Seed Shop"
	end
	if basket > 0 and ripe == 0 then
		return "💰 Tap SELL to sell your candy at the Candy Market!"
	end
	if ripe > 0 then
		return "🍬 Click the ripe candy (or press E) to harvest it!"
	end
	if n > 0 and not anySeeds then
		return "⏳ Your candy is growing... ripe plants sparkle!"
	end
	if anySeeds then
		return if selected and selected ~= "shovel" then "👇 Now click the brown soil in your garden!" else "👇 Pick a seed from your hotbar below"
	end
	return "⏳ Your candy is growing... ripe plants sparkle!"
end

-- Timers + refresh ------------------------------------------------------------------------------

local shownCoins = 0
local function refresh()
	local coins = player:GetAttribute("Coins") or 0
	local target = coins
	task.spawn(function()
		local from = shownCoins
		shownCoins = target
		local t0 = os.clock()
		while os.clock() - t0 < 0.4 do
			local a = (os.clock() - t0) / 0.4
			coinLabel.Text = `💰 {Rules.short(from + (target - from) * a)}`
			task.wait()
			if shownCoins ~= target then
				return
			end
		end
		coinLabel.Text = `💰 {Rules.short(target)}`
	end)
	local count = player:GetAttribute("BasketCount") or 0
	local cap = player:GetAttribute("BasketCap") or Config.BasketCap
	local value = player:GetAttribute("BasketValue") or 0
	basketLabel.Text = if count > 0 then `🧺 {count}/{cap} · 💰{Rules.short(value)}` else `🧺 0/{cap}`
	basketLabel.TextColor3 = if count >= cap then Color3.fromRGB(255, 120, 120) else Color3.fromRGB(255, 190, 230)
	refreshHotbar()
	if shopPanel.Visible then
		refreshShop()
	end
	refreshIndex()
	refreshPasses()
end
player.AttributeChanged:Connect(function(name)
	if name == "Coins" or name == "Seeds" or name == "BasketCount" or name == "BasketValue" or name == "Found" or name == "Bought" or name == "BasketCap" then
		refresh()
	end
end)
Workspace:GetAttributeChangedSignal("Stock"):Connect(refreshShop)
shopPanel:GetPropertyChangedSignal("Visible"):Connect(function()
	if shopPanel.Visible then
		refreshShop()
	end
end)

RunService.RenderStepped:Connect(function(dt)
	hoverUpdate()
	local t = serverNow()
	local at = Workspace:GetAttribute("RestockAt")
	if typeof(at) == "number" then
		local txt = Rules.clock(at - t)
		restockLabel.Text = `🌱 Restock {txt}`
		shopTimer.Text = `New seeds in {txt}`
	end
	local w = Workspace:GetAttribute("Weather")
	local ends = Workspace:GetAttribute("WeatherEnds")
	if typeof(w) == "string" and Config.WeatherById[w] and typeof(ends) == "number" then
		local info = Config.WeatherById[w]
		weatherBox.Visible = true
		weatherTitle.Text = `{WEATHER_ICON[w] or ""} {info.name} · {Rules.clock(ends - t)}`
		weatherTitle.TextColor3 = WEATHER_COLOR[w] or Color3.new(1, 1, 1)
		weatherSub.Text = info.blurb
		local stroke = weatherBox:FindFirstChildOfClass("UIStroke")
		if stroke then
			stroke.Color = WEATHER_COLOR[w] or Color3.new(1, 1, 1)
		end
	else
		weatherBox.Visible = false
	end
	local text = tutorialText()
	tip.Visible = text ~= nil
	if text then
		tipLabel.Text = text
		tipBounce += dt
		tip.Position = UDim2.new(0.5, 0, 1, -146 - math.abs(math.sin(tipBounce * 3)) * 6)
	end
end)

-- Fx events -------------------------------------------------------------------------------------

local bigText = Ui.label({ Text = "", Size = UDim2.fromScale(0.7, 0.1), Position = UDim2.fromScale(0.5, 0.3), AnchorPoint = Vector2.new(0.5, 0.5), TextTransparency = 1, TextColor3 = GOLD, ZIndex = 51, Parent = gui })
local subText = Ui.label({ Text = "", Size = UDim2.fromScale(0.6, 0.045), Position = UDim2.fromScale(0.5, 0.38), AnchorPoint = Vector2.new(0.5, 0.5), TextTransparency = 1, ZIndex = 51, Parent = gui })
local bigStroke = bigText:FindFirstChildOfClass("UIStroke") :: UIStroke
local subStroke = subText:FindFirstChildOfClass("UIStroke") :: UIStroke
local bigId = 0
local function big(text: string, sub: string?, color: Color3?)
	bigId += 1
	local id = bigId
	bigText.Text = text
	bigText.TextColor3 = color or GOLD
	subText.Text = sub or ""
	bigText.TextTransparency, subText.TextTransparency = 0, 0
	bigStroke.Transparency, subStroke.Transparency = 0.2, 0.2
	Ui.pop(bigText, 0.4)
	task.delay(2.4, function()
		if id ~= bigId then
			return
		end
		tween(bigText, 0.4, { TextTransparency = 1 })
		tween(subText, 0.4, { TextTransparency = 1 })
		tween(bigStroke, 0.4, { Transparency = 1 })
		tween(subStroke, 0.4, { Transparency = 1 })
	end)
end

-- Floating "+candy" text at a world position.
local function floatText(pos: Vector3, text: string, color: Color3)
	local part = Instance.new("Part")
	part.Anchored = true
	part.CanCollide = false
	part.CanQuery = false
	part.Transparency = 1
	part.Size = Vector3.new(0.2, 0.2, 0.2)
	part.Position = pos
	part.Parent = Workspace
	local bb = Ui.new("BillboardGui", { Size = UDim2.fromOffset(240, 60), AlwaysOnTop = true, Adornee = part, Parent = part })
	local l = Ui.label({ Text = text, Size = UDim2.fromScale(1, 1), TextColor3 = color, Parent = bb })
	Ui.pop(l, 0.4)
	tween(part, 1.2, { Position = pos + Vector3.new(0, 5, 0) })
	task.delay(0.7, function()
		tween(l, 0.5, { TextTransparency = 1 })
		local s = l:FindFirstChildOfClass("UIStroke")
		if s then
			tween(s, 0.5, { Transparency = 1 })
		end
	end)
	task.delay(1.3, function()
		part:Destroy()
	end)
end

local function tilePos(tile: number): Vector3?
	local plot = myPlot()
	local tiles = plot and plot:FindFirstChild("Tiles")
	local p = tiles and tiles:FindFirstChild("T" .. tile) :: BasePart?
	return p and p.Position
end

local handlers: { [string]: (any) -> () } = {}

handlers.harvest = function(d)
	local pos = tilePos(d.tile)
	local candy = { s = d.s, kg = d.kg, m = d.m }
	local mut = d.m and Config.MutationById[d.m]
	local color = if mut then mut.color else Color3.fromRGB(255, 255, 255)
	if pos then
		floatText(pos + Vector3.new(0, 4, 0), `+{Rules.candyName(candy)} · 💰{Rules.short(d.value)}`, color)
	end
	Sfx.play("pop", 0.55, 0.9 + math.random() * 0.3)
	if mut and (d.m == "golden" or d.m == "rainbow") then
		Sfx.play("sparkle", 0.7)
		big(`✨ {string.upper(Rules.candyName(candy))}! ✨`, `Worth 💰{Rules.short(d.value)}`, mut.color)
	elseif d.new then
		Sfx.play("levelUp", 0.5)
		big("NEW CANDY!", `{Config.SeedById[d.s].name} added to your Index`, Color3.fromRGB(255, 170, 230))
	end
	Ui.pop(basketPill, 0.9)
end
handlers.planted = function()
	Sfx.play("dig", 0.5, 1.1 + math.random() * 0.2)
end
handlers.shoveled = function()
	Sfx.play("dig", 0.6, 0.8)
end
handlers.ripe = function(d)
	if d.plot == player:GetAttribute("Plot") then
		Sfx.play("sparkle", 0.25, 1.3)
	end
end
handlers.mutate = function(d)
	if d.plot == player:GetAttribute("Plot") then
		local pos = tilePos(d.tile)
		local mut = Config.MutationById[d.m]
		if pos and mut then
			floatText(pos + Vector3.new(0, 5, 0), `{mut.name}!`, mut.color)
		end
	end
end
handlers.sold = function(d)
	Sfx.play("cash", 0.6)
	big(`+💰{Rules.short(d.total)}`, `Sold {d.count} candies` .. (if d.best then ` · best: {d.best}` else ""), GOLD)
	Ui.pop(coinPill, 0.8)
end
handlers.bought = function(d)
	sawBuy = true
	Sfx.play("reward", 0.45, 1.2)
	local r = seedRows[d.s]
	if r then
		Ui.pop(r.buy, 0.85)
	end
	-- auto-select what you just bought so you can plant straight away
	selected = d.s
	refreshSelection()
end
handlers.full = function()
	toast("🧺 Your basket is full! Go sell your candy.", "error")
end
handlers.unlock = function(d)
	Sfx.play("levelUp", 0.6)
	big("NEW ROW!", `Row {d.rows} of your garden is ready to plant`, MINT)
end
handlers.openShop = function()
	toggle(shopPanel, true)
end
handlers.restock = function(d)
	if d.rare then
		toast(`🌱 Seed Shop restocked · {Config.SeedById[d.rare].name} in stock!`, "big")
	else
		toast("🌱 The Seed Shop restocked!", "info")
	end
	refreshShop()
end
handlers.weather = function(d)
	local w = Config.WeatherById[d.id]
	if w then
		big(`{WEATHER_ICON[d.id] or ""} {string.upper(w.name)}!`, w.blurb, WEATHER_COLOR[d.id])
		Sfx.play("sparkle", 0.6, 0.8)
	end
end
handlers.toast = function(d)
	toast(d.text, "big")
end
handlers.daily = function(d)
	Sfx.play("victory", 0.5)
	big(`DAY {d.streak} BONUS!`, `+💰{d.coins} · come back tomorrow for more`, GOLD)
end

fxRemote.OnClientEvent:Connect(function(kind: string, data: any)
	local fn = handlers[kind]
	if fn then
		fn(data or {})
	end
end)

-- first paint
task.defer(function()
	for _, d in Workspace:GetDescendants() do
		claimPrompt(d)
	end
	refresh()
	refreshShop()
	refreshSelection()
end)
