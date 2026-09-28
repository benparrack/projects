--!strict
-- Game passes + developer products, shared by every game in this studio.
--
-- Developer product receipts are processed idempotently: each PurchaseId is recorded in
-- the player's save data (profile.data.receipts) and the save is flushed before we tell
-- Roblox the purchase is granted, so a crash or a Roblox retry can never grant twice or
-- charge without granting.

local Monetization = {}
Monetization.__index = Monetization

local MAX_RECEIPTS = 100

export type ProductHandler = (player: any, profile: any) -> boolean

export type Options = {
	store: any, -- a SaveStore
	passes: { [string]: number }, -- key -> game pass id (0 = not created yet)
	products: { [number]: ProductHandler }, -- product id -> grant function
	onPassOwned: ((player: any, key: string) -> ())?,
	-- Injectable for tests:
	getPlayer: ((userId: number) -> any)?,
	decisions: { Granted: any, NotProcessedYet: any }?,
	now: (() -> number)?,
}

function Monetization.new(opts: Options)
	local self = setmetatable({}, Monetization)
	self.store = opts.store
	self.passes = opts.passes
	self.products = opts.products
	self.onPassOwned = opts.onPassOwned
	self.owned = {} :: { [any]: { [string]: boolean } }
	self.now = opts.now or os.time
	self.getPlayer = opts.getPlayer
		or function(userId)
			return game:GetService("Players"):GetPlayerByUserId(userId)
		end
	self.decisions = opts.decisions
		or {
			Granted = Enum.ProductPurchaseDecision.PurchaseGranted,
			NotProcessedYet = Enum.ProductPurchaseDecision.NotProcessedYet,
		}
	return self
end

function Monetization:ownsPass(player: any, key: string): boolean
	local owned = self.owned[player]
	return owned ~= nil and owned[key] == true
end

function Monetization:_setOwned(player: any, key: string)
	self.owned[player] = self.owned[player] or {}
	if not self.owned[player][key] then
		self.owned[player][key] = true
		if self.onPassOwned then
			self.onPassOwned(player, key)
		end
	end
end

-- Checks every configured pass for a joining player.
function Monetization:loadPasses(player: any)
	local MarketplaceService = game:GetService("MarketplaceService")
	self.owned[player] = self.owned[player] or {}
	for key, id in self.passes do
		if id ~= 0 then
			local ok, owns = pcall(function()
				return MarketplaceService:UserOwnsGamePassAsync(player.UserId, id)
			end)
			if ok and owns then
				self:_setOwned(player, key)
			end
		end
	end
end

local function pruneReceipts(receipts: { [string]: number })
	local count = 0
	for _ in receipts do
		count += 1
	end
	if count <= MAX_RECEIPTS then
		return
	end
	local list = {}
	for id, t in receipts do
		table.insert(list, { id = id, t = t })
	end
	table.sort(list, function(a, b)
		return a.t < b.t
	end)
	for i = 1, count - MAX_RECEIPTS do
		receipts[list[i].id] = nil
	end
end

function Monetization:processReceipt(receipt: any): any
	local player = self.getPlayer(receipt.PlayerId)
	if not player then
		return self.decisions.NotProcessedYet -- Roblox retries next time they join
	end
	local profile = self.store:waitFor(player, 10)
	if not profile or profile.lost then
		return self.decisions.NotProcessedYet
	end
	local receipts = profile.data.receipts
	local purchaseId = tostring(receipt.PurchaseId)
	if receipts[purchaseId] then
		return self.decisions.Granted
	end
	local handler = self.products[receipt.ProductId]
	if not handler then
		warn(`[Monetization] no handler for product {receipt.ProductId}`)
		return self.decisions.NotProcessedYet
	end
	local ok, granted = pcall(handler, player, profile)
	if not ok or not granted then
		warn(`[Monetization] grant failed for {receipt.ProductId}: {granted}`)
		return self.decisions.NotProcessedYet
	end
	receipts[purchaseId] = self.now()
	pruneReceipts(receipts)
	if not self.store:saveProfile(profile) then
		-- The grant and receipt stay in memory; Roblox will retry, see the receipt and confirm.
		return self.decisions.NotProcessedYet
	end
	return self.decisions.Granted
end

-- Hooks ProcessReceipt and pass purchase events. Call once from the server.
function Monetization:start()
	local MarketplaceService = game:GetService("MarketplaceService")
	local Players = game:GetService("Players")
	MarketplaceService.ProcessReceipt = function(receipt)
		return self:processReceipt(receipt)
	end
	MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, passId, purchased)
		if not purchased then
			return
		end
		for key, id in self.passes do
			if id == passId then
				self:_setOwned(player, key)
			end
		end
	end)
	Players.PlayerRemoving:Connect(function(player)
		self.owned[player] = nil
	end)
end

return Monetization
