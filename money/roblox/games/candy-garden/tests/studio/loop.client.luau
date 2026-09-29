-- Studio playtest (run on a fresh save): the core loop through the real remotes.
-- Plant the 3 starter gumdrops, wait for them to ripen, harvest, walk to the market, sell.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local player = Players.LocalPlayer
local action = ReplicatedStorage:FindFirstChild("Action", true) :: RemoteEvent
local log = {}

local function waitFor(check: () -> boolean, timeout: number): boolean
	local t = os.clock()
	while not check() and os.clock() - t < timeout do
		task.wait(0.2)
	end
	return check()
end

local plot = player:GetAttribute("Plot")
assert(plot, "no plot assigned")
local plants = Workspace.Map.Plots:FindFirstChild("Plot" .. tostring(plot)).Plants

if not player.Character then
	player.CharacterAdded:Wait()
end
action:FireServer("teleport", "garden")
task.wait(1.5)
local coins0 = player:GetAttribute("Coins") :: number
for tile = 1, 3 do
	action:FireServer("plant", { tile = tile, seed = "gumdrop" })
end
assert(waitFor(function()
	return #plants:GetChildren() >= 3
end, 5), "planting failed")
table.insert(log, "planted 3")

assert(waitFor(function()
	for _, m in plants:GetChildren() do
		if m:GetAttribute("Ripe") ~= true then
			return false
		end
	end
	return true
end, 35), "gumdrops never ripened")
table.insert(log, "ripe")

action:FireServer("harvestAll")
assert(waitFor(function()
	return ((player:GetAttribute("BasketCount") :: number?) or 0) > 0
end, 3), "harvest put nothing in the basket")
table.insert(log, `basket {player:GetAttribute("BasketCount")} worth {player:GetAttribute("BasketValue")}`)
assert(#plants:GetChildren() == 0, "one-harvest plants should be gone")

action:FireServer("teleport", "sell")
task.wait(1)
action:FireServer("sell")
assert(waitFor(function()
	return (player:GetAttribute("Coins") :: number) > coins0
end, 3), "selling paid nothing")
assert(player:GetAttribute("BasketCount") == 0, "basket not emptied")
local found = tostring(player:GetAttribute("Found"))
assert(string.find(found, "gumdrop", 1, true), "gumdrop not added to the Index")
table.insert(log, `coins {coins0} -> {player:GetAttribute("Coins")}`)

action:FireServer("teleport", "garden")
return "PASS: " .. table.concat(log, "; ")
