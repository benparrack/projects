--!strict
-- Sound ids (free Creator Store audio) and a one-shot player.

local SoundService = game:GetService("SoundService")

local Sfx = {}

Sfx.Ids = {
	click = "rbxassetid://15675059323", -- Roblox_UI_Bright_Click (Roblox)
	reward = "rbxassetid://135483737426662", -- Coin Collect
	levelUp = "rbxassetid://112485797063762", -- UI - Level Up
	victory = "rbxassetid://3454671965", -- Badge Fanfare (Roblox)
	cash = "rbxassetid://90531793028786", -- Cash Register (Kaching)
	ding = "rbxassetid://7527328153", -- elevator ding
	slam = "rbxassetid://3908308607", -- metal door slam
	sting = "rbxassetid://9047014318", -- Beautiful Horror stinger (APM)
	heartbeat = "rbxassetid://9043365842", -- heartbeat (APM)
	whispers = "rbxassetid://85064677546638", -- whispers
	scream = "rbxassetid://130285917830946", -- Scream_Jumpscare
	run = "rbxassetid://127992015008072", -- running footsteps
	radar = "rbxassetid://9114277402", -- Electric Zaps 6 (ProSoundEffects)
	lobby = "rbxassetid://1841647093", -- Life in an Elevator (APM)
	drone = "rbxassetid://9119386571", -- low rumble drone
}

local group = Instance.new("SoundGroup")
group.Name = "Effects"
group.Volume = 1
group.Parent = SoundService
Sfx.Group = group

function Sfx.play(name: string, volume: number?, pitch: number?)
	local s = Instance.new("Sound")
	s.SoundId = Sfx.Ids[name] or name
	s.Volume = volume or 0.5
	s.PlaybackSpeed = pitch or 1
	s.SoundGroup = group
	s.Parent = SoundService
	s:Play()
	s.Ended:Once(function()
		s:Destroy()
	end)
	task.delay(10, function()
		if s.Parent then
			s:Destroy()
		end
	end)
end

-- A looping sound that stays around (music, wind).
function Sfx.loop(name: string, volume: number): Sound
	local s = Instance.new("Sound")
	s.Name = name
	s.SoundId = Sfx.Ids[name]
	s.Volume = volume
	s.Looped = true
	s.Parent = SoundService
	s:Play()
	return s
end

return Sfx
