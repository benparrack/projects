-- Studio playtest: equip the Zapper and fire it with no one around (must not error, must respect cooldown).
local player = game:GetService("Players").LocalPlayer
local character = player.Character
local tool = player.Backpack:FindFirstChild("Zapper") or character:FindFirstChild("Zapper")
assert(tool, "no Zapper tool")
character:FindFirstChildOfClass("Humanoid"):EquipTool(tool)
task.wait(0.5)
tool:Activate()
task.wait(0.3)
tool:Activate()
task.wait(1)
return "zapped; equipped=" .. tostring(tool.Parent == character)
