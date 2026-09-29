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
	music = "rbxassetid://137225378304792", -- Sweet Shop (APM)
	pop = "rbxassetid://132948338000932", -- bubble pop sound effect
	dig = "rbxassetid://9114083394", -- Dirt Dig Dirt Throws From Shovel 2 (ProSoundEffects)
	sparkle = "rbxassetid://9119447936", -- Sparkle Bell Tree Wind Chimes 1 (ProSoundEffects)
	rain = "rbxassetid://5911952995", -- Rain-Seamless Loop
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
