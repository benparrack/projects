--!strict
-- Session-locked player saves on DataStoreService, shared by every game in this studio.
--
--   * One key per player; stored value is { data = <game data>, lock = { job, time } | nil }.
--   * load takes a lock so two servers can never both own a player's data; a lock older
--     than LOCK_TIMEOUT (crashed server) is taken over.
--   * save refuses to write if another server has stolen the lock, and reports the
--     profile as lost so the game can kick the player instead of clobbering newer data.
--   * Missing keys are filled in from the template, so adding fields later is safe.
--
-- Everything Roblox-specific is injectable through `opts`, so the logic runs under Lune.

local SaveStore = {}
SaveStore.__index = SaveStore

local LOCK_TIMEOUT = 30 * 60
local LOAD_ATTEMPTS = 5
local RETRY_DELAY = 6

export type Profile = {
	key: string,
	data: any,
	lost: boolean,
	released: boolean,
	memoryOnly: boolean,
}

export type Options = {
	dataStore: any?,
	jobId: string?,
	now: (() -> number)?,
	wait: ((number) -> ())?,
	-- Called when data can't be loaded or another server takes the session.
	onFail: ((player: any, reason: string) -> ())?,
}

local function deepCopy(value: any): any
	if type(value) ~= "table" then
		return value
	end
	local out = {}
	for k, v in value do
		out[k] = deepCopy(v)
	end
	return out
end

-- Fills keys missing from `data` with copies of the template's defaults (recursively for dict tables).
local function reconcile(data: any, template: any)
	for k, v in template do
		if data[k] == nil then
			data[k] = deepCopy(v)
		elseif type(v) == "table" and type(data[k]) == "table" and next(v) ~= nil and #v == 0 then
			reconcile(data[k], v)
		end
	end
end
SaveStore.reconcile = reconcile

function SaveStore.new(name: string, template: any, opts: Options?)
	local o: Options = opts or {}
	local self = setmetatable({}, SaveStore)
	self.name = name
	self.template = template
	self.profiles = {} :: { [any]: Profile }
	self.now = (o.now or os.time) :: () -> number
	self.wait = o.wait or function(t)
		task.wait(t)
	end
	self.onFail = o.onFail
	self.store = o.dataStore
	self.jobId = o.jobId
	if not self.jobId then
		self.jobId = if game.JobId ~= "" then game.JobId else game:GetService("HttpService"):GenerateGUID(false)
	end
	if not self.store then
		local ok, store = pcall(function()
			return game:GetService("DataStoreService"):GetDataStore(name)
		end)
		if ok then
			self.store = store
		else
			warn(`[SaveStore] DataStore unavailable ({store}); saves are memory-only`)
		end
	end
	return self
end

-- Loads (and locks) a key. Returns the data table, or nil + reason on failure.
function SaveStore:loadKey(key: string): (any, string?)
	if not self.store then
		return nil, "no datastore"
	end
	local lastErr = "unknown"
	for attempt = 1, LOAD_ATTEMPTS do
		local lockedByOther = false
		local ok, result = pcall(function()
			return self.store:UpdateAsync(key, function(old: any): any
				old = old or {}
				local lock = old.lock
				local now: number = self.now()
				if
					lock
					and lock.job ~= self.jobId
					and now - lock.time < LOCK_TIMEOUT
					and attempt < LOAD_ATTEMPTS
				then
					lockedByOther = true
					return nil -- cancel the write and retry shortly
				end
				old.lock = { job = self.jobId, time = now }
				return old
			end)
		end)
		if ok and not lockedByOther then
			local data = (result and result.data) or {}
			reconcile(data, self.template)
			return data, nil
		end
		lastErr = if lockedByOther then "session locked by another server" else tostring(result)
		if attempt < LOAD_ATTEMPTS then
			self.wait(if lockedByOther then RETRY_DELAY else attempt)
		end
	end
	return nil, lastErr
end

-- Writes a profile. `release` drops the session lock (player leaving / server closing).
function SaveStore:saveProfile(profile: Profile, release: boolean?): boolean
	if profile.memoryOnly or profile.lost or not self.store then
		return profile.memoryOnly
	end
	local stolen = false
	local ok, err = pcall(function()
		self.store:UpdateAsync(profile.key, function(old: any): any
			old = old or {}
			if old.lock and old.lock.job ~= self.jobId then
				stolen = true
				return nil
			end
			old.data = profile.data
			old.lock = if release then nil else { job = self.jobId, time = self.now() }
			return old
		end)
	end)
	if stolen then
		profile.lost = true
		return false
	end
	if not ok then
		warn(`[SaveStore] save failed for {profile.key}: {err}`)
	end
	return ok
end

-- Loads a player's profile. On failure the player is handed to onFail (normally a kick),
-- except in Studio where we fall back to fresh memory-only data so playtests still work.
function SaveStore:attach(player: any, isStudio: boolean?): Profile?
	local key = "p_" .. tostring(player.UserId)
	local data, err = self:loadKey(key)
	local memoryOnly = false
	if not data then
		if isStudio then
			warn(`[SaveStore] {err}; using memory-only data in Studio`)
			data = deepCopy(self.template)
			memoryOnly = true
		else
			if self.onFail then
				self.onFail(player, err or "load failed")
			end
			return nil
		end
	end
	local profile: Profile = { key = key, data = data, lost = false, released = false, memoryOnly = memoryOnly }
	self.profiles[player] = profile
	return profile
end

function SaveStore:get(player: any): Profile?
	return self.profiles[player]
end

-- Waits up to `timeout` seconds for a player's profile (for ProcessReceipt etc.).
function SaveStore:waitFor(player: any, timeout: number): Profile?
	local waited = 0
	while not self.profiles[player] and waited < timeout do
		self.wait(0.5)
		waited += 0.5
	end
	return self.profiles[player]
end

function SaveStore:release(player: any)
	local profile = self.profiles[player]
	if not profile or profile.released then
		return
	end
	profile.released = true
	self:saveProfile(profile, true)
	self.profiles[player] = nil
end

-- Wires PlayerRemoving, a periodic autosave and BindToClose. Call once from the server.
function SaveStore:start(autosaveSeconds: number?)
	local Players = game:GetService("Players")
	Players.PlayerRemoving:Connect(function(player)
		self:release(player)
	end)
	task.spawn(function()
		while true do
			task.wait(autosaveSeconds or 60)
			for player, profile in self.profiles do
				task.spawn(function()
					self:saveProfile(profile)
					if profile.lost and self.onFail then
						self.onFail(player, "session taken by another server")
					end
				end)
			end
		end
	end)
	game:BindToClose(function()
		local pending = 0
		for player in self.profiles do
			pending += 1
			task.spawn(function()
				self:release(player)
				pending -= 1
			end)
		end
		local t = 0
		while pending > 0 and t < 25 do
			t += task.wait(0.1)
		end
	end)
end

return SaveStore
