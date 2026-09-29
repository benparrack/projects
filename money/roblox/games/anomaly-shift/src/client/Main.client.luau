--!strict
-- Anomaly Shift HUD: coins, floor + timer, radar, the black loop transition with the
-- verdict, Second Chance offer, escape screen, Index, shop, tutorial and toasts.

local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local Rules = require(ReplicatedStorage.Shared:WaitForChild("Rules"))
local Ui = require(script.Parent:WaitForChild("Ui"))
local Sfx = require(script.Parent:WaitForChild("Sfx"))

local player = Players.LocalPlayer
local remotes = ReplicatedStorage:WaitForChild("Remotes")
local action = remotes:WaitForChild("Action") :: RemoteEvent
local notifyRemote = remotes:WaitForChild("Notify") :: RemoteEvent
local fxRemote = remotes:WaitForChild("Fx") :: RemoteEvent

Ui.Font = Enum.Font.GothamBold
local C = Ui.Colors
C.panel = Color3.fromRGB(18, 18, 22)
C.panelLight = Color3.fromRGB(34, 34, 40)
local AMBER = Color3.fromRGB(255, 200, 50)

local gui = Ui.new("ScreenGui", {
	Name = "Hud",
	ResetOnSpawn = false,
	IgnoreGuiInset = true,
	ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
	Parent = player:WaitForChild("PlayerGui"),
})

local function tween(inst: Instance, t: number, props: { [string]: any }, style: Enum.EasingStyle?)
	local tw = TweenService:Create(inst, TweenInfo.new(t, style or Enum.EasingStyle.Quad), props)
	tw:Play()
	return tw
end

local function panel(name: string, size: UDim2, title: string): (Frame, Frame)
	local p = Ui.new("Frame", {
		Name = name,
		Size = size,
		Position = UDim2.fromScale(0.5, 0.5),
		AnchorPoint = Vector2.new(0.5, 0.5),
		BackgroundColor3 = C.panel,
		Visible = false,
		ZIndex = 20,
		Parent = gui,
	}, { Ui.corner(14), Ui.stroke(AMBER, 3), Ui.new("UISizeConstraint", { MaxSize = Vector2.new(720, 560) }) })
	Ui.label({ Text = title, Size = UDim2.new(1, -80, 0, 40), Position = UDim2.fromOffset(20, 12), TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = AMBER, ZIndex = 21, Parent = p })
	Ui.button({ Text = "✕", Size = UDim2.fromOffset(40, 40), Position = UDim2.new(1, -52, 0, 12), ZIndex = 22, Parent = p }, C.red, function()
		p.Visible = false
	end)
	local body = Ui.new("Frame", { Size = UDim2.new(1, -32, 1, -72), Position = UDim2.fromOffset(16, 60), BackgroundTransparency = 1, ZIndex = 21, Parent = p })
	return p, body
end

local openPanel: Frame? = nil
local function toggle(p: Frame)
	if openPanel and openPanel ~= p then
		openPanel.Visible = false
	end
	p.Visible = not p.Visible
	openPanel = if p.Visible then p else nil
	if p.Visible then
		Ui.pop(p, 0.85)
	end
end

-- Toasts ----------------------------------------------------------------------------------

local toastList = Ui.new("Frame", {
	Size = UDim2.fromOffset(460, 200),
	Position = UDim2.new(0.5, 0, 0, 90),
	AnchorPoint = Vector2.new(0.5, 0),
	BackgroundTransparency = 1,
	ZIndex = 40,
	Parent = gui,
}, { Ui.new("UIListLayout", { Padding = UDim.new(0, 6), HorizontalAlignment = Enum.HorizontalAlignment.Center }) })

local function toast(text: string, kind: string?)
	local color = if kind == "error" then C.red elseif kind == "reward" then C.green elseif kind == "big" then AMBER else C.text
	local t = Ui.label({
		Text = text,
		Size = UDim2.new(1, 0, 0, 34),
		TextColor3 = color,
		BackgroundTransparency = 0.25,
		BackgroundColor3 = Color3.new(0, 0, 0),
		ZIndex = 41,
		Parent = toastList,
	})
	Ui.new("UIPadding", { PaddingLeft = UDim.new(0, 10), PaddingRight = UDim.new(0, 10), PaddingTop = UDim.new(0, 5), PaddingBottom = UDim.new(0, 5), Parent = t })
	Ui.corner(8).Parent = t
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

-- Top bar: coins + title (lobby) / floor + timer (shift) ------------------------------------

local coinPill = Ui.new("Frame", {
	Size = UDim2.fromOffset(170, 44),
	Position = UDim2.fromOffset(16, 64),
	BackgroundColor3 = Color3.new(0, 0, 0),
	BackgroundTransparency = 0.35,
	Parent = gui,
}, { Ui.corner(22) })
local coinLabel = Ui.label({ Text = "💰 0", Size = UDim2.new(1, -20, 1, -10), Position = UDim2.fromOffset(12, 5), TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = AMBER, Parent = coinPill })
local titleLabel = Ui.label({ Text = "Intern", Size = UDim2.fromOffset(260, 24), Position = UDim2.fromOffset(20, 112), TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = C.muted, Parent = gui })

local floorBox = Ui.new("Frame", {
	Size = UDim2.fromOffset(200, 86),
	Position = UDim2.new(0.5, 0, 0, 12),
	AnchorPoint = Vector2.new(0.5, 0),
	BackgroundColor3 = Color3.new(0, 0, 0),
	BackgroundTransparency = 0.4,
	Visible = false,
	Parent = gui,
}, { Ui.corner(12), Ui.stroke(AMBER, 2) })
local floorLabel = Ui.label({ Text = "FLOOR 0", Size = UDim2.new(1, -16, 0.55, 0), Position = UDim2.fromOffset(8, 6), TextColor3 = AMBER, Font = Enum.Font.GothamBlack, Parent = floorBox })
local timerLabel = Ui.label({ Text = "0:00.0", Size = UDim2.new(1, -16, 0.3, 0), Position = UDim2.new(0, 8, 0.62, 0), TextColor3 = C.muted, Font = Enum.Font.Code, Parent = floorBox })
-- progress pips
local pips = Ui.new("Frame", { Size = UDim2.new(1, 0, 0, 8), Position = UDim2.new(0, 0, 1, 6), BackgroundTransparency = 1, Parent = floorBox }, {
	Ui.new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 4), HorizontalAlignment = Enum.HorizontalAlignment.Center }),
})
local pipFrames = {}
for i = 1, Config.Floors + 1 do
	pipFrames[i] = Ui.new("Frame", { Size = UDim2.fromOffset(18, 8), BackgroundColor3 = Color3.fromRGB(60, 60, 60), Parent = pips }, { Ui.corner(4) })
end

-- Right-side buttons ------------------------------------------------------------------------

local side = Ui.new("Frame", {
	Size = UDim2.fromOffset(150, 300),
	Position = UDim2.new(1, -16, 0.5, 0),
	AnchorPoint = Vector2.new(1, 0.5),
	BackgroundTransparency = 1,
	Parent = gui,
}, { Ui.new("UIListLayout", { Padding = UDim.new(0, 10), SortOrder = Enum.SortOrder.LayoutOrder, HorizontalAlignment = Enum.HorizontalAlignment.Right, VerticalAlignment = Enum.VerticalAlignment.Center }) })

local shopPanel, shopBody = panel("Shop", UDim2.fromScale(0.62, 0.7), "SUPPLY CLOSET")
local indexPanel, indexBody = panel("Index", UDim2.fromScale(0.66, 0.74), "ANOMALY INDEX")

local radarButton = Ui.button({ Name = "Radar", Text = "📡 Radar", Size = UDim2.fromOffset(150, 50), LayoutOrder = 1, Visible = false, Parent = side }, Color3.fromRGB(40, 150, 110), function()
	action:FireServer("radar")
end)
Ui.button({ Name = "ShopButton", Text = "🛒 Shop", Size = UDim2.fromOffset(150, 50), LayoutOrder = 2, Parent = side }, Color3.fromRGB(200, 140, 30), function()
	toggle(shopPanel)
end)
Ui.button({ Name = "IndexButton", Text = "👁 Index", Size = UDim2.fromOffset(150, 50), LayoutOrder = 3, Parent = side }, Color3.fromRGB(150, 50, 60), function()
	toggle(indexPanel)
end)
local leaveButton = Ui.button({ Name = "Leave", Text = "🚪 Lobby", Size = UDim2.fromOffset(150, 44), LayoutOrder = 4, Visible = false, Parent = side }, Color3.fromRGB(80, 80, 90), function()
	action:FireServer("leave")
end)

-- Shop ----------------------------------------------------------------------------------------

local function prompt(kind: "pass" | "product", id: number)
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

local shopList = Ui.new("ScrollingFrame", {
	Size = UDim2.fromScale(1, 1),
	BackgroundTransparency = 1,
	ScrollBarThickness = 6,
	AutomaticCanvasSize = Enum.AutomaticSize.Y,
	CanvasSize = UDim2.new(),
	ZIndex = 21,
	Parent = shopBody,
}, { Ui.new("UIListLayout", { Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder }) })

local ownedLabels: { [string]: TextButton } = {}
local function shopRow(order: number, icon: string, name: string, desc: string, price: string, color: Color3, onBuy: () -> ()): TextButton
	local row = Ui.new("Frame", { Size = UDim2.new(1, -10, 0, 70), BackgroundColor3 = C.panelLight, LayoutOrder = order, ZIndex = 21, Parent = shopList }, { Ui.corner(10) })
	Ui.label({ Text = icon, Size = UDim2.fromOffset(52, 52), Position = UDim2.fromOffset(10, 9), ZIndex = 22, Parent = row })
	Ui.label({ Text = name, Size = UDim2.new(1, -220, 0, 28), Position = UDim2.fromOffset(72, 8), TextXAlignment = Enum.TextXAlignment.Left, ZIndex = 22, Parent = row })
	Ui.label({ Text = desc, Size = UDim2.new(1, -220, 0, 22), Position = UDim2.fromOffset(72, 38), TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = C.muted, ZIndex = 22, Parent = row })
	return Ui.button({ Text = price, Size = UDim2.fromOffset(120, 46), Position = UDim2.new(1, -132, 0.5, -23), ZIndex = 22, Parent = row }, color, onBuy)
end

Ui.label({ Text = "Spend coins", Size = UDim2.new(1, 0, 0, 26), TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = AMBER, LayoutOrder = 0, ZIndex = 22, Parent = shopList })
shopRow(1, "📡", "Radar Ping", "Tells you if the current hall has an anomaly.", `💰 {Config.RadarCost}`, Color3.fromRGB(200, 140, 30), function()
	action:FireServer("buy", "radar")
end)
shopRow(2, "💫", "Second Chance", "After a mistake, keep your floor.", `💰 {Config.ReviveCost}`, Color3.fromRGB(200, 140, 30), function()
	action:FireServer("buy", "revive")
end)
Ui.label({ Text = "Robux", Size = UDim2.new(1, 0, 0, 26), TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = C.green, LayoutOrder = 10, ZIndex = 22, Parent = shopList })
shopRow(11, "💫", "3 Second Chances", "Never lose a good run.", `R$ {Config.ProductPrices.revive3}`, C.green, function()
	prompt("product", Config.Products.revive3)
end)
shopRow(12, "📡", "3 Radar Pings", "Check a hall when you're not sure.", `R$ {Config.ProductPrices.radar3}`, C.green, function()
	prompt("product", Config.Products.radar3)
end)
ownedLabels.coins2x = shopRow(20, "💰", "2x Coins", "Double coins from every floor and escape.", `R$ {Config.PassPrices.coins2x}`, C.blue, function()
	prompt("pass", Config.Passes.coins2x)
end)
ownedLabels.lucky = shopRow(21, "🍀", "Lucky Badge", "One free Second Chance every shift.", `R$ {Config.PassPrices.lucky}`, C.blue, function()
	prompt("pass", Config.Passes.lucky)
end)
ownedLabels.radar = shopRow(22, "🛰", "Radar Pro", "A free radar ping on every floor.", `R$ {Config.PassPrices.radar}`, C.blue, function()
	prompt("pass", Config.Passes.radar)
end)
local stockLabel = Ui.label({ Text = "", Size = UDim2.new(1, 0, 0, 24), TextColor3 = C.muted, LayoutOrder = 30, ZIndex = 22, Parent = shopList })

-- Index -------------------------------------------------------------------------------------

local indexCount = Ui.label({ Text = "", Size = UDim2.new(1, 0, 0, 26), TextColor3 = C.muted, ZIndex = 22, Parent = indexBody })
local grid = Ui.new("ScrollingFrame", {
	Size = UDim2.new(1, 0, 1, -34),
	Position = UDim2.fromOffset(0, 34),
	BackgroundTransparency = 1,
	ScrollBarThickness = 6,
	AutomaticCanvasSize = Enum.AutomaticSize.Y,
	CanvasSize = UDim2.new(),
	ZIndex = 21,
	Parent = indexBody,
}, { Ui.new("UIGridLayout", { CellSize = UDim2.new(0.25, -8, 0, 96), CellPadding = UDim2.fromOffset(8, 8) }) })
local cards: { [string]: { frame: Frame, name: TextLabel, hint: TextLabel } } = {}
for i, a in Config.Anomalies do
	local f = Ui.new("Frame", { BackgroundColor3 = C.panelLight, LayoutOrder = i, ZIndex = 22, Parent = grid }, { Ui.corner(8) })
	local tierColor = ({ C.green, AMBER, C.red })[a.tier]
	Ui.new("Frame", { Size = UDim2.new(1, 0, 0, 4), BackgroundColor3 = tierColor, BorderSizePixel = 0, ZIndex = 23, Parent = f })
	local n = Ui.label({ Text = "???", Size = UDim2.new(1, -12, 0, 26), Position = UDim2.fromOffset(6, 10), ZIndex = 23, Parent = f })
	local h = Ui.label({ Text = "", Size = UDim2.new(1, -12, 0, 50), Position = UDim2.fromOffset(6, 40), TextColor3 = C.muted, TextWrapped = true, Font = Enum.Font.Gotham, ZIndex = 23, Parent = f })
	cards[a.id] = { frame = f, name = n, hint = h }
end

local function refreshIndex()
	local list = string.split((player:GetAttribute("FoundList") or "") :: string, ",")
	local found = {}
	for _, id in list do
		found[id] = true
	end
	local n = 0
	for _, a in Config.Anomalies do
		local card = cards[a.id]
		if found[a.id] then
			n += 1
			card.name.Text = a.name
			card.name.TextColor3 = C.text
			card.hint.Text = a.hint
			card.frame.BackgroundColor3 = Color3.fromRGB(46, 40, 34)
		else
			card.name.Text = "???"
			card.name.TextColor3 = Color3.fromRGB(110, 110, 120)
			card.hint.Text = ({ "Easy", "Medium", "Hard" })[a.tier] .. " · not found yet"
			card.frame.BackgroundColor3 = C.panelLight
		end
	end
	indexCount.Text = `{n} / {#Config.Anomalies} anomalies logged. Turn back on an anomaly to log it.`
end

-- The black transition overlay ------------------------------------------------------------------

local fade = Ui.new("Frame", {
	Size = UDim2.fromScale(1, 1),
	BackgroundColor3 = Color3.new(0, 0, 0),
	BackgroundTransparency = 1,
	ZIndex = 50,
	Parent = gui,
})
local bigText = Ui.label({ Text = "", Size = UDim2.fromScale(0.8, 0.14), Position = UDim2.fromScale(0.5, 0.3), AnchorPoint = Vector2.new(0.5, 0.5), TextTransparency = 1, Font = Enum.Font.GothamBlack, ZIndex = 51, Parent = gui })
local subText = Ui.label({ Text = "", Size = UDim2.fromScale(0.7, 0.05), Position = UDim2.fromScale(0.5, 0.4), AnchorPoint = Vector2.new(0.5, 0.5), TextTransparency = 1, TextColor3 = C.muted, Font = Enum.Font.GothamMedium, ZIndex = 51, Parent = gui })
for _, l in { bigText, subText } do
	(l:FindFirstChildOfClass("UIStroke") :: UIStroke).Transparency = 1
end

local function showText(big: string, sub: string, color: Color3, hold: number)
	bigText.Text = big
	bigText.TextColor3 = color
	subText.Text = sub
	for _, l in { bigText, subText } do
		tween(l, 0.2, { TextTransparency = 0 })
		tween(l:FindFirstChildOfClass("UIStroke") :: UIStroke, 0.2, { Transparency = 0.3 })
	end
	Ui.pop(bigText, 0.8)
	task.delay(hold, function()
		for _, l in { bigText, subText } do
			tween(l, 0.5, { TextTransparency = 1 })
			tween(l:FindFirstChildOfClass("UIStroke") :: UIStroke, 0.5, { Transparency = 1 })
		end
	end)
end

local function blackout(t: number)
	tween(fade, t, { BackgroundTransparency = 0 })
end
local function reveal(t: number)
	tween(fade, t, { BackgroundTransparency = 1 })
end

-- Second Chance offer -------------------------------------------------------------------------

local revive = Ui.new("Frame", {
	Size = UDim2.fromOffset(420, 190),
	Position = UDim2.new(0.5, 0, 1, -126),
	AnchorPoint = Vector2.new(0.5, 1),
	BackgroundColor3 = C.panel,
	Visible = false,
	ZIndex = 60,
	Parent = gui,
}, { Ui.corner(14), Ui.stroke(C.red, 3) })
local reviveTitle = Ui.label({ Text = "Keep Floor 5?", Size = UDim2.new(1, -24, 0, 40), Position = UDim2.fromOffset(12, 10), TextColor3 = C.red, Font = Enum.Font.GothamBlack, ZIndex = 61, Parent = revive })
local reviveBar = Ui.new("Frame", { Size = UDim2.new(1, -24, 0, 6), Position = UDim2.fromOffset(12, 56), BackgroundColor3 = C.red, BorderSizePixel = 0, ZIndex = 61, Parent = revive })
local reviveFree = Ui.button({ Text = "💫 Use Second Chance", Size = UDim2.new(1, -24, 0, 50), Position = UDim2.fromOffset(12, 72), ZIndex = 61, Parent = revive }, C.green, function()
	action:FireServer("revive")
	revive.Visible = false
end)
local reviveBuy = Ui.button({ Text = `R$ {Config.ProductPrices.revive} · Keep my floor`, Size = UDim2.new(1, -24, 0, 50), Position = UDim2.fromOffset(12, 128), ZIndex = 61, Parent = revive }, C.blue, function()
	prompt("product", Config.Products.revive)
	revive.Visible = false
end)
local reviveToken = 0

local function offerRevive(floor: number)
	reviveToken += 1
	local token = reviveToken
	local charges = ((player:GetAttribute("Revives") or 0) :: number) + (if player:GetAttribute("LuckyReady") then 1 else 0)
	reviveTitle.Text = `Keep Floor {floor}?`
	reviveFree.Visible = charges > 0
	reviveFree.Text = `💫 Use Second Chance ({charges})`
	reviveBuy.Position = if charges > 0 then UDim2.fromOffset(12, 128) else UDim2.fromOffset(12, 72)
	revive.Size = UDim2.fromOffset(420, if charges > 0 then 190 else 134)
	revive.Visible = true
	Ui.pop(revive, 0.7)
	reviveBar.Size = UDim2.new(1, -24, 0, 6)
	tween(reviveBar, Config.ReviveWindow, { Size = UDim2.fromOffset(0, 6) }, Enum.EasingStyle.Linear)
	task.delay(Config.ReviveWindow, function()
		if reviveToken == token then
			revive.Visible = false
		end
	end)
end

-- Escape screen ------------------------------------------------------------------------------

local escPanel, escBody = panel("Escape", UDim2.fromScale(0.5, 0.56), "YOU CLOCKED OUT")
local escTime = Ui.label({ Text = "", Size = UDim2.fromScale(1, 0.3), TextColor3 = AMBER, Font = Enum.Font.GothamBlack, ZIndex = 22, Parent = escBody })
local escInfo = Ui.label({ Text = "", Size = UDim2.fromScale(1, 0.36), Position = UDim2.fromScale(0, 0.32), TextColor3 = C.text, Font = Enum.Font.GothamMedium, ZIndex = 22, Parent = escBody })
Ui.button({ Text = "▶ Next shift", Size = UDim2.fromScale(0.6, 0.2), Position = UDim2.fromScale(0.2, 0.76), ZIndex = 22, Parent = escBody }, C.green, function()
	escPanel.Visible = false
end)

-- Tutorial banner ---------------------------------------------------------------------------------

local tutorial = Ui.new("Frame", {
	Size = UDim2.fromOffset(560, 92),
	Position = UDim2.new(0.5, 0, 1, -24),
	AnchorPoint = Vector2.new(0.5, 1),
	BackgroundColor3 = Color3.new(0, 0, 0),
	BackgroundTransparency = 0.3,
	Visible = false,
	Parent = gui,
}, { Ui.corner(12), Ui.stroke(AMBER, 2) })
local tutText = Ui.label({ Text = "", Size = UDim2.new(1, -24, 1, -16), Position = UDim2.fromOffset(12, 8), TextColor3 = C.text, Font = Enum.Font.GothamMedium, Parent = tutorial })
local tutorialOn = false

-- Radar ping ------------------------------------------------------------------------------------

local radarFlash = Ui.label({ Text = "", Size = UDim2.new(0.5, 0, 0, 50), Position = UDim2.new(0.5, 0, 0, 120), AnchorPoint = Vector2.new(0.5, 0), Visible = false, Font = Enum.Font.GothamBlack, ZIndex = 30, Parent = gui })

-- State refresh -------------------------------------------------------------------------------

local function refresh()
	local coins = (player:GetAttribute("Coins") or 0) :: number
	coinLabel.Text = `💰 {coins}`
	local escapes = (player:GetAttribute("Escapes") or 0) :: number
	local nextName, nextAt = Rules.nextTitle(escapes)
	titleLabel.Text = `{Rules.title(escapes)}` .. (if nextName and nextAt then ` · {nextAt - escapes} to {nextName}` else "")
	local inShift = player:GetAttribute("InShift") == true
	floorBox.Visible = inShift
	leaveButton.Visible = inShift
	radarButton.Visible = inShift
	local floor = (player:GetAttribute("Floor") or 0) :: number
	floorLabel.Text = `FLOOR {floor}`
	for i, p in pipFrames do
		p.BackgroundColor3 = if i <= floor then AMBER elseif i == floor + 1 then Color3.fromRGB(140, 120, 60) else Color3.fromRGB(60, 60, 60)
	end
	local free = player:GetAttribute("RadarFree") == true
	radarButton.Text = if free then "📡 Radar (free)" else `📡 Radar ({player:GetAttribute("Radars") or 0})`
	stockLabel.Text = `You have 📡 {player:GetAttribute("Radars") or 0} radar pings and 💫 {player:GetAttribute("Revives") or 0} second chances.`
	for key, b in ownedLabels do
		if player:GetAttribute("Pass_" .. key) then
			b.Text = "OWNED"
			b.Active = false
		end
	end
	refreshIndex()
end
player.AttributeChanged:Connect(refresh)
refresh()

RunService.RenderStepped:Connect(function()
	if floorBox.Visible then
		local start = (player:GetAttribute("RunStart") or 0) :: number
		if start > 0 then
			timerLabel.Text = Rules.clock(Workspace:GetServerTimeNow() - start)
		end
	end
end)

-- Server effects ------------------------------------------------------------------------------

fxRemote.OnClientEvent:Connect(function(kind: string, info: any)
	if kind == "enter" then
		Sfx.play("ding", 0.6)
		task.delay(0.25, function()
			blackout(0.7)
		end)
		if openPanel then
			openPanel.Visible = false
			openPanel = nil
		end
	elseif kind == "loop" then
		revive.Visible = false
		blackout(0.35)
		if info.outcome == "wrong" then
			if info.caught then
				Sfx.play("scream", 0.8)
			else
				Sfx.play("sting", 0.7)
			end
			Sfx.play("slam", 0.6, 0.8)
			task.delay(0.35, function()
				showText("WRONG!", info.hint or "", C.red, 2.4)
			end)
			if info.canRevive then
				task.delay(1.2, function()
					offerRevive(info.from)
				end)
			end
		elseif info.outcome == "correct" then
			Sfx.play("slam", 0.35, 1.2)
			local sub = if info.anomaly then `Anomaly: {info.anomaly}` else "Nothing was wrong."
			if info.newFind then
				sub ..= `  ·  NEW in your Index ({info.found}/{#Config.Anomalies})`
			end
			task.delay(0.35, function()
				showText("✓ CORRECT", sub .. `  ·  +{info.coins} 💰`, C.green, 1.4)
			end)
		end
	elseif kind == "arrive" then
		if (info.floor or 0) > 0 then
			revive.Visible = false -- revived (or bought it) elsewhere
			reviveToken += 1
		end
		-- first-person keeps the old look direction across a teleport: face down the hall
		for _, d in { 0.05, 0.3, 0.55 } do
			task.delay(d, function()
				-- (the character turns to match the camera in first person, so use the hall's
				-- fixed direction: corridors always run toward world +Z)
				local cam = Workspace.CurrentCamera
				local p = cam.CFrame.Position
				cam.CFrame = CFrame.lookAt(p, p + Vector3.new(0, 0, 1))
			end)
		end
		task.delay(0.6, function()
			reveal(0.6)
			if info.floor > 0 or info.revived then
				Sfx.play("ding", 0.35, 0.9)
			end
		end)
		if info.first or tutorialOn then
			tutorialOn = true
			tutorial.Visible = true
			if info.floor == 0 then
				tutText.Text = "Floor 0 is always normal. Look closely at everything, then walk to the EXIT at the end."
			else
				tutText.Text = "Anything different from Floor 0?  Turn back to the STAIRS.  Nothing wrong?  Go to the EXIT."
			end
			if info.floor >= 2 then
				tutorialOn = false
				task.delay(8, function()
					tutorial.Visible = false
				end)
				action:FireServer("tutorial")
			end
		end
	elseif kind == "blink" then
		blackout(0.3)
	elseif kind == "escape" then
		Sfx.play("victory", 0.6)
		task.delay(1.4, function()
			reveal(0.8)
			escTime.Text = Rules.clock(info.time)
			local best = if info.newBest then "🏆 NEW PERSONAL BEST!" else `Best: {Rules.clock(info.best)}`
			escInfo.Text = `+{info.coins} 💰   ·   Escape #{info.escapes}\n{best}`
			if openPanel then
				openPanel.Visible = false
			end
			escPanel.Visible = true
			openPanel = escPanel
			Ui.pop(escPanel, 0.6)
			tutorial.Visible = false
		end)
	elseif kind == "radar" then
		Sfx.play("radar", 0.5, 1.4)
		radarFlash.Visible = true
		radarFlash.Text = if info.anomaly then "📡 ANOMALY DETECTED: TURN BACK" else "📡 ALL CLEAR: KEEP GOING"
		radarFlash.TextColor3 = if info.anomaly then C.red else C.green
		Ui.pop(radarFlash, 0.5)
		task.delay(3, function()
			radarFlash.Visible = false
		end)
	elseif kind == "needRadar" then
		toast("No radar pings left.", "error")
		if not shopPanel.Visible then
			toggle(shopPanel)
		end
	elseif kind == "needRevive" then
		prompt("product", Config.Products.revive)
	elseif kind == "bought" then
		Sfx.play("cash", 0.5)
		toast(if info == "radar" then "+1 📡 Radar ping" else "+1 💫 Second Chance", "reward")
	elseif kind == "daily" then
		Sfx.play("reward", 0.6)
		toast(`🗓 Day {info.streak} bonus: +{info.coins} 💰`, "big")
	end
end)
