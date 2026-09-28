-- Studio playtest (Client): physically jumps every ledge with exactly its stated jump requirement,
-- from a running start at the nearest edge. Run: tools/studio-run.sh games/jump-tower/tests/studio/climb.client.luau
-- Run it in a fresh playtest: a large real Jump stat makes the server push a bigger JumpPower mid-test.
local RS = game.ReplicatedStorage
local TowerLayout = require(RS.Shared.TowerLayout)
local Formulas = require(RS.Shared.Formulas)
local Config = require(RS.Shared.Config)
local p = game.Players.LocalPlayer
local char = p.Character
local hum = char.Humanoid
local root = char.HumanoidRootPart
local ledges = TowerLayout.build()
local controls = require(p.PlayerScripts:WaitForChild("PlayerModule")):GetControls()
controls:Disable()
local savedMove = controls.moveFunction
controls.moveFunction = function() end
local results = {}
local picks = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40 }
-- The server re-sends the real JumpPower every second; if that lands on the jump frame the
-- attempt is invalid, so each step gets one retry. Failing twice is a real failure.
local function attempt(i: number): (boolean, string)
	local from = ledges[i - 1]
	local to = ledges[i]
	local fromPos = if from then Vector3.new(from.x, from.top + 3, from.z) else Vector3.new(0, 3, 80)
	-- stand on the far side of the "from" ledge, away from target, like a real player would be
	local dir = (Vector3.new(to.x, 0, to.z) - Vector3.new(fromPos.X, 0, fromPos.Z)).Unit
	-- Running start from the edge nearest the target, as a real player would.
	local start = fromPos + dir * (if from then Config.PillarSize / 2 - 2.5 else 0)
	if not from then
		start = Vector3.new(to.x, 3, to.z) - dir * (Config.PillarSize / 2 + 4)
	end
	root.AssemblyLinearVelocity = Vector3.zero
	char:PivotTo(CFrame.lookAt(start, start + dir))
	task.wait(0.4)
	-- Main's tick resets JumpPower from the saved jump stat; set the stat to exactly the stated need
	local jumpStat = math.ceil(to.need)
	p:SetAttribute("TestJump", jumpStat)
	hum.JumpPower = Formulas.jumpPower(Formulas.jumpHeight(jumpStat))
	root.AssemblyLinearVelocity = dir * 22
	hum:ChangeState(Enum.HumanoidStateType.Jumping)
	local t0 = os.clock()
	local landed = false
	while os.clock() - t0 < 6 do
		hum.JumpPower = Formulas.jumpPower(Formulas.jumpHeight(jumpStat))
		local flat = Vector3.new(to.x - root.Position.X, 0, to.z - root.Position.Z)
		local v = root.AssemblyLinearVelocity
		local steer = if flat.Magnitude > 2 then flat.Unit * math.min(22, flat.Magnitude * 8) else Vector3.zero
		root.AssemblyLinearVelocity = Vector3.new(steer.X, v.Y, steer.Z)
		local pos = root.Position
		if math.abs(pos.Y - (to.top + 3)) < 1.5 and (Vector3.new(pos.X, 0, pos.Z) - Vector3.new(to.x, 0, to.z)).Magnitude < 12 and root.AssemblyLinearVelocity.Magnitude < 5 then
			landed = true
			break
		end
		task.wait()
	end
	hum:Move(Vector3.zero)
	return landed, ("FAIL y=%.0f want %.0f"):format(root.Position.Y, to.top + 3)
end

for _, i in picks do
	local ok, detail = attempt(i)
	if not ok then
		ok, detail = attempt(i)
	end
	table.insert(results, string.format("%d:%s", i, if ok then "ok" else detail))
end
controls.moveFunction = savedMove
controls:Enable()
return table.concat(results, " ")
