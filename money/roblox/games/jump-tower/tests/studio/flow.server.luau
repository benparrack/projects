-- Studio playtest (Server): win pads, anti-cheat check, tower clear pays once, lava -> checkpoint.
-- Needs the Studio-only ServerStorage.Debug hook. Run: tools/studio-run.sh games/jump-tower/tests/studio/flow.server.luau
local p = game.Players:GetPlayers()[1]
local D = game.ServerStorage.Debug
local out = {}
local function snap(tag)
	local s = D:Invoke(p, {})
	table.insert(out, ("%s: jump=%d wins=%d best=%d clears=%d cp=%d rebirths=%d"):format(tag, s.data.jump, s.data.wins, s.data.bestZone, s.data.clears, s.checkpoint, s.data.rebirths))
end
local pads = {}
for _, d in workspace.Map:GetDescendants() do
	if d.Name == "WinPad" then pads[d:GetAttribute("Zone")] = d end
end
-- 1) too-low jump stat can't claim zone 3
D:Invoke(p, { jump = 10 })
p.Character:PivotTo(pads[3].CFrame + Vector3.new(0, 3, 0))
task.wait(1.5)
snap("lowjump@z3")
-- 2) proper stat, claim zones 1..8 in order
D:Invoke(p, { jump = 200000 })
for z = 1, 8 do
	p.Character:PivotTo(pads[z].CFrame + Vector3.new(0, 3, 0))
	task.wait(1.2)
	if z == 1 or z == 7 then snap("after z" .. z) end
end
task.wait(3)
snap("after clear")
local r = p.Character.HumanoidRootPart.Position
table.insert(out, ("pos after clear: %.0f %.0f %.0f"):format(r.X, r.Y, r.Z))
-- 3) standing on pad again doesn't double-pay
p.Character:PivotTo(pads[1].CFrame + Vector3.new(0, 3, 0))
task.wait(1.2)
snap("z1 again (new run pays)")
p.Character:PivotTo(pads[1].CFrame + Vector3.new(0, 8, 0))
task.wait(1.2)
snap("z1 twice")
-- 4) lava -> checkpoint
p.Character:PivotTo(CFrame.new(300, 10, 300))
task.wait(2.5)
r = p.Character.HumanoidRootPart.Position
table.insert(out, ("after lava: %.0f %.0f %.0f"):format(r.X, r.Y, r.Z))
return table.concat(out, "\n")
