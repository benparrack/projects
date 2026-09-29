--!strict
-- +1 Jump Tower client: HUD, panels (shop / trails / rebirth), gifts, daily reward, toasts.
-- All state comes from Player attributes set by the server; actions go through Remotes.Action.

local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Formulas = require(Shared.Formulas)
local Ui = require(script.Parent.Ui)

local player = Players.LocalPlayer
local remotes = ReplicatedStorage:WaitForChild("Remotes")
local actionRemote = remotes:WaitForChild("Action") :: RemoteEvent
local notifyRemote = remotes:WaitForChild("Notify") :: RemoteEvent

player.CameraMaxZoomDistance = 250

local C = Ui.Colors
local abbreviate = Formulas.abbreviate

local function attr(name: string, default: any): any
	local v = player:GetAttribute(name)
	if v == nil then
		return default
	end
	return v
end

local function act(name: string, arg: any?)
	actionRemote:FireServer(name, arg)
end

local Sfx = require(script.Parent.Sfx)

-- Root gui ------------------------------------------------------------------------------

local gui = Ui.new("ScreenGui", {
	Name = "JumpTowerHud",
	ResetOnSpawn = false,
	IgnoreGuiInset = false,
	ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
	Parent = player:WaitForChild("PlayerGui"),
})
local uiScale = Ui.new("UIScale", { Parent = gui })
local function rescale()
	local camera = Workspace.CurrentCamera
	if camera then
		local v = camera.ViewportSize
		uiScale.Scale = math.clamp(math.min(v.X / 1100, v.Y / 680), 0.55, 1.25)
	end
end
rescale()
if Workspace.CurrentCamera then
	Workspace.CurrentCamera:GetPropertyChangedSignal("ViewportSize"):Connect(rescale)
end

-- Top card: jump, gain, next-zone progress ----------------------------------------------

local card = Ui.new("Frame", {
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 0, 8),
	Size = UDim2.fromOffset(360, 118),
	BackgroundColor3 = C.panel,
	BackgroundTransparency = 0.15,
	Parent = gui,
}, { Ui.corner(18), Ui.stroke(Color3.fromRGB(10, 10, 20), 3) })

local jumpLabel = Ui.label({
	Position = UDim2.fromOffset(12, 4),
	Size = UDim2.new(1, -24, 0, 50),
	Text = "⬆ 0",
	TextColor3 = C.gold,
	Parent = card,
})
local gainLabel = Ui.label({
	Position = UDim2.fromOffset(12, 54),
	Size = UDim2.new(0.5, -12, 0, 22),
	Text = "+1/s",
	TextColor3 = C.green,
	TextXAlignment = Enum.TextXAlignment.Left,
	Parent = card,
})
local winsLabel = Ui.label({
	Position = UDim2.new(0.5, 0, 0, 54),
	Size = UDim2.new(0.5, -12, 0, 22),
	Text = "🏆 0",
	TextColor3 = C.gold,
	TextXAlignment = Enum.TextXAlignment.Right,
	Parent = card,
})
local barBack = Ui.new("Frame", {
	Position = UDim2.fromOffset(12, 82),
	Size = UDim2.new(1, -24, 0, 26),
	BackgroundColor3 = Color3.fromRGB(15, 16, 28),
	Parent = card,
}, { Ui.corner(10) })
local barFill = Ui.new("Frame", {
	Size = UDim2.fromScale(0, 1),
	BackgroundColor3 = Color3.new(1, 1, 1),
	Parent = barBack,
}, { Ui.corner(10), Ui.gradient(C.green, Color3.fromRGB(30, 150, 80)) })
local barLabel = Ui.label({
	Size = UDim2.fromScale(1, 1),
	Text = "",
	ZIndex = 2,
	Parent = barBack,
})

-- Toasts ------------------------------------------------------------------------------

local toastHolder = Ui.new("Frame", {
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 0, 136),
	Size = UDim2.fromOffset(520, 200),
	BackgroundTransparency = 1,
	Parent = gui,
}, {
	Ui.new("UIListLayout", {
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
		Padding = UDim.new(0, 6),
		SortOrder = Enum.SortOrder.LayoutOrder,
	}),
})
local toastOrder = 0

local function toast(text: string, kind: string)
	toastOrder += 1
	-- "win" and "big" toasts also get confetti and a fanfare from Juice.client.
	local color = if kind == "error"
		then C.red
		elseif kind == "big" or kind == "win" then C.gold
		elseif kind == "reward" then C.green
		else C.text
	local big = kind == "big"
	local label = Ui.label({
		Size = UDim2.fromOffset(if big then 520 else 440, if big then 52 else 34),
		Text = text,
		TextColor3 = color,
		LayoutOrder = toastOrder,
		Parent = toastHolder,
	})
	Ui.pop(label, 0.4)
	if kind == "reward" then
		Sfx.play("reward", 0.5)
	end
	task.delay(if big then 4 else 2.6, function()
		local t = TweenService:Create(label, TweenInfo.new(0.4), { TextTransparency = 1 })
		t:Play()
		local stroke = label:FindFirstChildOfClass("UIStroke")
		if stroke then
			TweenService:Create(stroke, TweenInfo.new(0.4), { Transparency = 1 }):Play()
		end
		t.Completed:Wait()
		label:Destroy()
	end)
end
notifyRemote.OnClientEvent:Connect(toast)

-- Panels ------------------------------------------------------------------------------

local openPanel: Frame? = nil

local function makePanel(title: string, accent: Color3): (Frame, ScrollingFrame)
	local panel = Ui.new("Frame", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.55),
		Size = UDim2.fromOffset(520, 420),
		BackgroundColor3 = C.panel,
		Visible = false,
		ZIndex = 10,
		Parent = gui,
	}, { Ui.corner(20), Ui.stroke(accent:Lerp(Color3.new(0, 0, 0), 0.4), 4) })
	Ui.label({
		Position = UDim2.fromOffset(20, 10),
		Size = UDim2.new(1, -90, 0, 44),
		Text = title,
		TextColor3 = accent,
		TextXAlignment = Enum.TextXAlignment.Left,
		ZIndex = 11,
		Parent = panel,
	})
	Ui.button({
		AnchorPoint = Vector2.new(1, 0),
		Position = UDim2.new(1, -12, 0, 10),
		Size = UDim2.fromOffset(46, 46),
		Text = "X",
		ZIndex = 11,
		Parent = panel,
	}, C.red, function()
		panel.Visible = false
		openPanel = nil
	end)
	local list = Ui.new("ScrollingFrame", {
		Position = UDim2.fromOffset(16, 66),
		Size = UDim2.new(1, -32, 1, -82),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ScrollBarThickness = 6,
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		CanvasSize = UDim2.new(),
		ZIndex = 11,
		Parent = panel,
	}, {
		Ui.new("UIListLayout", { Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	return panel, list
end

local function toggle(panel: Frame, onOpen: (() -> ())?)
	if openPanel and openPanel ~= panel then
		openPanel.Visible = false
	end
	panel.Visible = not panel.Visible
	openPanel = if panel.Visible then panel else nil
	if panel.Visible then
		if onOpen then
			onOpen()
		end
		Ui.pop(panel, 0.85)
	end
end

local function row(list: ScrollingFrame, order: number, title: string, subtitle: string, accent: Color3): Frame
	local r = Ui.new("Frame", {
		Size = UDim2.new(1, -8, 0, 64),
		BackgroundColor3 = C.panelLight,
		LayoutOrder = order,
		ZIndex = 12,
		Parent = list,
	}, { Ui.corner(12) })
	Ui.label({
		Position = UDim2.fromOffset(12, 6),
		Size = UDim2.new(1, -170, 0, 30),
		Text = title,
		TextColor3 = accent,
		TextXAlignment = Enum.TextXAlignment.Left,
		ZIndex = 13,
		Parent = r,
	})
	Ui.label({
		Position = UDim2.fromOffset(12, 36),
		Size = UDim2.new(1, -170, 0, 22),
		Text = subtitle,
		TextColor3 = C.muted,
		TextXAlignment = Enum.TextXAlignment.Left,
		ZIndex = 13,
		Parent = r,
	})
	return r
end

-- Show the live Robux price from the Creator Dashboard (it can differ from Config with
-- managed/regional pricing). Falls back to the Config price if the lookup fails.
local livePrices: { [number]: number } = {}
local function livePrice(label: TextButton, id: number, isPass: boolean): TextButton
	local function apply(p: number)
		label.Text = (string.gsub(label.Text, "R%$ %d+", "R$ " .. p, 1))
	end
	if id == 0 then
		return label
	elseif livePrices[id] then
		apply(livePrices[id])
		return label
	end
	task.spawn(function()
		local ok, info = pcall(function()
			return MarketplaceService:GetProductInfo(id, if isPass then Enum.InfoType.GamePass else Enum.InfoType.Product)
		end)
		local price = if ok and typeof(info) == "table" then info.PriceInRobux else nil
		if typeof(price) == "number" then
			livePrices[id] = price
			apply(price)
		end
	end)
	return label
end

local function rowButton(r: Frame, text: string, color: Color3, onClick: () -> ()): TextButton
	return Ui.button({
		AnchorPoint = Vector2.new(1, 0.5),
		Position = UDim2.new(1, -10, 0.5, 0),
		Size = UDim2.fromOffset(140, 46),
		Text = text,
		ZIndex = 13,
		Parent = r,
	}, color, onClick)
end

local function clear(list: ScrollingFrame)
	for _, child in list:GetChildren() do
		if child:IsA("GuiObject") then
			child:Destroy()
		end
	end
end

-- Shop: passes + products (items without an id yet show as "Soon").
local shopPanel, shopList = makePanel("🛒 SHOP", C.pink)
local function fillShop()
	clear(shopList)
	local order = 0
	for key, pass in Config.GamePasses do
		order += 1
		local owned = attr("Pass_" .. key, false)
		local r = row(shopList, order, pass.name, pass.desc, C.gold)
		if owned then
			rowButton(r, "OWNED ✓", C.green, function() end)
		elseif pass.id == 0 then
			rowButton(r, "SOON", C.muted, function() end)
		else
			livePrice(rowButton(r, `R$ {pass.price}`, C.green, function()
				MarketplaceService:PromptGamePassPurchase(player, pass.id)
			end), pass.id, true)
		end
	end
	for _, product in Config.Products do
		order += 1
		local desc = if product.kind == "jumpMinutes"
			then `+{abbreviate(attr("Gain", 1) * 60 * product.amount)} Jump right now`
			else "Instantly reach the next zone's requirement"
		local r = row(shopList, order + 100, product.name, desc, C.blue)
		if product.id == 0 then
			rowButton(r, "SOON", C.muted, function() end)
		else
			livePrice(rowButton(r, `R$ {product.price}`, C.green, function()
				MarketplaceService:PromptProductPurchase(player, product.id)
			end), product.id, false)
		end
	end
end

-- Trails: bought with Wins, give a gain bonus while equipped.
local trailsPanel, trailsList = makePanel("✨ TRAILS", C.purple)
local function fillTrails()
	clear(trailsList)
	local owned = {}
	for id in string.gmatch(attr("OwnedTrails", ""), "[^,]+") do
		owned[id] = true
	end
	local equipped = attr("Equipped", "")
	for i, t in Config.Trails do
		local c = t.colors[1]
		local r = row(
			trailsList,
			i,
			t.name,
			`+{math.floor(t.bonus * 100)}% Jump gain`,
			Color3.fromRGB(c[1], c[2], c[3])
		)
		if equipped == t.id then
			rowButton(r, "EQUIPPED", C.muted, function()
				act("equip", "")
			end)
		elseif owned[t.id] then
			rowButton(r, "EQUIP", C.blue, function()
				act("equip", t.id)
			end)
		elseif t.cost < 0 then
			rowButton(r, "VIP ONLY", C.gold, function()
				toggle(shopPanel, fillShop)
			end)
		else
			rowButton(r, `🏆 {abbreviate(t.cost)}`, if attr("Wins", 0) >= t.cost then C.green else C.muted, function()
				act("buyTrail", t.id)
			end)
		end
	end
end

-- Rebirth: trade your jump for a permanent multiplier.
local rebirthPanel, rebirthList = makePanel("🔁 REBIRTH", C.green)
local function fillRebirth()
	clear(rebirthList)
	local rebirths = attr("Rebirths", 0)
	local cost = attr("RebirthCost", Formulas.rebirthCost(0))
	local jump = attr("Jump", 0)
	local r = row(
		rebirthList,
		1,
		`Gain x{1 + rebirths}  →  x{2 + rebirths}`,
		`Costs {abbreviate(cost)} Jump (resets Jump to 0)`,
		C.green
	)
	rowButton(r, if jump >= cost then "REBIRTH!" else `{math.floor(jump / cost * 100)}%`, if jump >= cost then C.green else C.muted, function()
		act("rebirth")
		rebirthPanel.Visible = false
		openPanel = nil
	end)
	row(rebirthList, 2, "Tip", "Rebirth early and often: each one multiplies ALL future gain.", C.muted)
end

-- Side buttons ------------------------------------------------------------------------

local left = Ui.new("Frame", {
	AnchorPoint = Vector2.new(0, 0.5),
	Position = UDim2.new(0, 10, 0.5, 40), -- nudged down to clear the default chat window
	Size = UDim2.fromOffset(120, 300),
	BackgroundTransparency = 1,
	Parent = gui,
}, { Ui.new("UIListLayout", { Padding = UDim.new(0, 10), SortOrder = Enum.SortOrder.LayoutOrder }) })

Ui.button({ Size = UDim2.fromOffset(120, 60), Text = "🛒 Shop", LayoutOrder = 1, Parent = left }, C.pink, function()
	toggle(shopPanel, fillShop)
end)
Ui.button({ Size = UDim2.fromOffset(120, 60), Text = "✨ Trails", LayoutOrder = 2, Parent = left }, C.purple, function()
	toggle(trailsPanel, fillTrails)
end)
local rebirthButton = Ui.button({ Size = UDim2.fromOffset(120, 60), Text = "🔁 Rebirth", LayoutOrder = 3, Parent = left }, C.green, function()
	toggle(rebirthPanel, fillRebirth)
end)
Ui.button({ Size = UDim2.fromOffset(120, 60), Text = "🏠 Spawn", LayoutOrder = 4, Parent = left }, C.blue, function()
	act("spawn")
end)

local right = Ui.new("Frame", {
	AnchorPoint = Vector2.new(1, 0.5),
	Position = UDim2.new(1, -60, 0.5, 0), -- leaves room for the altitude meter (Juice.client)
	Size = UDim2.fromOffset(130, 150),
	BackgroundTransparency = 1,
	Parent = gui,
}, { Ui.new("UIListLayout", { Padding = UDim.new(0, 10), SortOrder = Enum.SortOrder.LayoutOrder }) })

local giftButton = Ui.button({ Size = UDim2.fromOffset(130, 64), Text = "🎁", LayoutOrder = 1, Parent = right }, C.gold, function()
	act("gift")
end)
local dailyButton = Ui.button(
	{ Size = UDim2.fromOffset(130, 64), Text = "📅 Daily!", LayoutOrder = 2, Visible = false, Parent = right },
	C.pink,
	function()
		act("daily")
	end
)

-- Live updates ------------------------------------------------------------------------

local shownJump = 0

local function updateHud()
	local jump = attr("Jump", 0)
	local gain = attr("Gain", 1)
	gainLabel.Text = `+{Formulas.rate(gain)}/s`
	winsLabel.Text = `🏆 {abbreviate(attr("Wins", 0))}`

	local need, zone = Formulas.nextZoneNeed(jump)
	if need and zone then
		local prev = if zone > 1 then Config.Zones[zone - 1].need else 0
		local t = math.clamp((jump - prev) / (need - prev), 0, 1)
		TweenService:Create(barFill, TweenInfo.new(0.3), { Size = UDim2.fromScale(t, 1) }):Play()
		local secs = math.ceil((need - jump) / math.max(gain, 1e-6))
		local eta = if secs >= 60 then `{math.floor(secs / 60)}m {secs % 60}s` else `{secs}s`
		barLabel.Text = `Zone {zone} {Config.Zones[zone].name} in {eta}`
	else
		barFill.Size = UDim2.fromScale(1, 1)
		barLabel.Text = "Whole tower unlocked! Rebirth for more gain"
	end

	local canRebirth = jump >= attr("RebirthCost", math.huge)
	rebirthButton.Text = if canRebirth then "🔁 Rebirth!" else "🔁 Rebirth"

	dailyButton.Visible = attr("DailyReady", false)

	if openPanel == rebirthPanel then
		fillRebirth()
	end
end

local function updateGift()
	local claimed = attr("GiftsClaimed", 0)
	if claimed >= Config.GiftsPerSession then
		giftButton.Text = "🎁 Done"
		return
	end
	local remaining = attr("NextGiftAt", 0) - os.time()
	if remaining <= 0 then
		giftButton.Text = "🎁 CLAIM!"
	else
		giftButton.Text = string.format("🎁 %d:%02d", remaining // 60, remaining % 60)
	end
end

-- Jump counter rolls smoothly toward the real value.
task.spawn(function()
	while true do
		local target = attr("Jump", 0)
		if math.abs(target - shownJump) < 1 or target < shownJump then
			shownJump = target
		else
			shownJump += (target - shownJump) * 0.2
		end
		jumpLabel.Text = `⬆ {abbreviate(shownJump)}`
		task.wait(0.05)
	end
end)

player:GetAttributeChangedSignal("Jump"):Connect(updateHud)
player:GetAttributeChangedSignal("Wins"):Connect(function()
	updateHud()
	if openPanel == trailsPanel then
		fillTrails()
	end
end)
for _, name in { "OwnedTrails", "Equipped" } do
	player:GetAttributeChangedSignal(name):Connect(function()
		if openPanel == trailsPanel then
			fillTrails()
		end
	end)
end
player.AttributeChanged:Connect(function(name)
	if string.sub(name, 1, 5) == "Pass_" and openPanel == shopPanel then
		fillShop()
	end
end)
player:GetAttributeChangedSignal("DailyReady"):Connect(updateHud)

task.spawn(function()
	while true do
		updateGift()
		-- Gentle pulse on claimable buttons.
		local pulse = 1 + math.sin(os.clock() * 5) * 0.04
		for _, b in { giftButton, dailyButton } do
			local s = b:FindFirstChildOfClass("UIScale")
			if s and (b.Text == "🎁 CLAIM!" or b == dailyButton) then
				s.Scale = pulse
			end
		end
		task.wait(0.1)
	end
end)

updateHud()
