--!strict
-- Global top-10 boards on OrderedDataStores, drawn on a physical sign in the world.
-- Shared by every game in this studio. Unpublished places (Studio) have no DataStores:
-- the board then says so instead of erroring.

local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")

local Leaderboard = {}

export type Board = {
	store: string, -- OrderedDataStore name
	title: string,
	color: Color3,
	cframe: CFrame, -- where the sign stands (front face points at the viewer)
	value: (player: Player) -> number?, -- nil = player not loaded yet
	format: (number) -> string,
}

local ROWS = 10
local REFRESH = 90

local function sign(board: Board, parent: Instance): (Frame, TextLabel)
	local p = Instance.new("Part")
	p.Name = "Leaderboard_" .. board.store
	p.Anchored = true
	p.Size = Vector3.new(18, 24, 1)
	p.CFrame = board.cframe
	p.Material = Enum.Material.SmoothPlastic
	p.Color = Color3.fromRGB(25, 25, 40)
	p.Parent = parent
	local trim = Instance.new("Part")
	trim.Anchored = true
	trim.CanCollide = false
	trim.Size = p.Size + Vector3.new(0.8, 0.8, -0.4)
	trim.CFrame = p.CFrame
	trim.Material = Enum.Material.Neon
	trim.Color = board.color
	trim.Parent = parent

	local gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Front
	gui.LightInfluence = 0
	gui.PixelsPerStud = 30
	gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	gui.Parent = p

	local title = Instance.new("TextLabel")
	title.Size = UDim2.fromScale(1, 0.12)
	title.BackgroundTransparency = 1
	title.Font = Enum.Font.FredokaOne
	title.TextScaled = true
	title.TextColor3 = board.color
	title.Text = board.title
	title.Parent = gui

	local list = Instance.new("Frame")
	list.Position = UDim2.fromScale(0.04, 0.13)
	list.Size = UDim2.fromScale(0.92, 0.85)
	list.BackgroundTransparency = 1
	list.Parent = gui
	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Padding = UDim.new(0.005, 0)
	layout.Parent = list

	local status = title:Clone()
	status.Position = UDim2.fromScale(0.05, 0.4)
	status.Size = UDim2.fromScale(0.9, 0.2)
	status.TextColor3 = Color3.fromRGB(190, 190, 215)
	status.Text = "Loading..."
	status.Parent = gui
	return list, status
end

local function row(list: Frame, rank: number, name: string, value: string)
	local r = Instance.new("Frame")
	r.Size = UDim2.fromScale(1, 1 / ROWS - 0.006)
	r.BackgroundColor3 = if rank % 2 == 0 then Color3.fromRGB(40, 42, 64) else Color3.fromRGB(32, 34, 54)
	r.LayoutOrder = rank
	r.Parent = list
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0.2, 0)
	corner.Parent = r
	local medal = { Color3.fromRGB(255, 210, 70), Color3.fromRGB(210, 215, 230), Color3.fromRGB(230, 150, 90) }
	local cells = {
		{ text = `#{rank}`, x = 0.02, w = 0.14 },
		{ text = name, x = 0.17, w = 0.53 },
		{ text = value, x = 0.7, w = 0.28 },
	}
	for i, spec in cells do
		local t = Instance.new("TextLabel")
		t.BackgroundTransparency = 1
		t.Position = UDim2.fromScale(spec.x, 0.1)
		t.Size = UDim2.fromScale(spec.w, 0.8)
		t.Font = Enum.Font.FredokaOne
		t.TextScaled = true
		t.TextXAlignment = if i == 3 then Enum.TextXAlignment.Right else Enum.TextXAlignment.Left
		t.TextColor3 = if i ~= 3 and rank <= 3 then medal[rank] else Color3.new(1, 1, 1)
		t.Text = spec.text
		t.Parent = r
	end
end

local nameCache: { [number]: string } = {}
local function nameOf(userId: number): string
	if nameCache[userId] then
		return nameCache[userId]
	end
	local ok, name = pcall(function()
		return Players:GetNameFromUserIdAsync(userId)
	end)
	local result = if ok and name then name else "Player"
	nameCache[userId] = result
	return result
end

local function refresh(board: Board, store: OrderedDataStore, list: Frame, status: TextLabel)
	-- Push everyone online first so the board reflects the current server immediately.
	for _, player in Players:GetPlayers() do
		local v = board.value(player)
		if v then
			pcall(function()
				store:SetAsync(tostring(player.UserId), math.floor(v))
			end)
		end
	end
	local ok, pages = pcall(function()
		return store:GetSortedAsync(false, ROWS)
	end)
	if not ok then
		status.Text = "Leaderboard offline, try again soon"
		status.Visible = true
		return
	end
	for _, c in list:GetChildren() do
		if c:IsA("Frame") then
			c:Destroy()
		end
	end
	local entries = (pages :: DataStorePages):GetCurrentPage()
	for rank, e in entries do
		row(list, rank, nameOf(tonumber(e.key) or 0), board.format(e.value))
	end
	status.Visible = #entries == 0
	status.Text = "Be the first on the board!"
end

function Leaderboard.start(boards: { Board }, parent: Instance)
	for _, board in boards do
		local list, status = sign(board, parent)
		local ok, store = pcall(function()
			return DataStoreService:GetOrderedDataStore(board.store)
		end)
		if not ok or game.GameId == 0 then
			status.Text = "Global top 10 goes live when the game is published"
			continue
		end
		task.spawn(function()
			task.wait(5) -- let saves load first
			while true do
				refresh(board, store :: OrderedDataStore, list, status)
				task.wait(REFRESH)
			end
		end)
	end
end

return Leaderboard
