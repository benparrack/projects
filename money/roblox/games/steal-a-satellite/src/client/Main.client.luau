--!strict
-- Steal a Satellite client: HUD, panels (shop / index / rebirth), daily reward, toasts.

local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Formulas = require(Shared.Formulas)
local Ui = require(script.Parent.Ui)
local Sfx = require(script.Parent.Sfx)

local player = Players.LocalPlayer
local remotes = ReplicatedStorage:WaitForChild("Remotes")
local actionRemote = remotes:WaitForChild("Action") :: RemoteEvent
local notifyRemote = remotes:WaitForChild("Notify") :: RemoteEvent

local C = Ui.Colors
local cash = Formulas.cash

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

local function rgb(c: { number }): Color3
	return Color3.fromRGB(c[1], c[2], c[3])
end

-- Root gui ------------------------------------------------------------------------------

local gui = Ui.new("ScreenGui", {
	Name = "SatHud",
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

-- Top card: cash, income, pads ------------------------------------------------------------

local card = Ui.new("Frame", {
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 0, 8),
	Size = UDim2.fromOffset(340, 92),
	BackgroundColor3 = C.panel,
	BackgroundTransparency = 0.15,
	Parent = gui,
}, { Ui.corner(18), Ui.stroke(Color3.fromRGB(10, 10, 20), 3) })

local cashLabel = Ui.label({
	Position = UDim2.fromOffset(12, 4),
	Size = UDim2.new(1, -24, 0, 52),
	Text = "$0",
	TextColor3 = Color3.fromRGB(120, 255, 140),
	Parent = card,
})
local incomeLabel = Ui.label({
	Position = UDim2.fromOffset(14, 58),
	Size = UDim2.new(0.55, -14, 0, 24),
	Text = "+$0/s",
	TextColor3 = C.gold,
	TextXAlignment = Enum.TextXAlignment.Left,
	Parent = card,
})
local padsLabel = Ui.label({
	Position = UDim2.new(0.55, 0, 0, 58),
	Size = UDim2.new(0.45, -14, 0, 24),
	Text = "🛰 0/8",
	TextColor3 = C.blue,
	TextXAlignment = Enum.TextXAlignment.Right,
	Parent = card,
})

-- Status chips under the card: lock state and server luck.
local chips = Ui.new("Frame", {
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 0, 106),
	Size = UDim2.fromOffset(520, 30),
	BackgroundTransparency = 1,
	Parent = gui,
}, {
	Ui.new("UIListLayout", {
		FillDirection = Enum.FillDirection.Horizontal,
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
		Padding = UDim.new(0, 8),
	}),
})
local function chip(color: Color3): TextLabel
	local frame = Ui.new("Frame", {
		Size = UDim2.fromOffset(260, 30),
		BackgroundColor3 = color:Lerp(Color3.new(0, 0, 0), 0.55),
		BackgroundTransparency = 0.2,
		Visible = false,
		Parent = chips,
	}, { Ui.corner(10) })
	return Ui.label({ Size = UDim2.new(1, -12, 1, -4), Position = UDim2.fromOffset(6, 2), Text = "", TextColor3 = color, Parent = frame })
end
local lockChip = chip(C.blue)
local luckChip = chip(C.green)

-- Toasts ------------------------------------------------------------------------------

local toastHolder = Ui.new("Frame", {
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 0, 142),
	Size = UDim2.fromOffset(560, 220),
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
	local color = if kind == "error" or kind == "alarm"
		then C.red
		elseif kind == "big" or kind == "win" then C.gold
		elseif kind == "reward" or kind == "good" then C.green
		else C.text
	local big = kind == "big" or kind == "alarm"
	local label = Ui.label({
		Size = UDim2.fromOffset(if big then 560 else 460, if big then 50 else 34),
		Text = text,
		TextColor3 = color,
		LayoutOrder = toastOrder,
		Parent = toastHolder,
	})
	Ui.pop(label, 0.4)
	if kind == "reward" then
		Sfx.play("cash", 0.45)
	elseif kind == "error" then
		Sfx.play("click", 0.4, 0.6)
	end
	local children = toastHolder:GetChildren()
	if #children > 6 then
		-- Keep the stack short: drop the oldest.
		for _, c in children do
			if c:IsA("TextLabel") and c ~= label then
				c:Destroy()
				break
			end
		end
	end
	task.delay(if big then 4 else 2.6, function()
		if not label.Parent then
			return
		end
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

local function makePanel(title: string, accent: Color3, height: number?): (Frame, ScrollingFrame)
	local panel = Ui.new("Frame", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.55),
		Size = UDim2.fromOffset(560, height or 440),
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
local PASS_ORDER = { "x2Cash", "vip", "biggerBase", "speedyThief" }
local PRODUCT_ORDER = { "cashSmall", "cashLarge", "shield", "luck" }
local function fillShop()
	clear(shopList)
	for i, key in PASS_ORDER do
		local pass = Config.GamePasses[key]
		local r = row(shopList, i, pass.name, pass.desc, C.gold)
		if attr("Pass_" .. key, false) then
			rowButton(r, "OWNED ✓", C.green, function() end)
		elseif pass.id == 0 then
			rowButton(r, "SOON", C.muted, function() end)
		else
			rowButton(r, `R$ {pass.price}`, C.green, function()
				MarketplaceService:PromptGamePassPurchase(player, pass.id)
			end)
		end
	end
	for i, key in PRODUCT_ORDER do
		local product = Config.Products[key]
		local desc = if product.kind == "incomeMinutes"
			then `+{cash(math.max(attr("Income", 0) * 60 * product.amount, 500 * product.amount))} right now`
			elseif product.kind == "shield" then "Nobody can enter your base for 10 minutes"
			else "Doubles Epic+ odds for EVERYONE here (see 📖 Index)"
		local r = row(shopList, 10 + i, product.name, desc, C.blue)
		if product.id == 0 then
			rowButton(r, "SOON", C.muted, function() end)
		else
			rowButton(r, `R$ {product.price}`, C.green, function()
				MarketplaceService:PromptProductPurchase(player, product.id)
			end)
		end
	end
end

-- Index: every satellite with its belt odds (normal and with Server Luck), income and whether
-- you've owned one. Odds are shown up front because Server Luck is a paid boost.
local indexPanel, indexList = makePanel("📖 SATELLITE INDEX", C.blue, 480)
local function fillIndex()
	clear(indexList)
	local found = {}
	for id in string.gmatch(attr("Found", ""), "[^,]+") do
		found[id] = true
	end
	local count = 0
	for _ in found do
		count += 1
	end
	local header = Ui.label({
		Size = UDim2.new(1, -8, 0, 28),
		Text = `Discovered {count}/{#Config.Satellites}  ·  odds per belt spawn (🍀 = with Server Luck)`,
		TextColor3 = C.muted,
		LayoutOrder = 0,
		ZIndex = 12,
		Parent = indexList,
	})
	header.TextScaled = true
	for i, sat in Config.Satellites do
		local rarity = Config.Rarities[sat.tier]
		local have = found[sat.id] == true
		local color = if sat.tier == 8 then Color3.fromRGB(230, 230, 255) else rgb(rarity.color)
		local r = row(
			indexList,
			i,
			`{if have then "✅ " else "❔ "}{sat.name}`,
			`{rarity.name} · {cash(sat.price)} · +{cash(sat.income)}/s`,
			color
		)
		Ui.label({
			AnchorPoint = Vector2.new(1, 0),
			Position = UDim2.new(1, -12, 0, 8),
			Size = UDim2.fromOffset(150, 26),
			Text = Formulas.oddsLabel(Formulas.satOdds(sat.id, false)),
			TextColor3 = C.text,
			TextXAlignment = Enum.TextXAlignment.Right,
			ZIndex = 13,
			Parent = r,
		})
		Ui.label({
			AnchorPoint = Vector2.new(1, 0),
			Position = UDim2.new(1, -12, 0, 36),
			Size = UDim2.fromOffset(150, 20),
			Text = "🍀 " .. Formulas.oddsLabel(Formulas.satOdds(sat.id, true)),
			TextColor3 = C.green,
			TextXAlignment = Enum.TextXAlignment.Right,
			ZIndex = 13,
			Parent = r,
		})
	end
end

-- Rebirth.
local rebirthPanel, rebirthList = makePanel("🔁 REBIRTH", C.green, 340)
local function fillRebirth()
	clear(rebirthList)
	local rebirths = attr("Rebirths", 0)
	local cost = attr("RebirthCost", Formulas.rebirthCost(rebirths))
	local bonus = math.floor(Config.RebirthIncomeBonus * 100)
	local lines = {
		`Rebirths: {rebirths}  ·  income now x{1 + Config.RebirthIncomeBonus * rebirths}`,
		`Rebirthing gives +{bonus}% income forever`,
		if rebirths < Config.RebirthMaxExtraSlots then "and +1 satellite pad" else "(pad bonus maxed)",
		`You keep: rebirths, steals, index  ·  You lose: cash + satellites`,
	}
	for i, text in lines do
		Ui.label({
			Size = UDim2.new(1, -8, 0, if i == 4 then 24 else 32),
			Text = text,
			TextColor3 = if i == 4 then C.muted else C.text,
			LayoutOrder = i,
			ZIndex = 12,
			Parent = rebirthList,
		})
	end
	local canAfford = attr("Cash", 0) >= cost
	local button = Ui.button({
		Size = UDim2.new(1, -8, 0, 64),
		Text = if canAfford then `REBIRTH for {cash(cost)}` else `Need {cash(cost)}`,
		LayoutOrder = 10,
		ZIndex = 12,
		Parent = rebirthList,
	}, if canAfford then C.green else C.muted, function()
		if attr("Cash", 0) >= cost then
			act("rebirth")
			rebirthPanel.Visible = false
			openPanel = nil
		end
	end)
	button.ZIndex = 12
end

-- Left button column ---------------------------------------------------------------------

local column = Ui.new("Frame", {
	Name = "Column",
	AnchorPoint = Vector2.new(0, 0.5),
	Position = UDim2.new(0, 10, 0.5, 0),
	Size = UDim2.fromOffset(84, 420),
	BackgroundTransparency = 1,
	Parent = gui,
}, { Ui.new("UIListLayout", { Padding = UDim.new(0, 10), SortOrder = Enum.SortOrder.LayoutOrder }) })

local function sideButton(order: number, icon: string, text: string, color: Color3, onClick: () -> ()): TextButton
	local b = Ui.button({ Name = text, Size = UDim2.fromOffset(84, 70), Text = "", LayoutOrder = order, Parent = column }, color, onClick)
	Ui.label({ Size = UDim2.fromScale(1, 0.62), Text = icon, Parent = b })
	Ui.label({ Position = UDim2.fromScale(0, 0.6), Size = UDim2.fromScale(1, 0.4), Text = text, Parent = b })
	return b
end

sideButton(1, "🛒", "SHOP", C.pink, function()
	toggle(shopPanel, fillShop)
end)
sideButton(2, "📖", "INDEX", C.blue, function()
	toggle(indexPanel, fillIndex)
end)
sideButton(3, "🔁", "REBIRTH", C.green, function()
	toggle(rebirthPanel, fillRebirth)
end)
local dailyButton = sideButton(4, "🎁", "DAILY", C.gold, function()
	act("daily")
end)
sideButton(5, "🏠", "HOME", C.purple, function()
	act("home")
end)

-- Refresh ----------------------------------------------------------------------------------

local shownCash = 0
local function refresh()
	local c = attr("Cash", 0)
	if c > shownCash then
		-- Tween the number up so earnings feel alive.
		local from = shownCash
		shownCash = c
		local start = os.clock()
		task.spawn(function()
			while os.clock() - start < 0.4 and shownCash == c do
				local a = (os.clock() - start) / 0.4
				cashLabel.Text = cash(from + (c - from) * a)
				task.wait()
			end
			if shownCash == c then
				cashLabel.Text = cash(c)
			end
		end)
	else
		shownCash = c
		cashLabel.Text = cash(c)
	end
	incomeLabel.Text = `+{cash(attr("Income", 0))}/s`
	padsLabel.Text = `🛰 {attr("Used", 0)}/{attr("Slots", Config.BaseSlots)}`
	dailyButton.Visible = attr("DailyReady", false)
end
player.AttributeChanged:Connect(function(name)
	if name == "Cash" or name == "Income" or name == "Used" or name == "Slots" or name == "DailyReady" then
		refresh()
	end
	if name == "Found" and indexPanel.Visible then
		fillIndex()
	end
end)
refresh()

-- Chips tick.
task.spawn(function()
	while true do
		local t = Workspace:GetServerTimeNow()
		local lockLeft = attr("LockedUntil", 0) - t
		local chipFrame = lockChip.Parent :: Frame
		if lockLeft > 0 then
			chipFrame.Visible = true
			lockChip.Text = `🔒 Base locked {math.ceil(lockLeft)}s`
			lockChip.TextColor3 = C.blue
		elseif attr("Used", 0) > 0 then
			chipFrame.Visible = true
			lockChip.Text = "🔓 Unlocked! Step on the red pad"
			lockChip.TextColor3 = if math.floor(t * 2) % 2 == 0 then C.red else Color3.fromRGB(255, 180, 180)
		else
			chipFrame.Visible = false
		end
		local luckLeft = (Workspace:GetAttribute("LuckUntil") or 0) - t
		local luckFrame = luckChip.Parent :: Frame
		luckFrame.Visible = luckLeft > 0
		if luckLeft > 0 then
			luckChip.Text = `🍀 Server Luck {math.floor(luckLeft / 60)}:{string.format("%02d", math.floor(luckLeft % 60))}`
		end
		task.wait(0.25)
	end
end)
