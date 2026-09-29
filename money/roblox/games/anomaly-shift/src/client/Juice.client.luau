--!strict
-- Anomaly Shift world effects: first-person camera in the corridor, lobby music, the
-- elevator, and client-side animation for anomalies (anything in your corridor's Props
-- carrying an "Fx" attribute: spin, track, eye, stalk, run, shake, clock, drip).

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local Sfx = require(script.Parent:WaitForChild("Sfx"))

local player = Players.LocalPlayer
local camera = Workspace.CurrentCamera
local action = ReplicatedStorage:WaitForChild("Remotes"):WaitForChild("Action") :: RemoteEvent

-- Camera + ambience ------------------------------------------------------------------------

local lobbyMusic = Sfx.loop("lobby", 0.22)
local drone = Sfx.loop("drone", 0)

local function applyMode()
	local inShift = player:GetAttribute("InShift") == true
	if inShift then
		player.CameraMode = Enum.CameraMode.LockFirstPerson
		camera.FieldOfView = 72
		TweenService:Create(lobbyMusic, TweenInfo.new(1), { Volume = 0 }):Play()
		TweenService:Create(drone, TweenInfo.new(2), { Volume = 0.12 }):Play()
	else
		player.CameraMode = Enum.CameraMode.Classic
		-- Classic keeps the first-person zoom; push the camera back out, then free it again
		player.CameraMinZoomDistance = 12
		task.delay(0.3, function()
			player.CameraMinZoomDistance = 0.5
		end)
		camera.FieldOfView = 70
		TweenService:Create(lobbyMusic, TweenInfo.new(2), { Volume = 0.22 }):Play()
		TweenService:Create(drone, TweenInfo.new(1), { Volume = 0 }):Play()
	end
end
player:GetAttributeChangedSignal("InShift"):Connect(applyMode)
applyMode()

-- Anomaly animation ----------------------------------------------------------------------------

type Anim = { inst: Instance, kind: string, state: { [string]: any } }
local anims: { Anim } = {}
local propsBorn = os.clock()
local heart: Sound? = nil

local function myHead(): BasePart?
	local char = player.Character
	return char and char:FindFirstChild("Head") :: BasePart?
end

local function stopHeart()
	if heart then
		heart:Destroy()
		heart = nil
	end
end

local function register(inst: Instance)
	local kind = inst:GetAttribute("Fx")
	if typeof(kind) ~= "string" then
		return
	end
	local state: { [string]: any } = {}
	if kind == "track" then
		local m = inst :: Model
		local head = m:FindFirstChild("Head") :: BasePart
		state.head = head
		state.pivot = head.Position
		state.rel = {}
		for _, c in m:GetChildren() do
			if c:IsA("BasePart") and c ~= head and (c.Position - head.Position).Magnitude < 1.5 and c.Size.Y < 0.6 then
				state.rel[c] = head.CFrame:ToObjectSpace(c.CFrame)
			end
		end
	elseif kind == "shake" then
		state.base = (inst :: BasePart).CFrame
	elseif kind == "drip" then
		local vent = inst :: BasePart
		local att = Instance.new("Attachment")
		att.Parent = vent
		local p = Instance.new("ParticleEmitter")
		p.Texture = "rbxasset://textures/particles/sparkles_main.dds"
		p.Color = ColorSequence.new(Color3.fromRGB(40, 30, 30))
		p.Size = NumberSequence.new(0.18)
		p.Rate = 14
		p.Lifetime = NumberRange.new(0.7, 0.9)
		p.Speed = NumberRange.new(2, 3)
		p.EmissionDirection = Enum.NormalId.Bottom
		p.Acceleration = Vector3.new(0, -40, 0)
		p.SpreadAngle = Vector2.new(8, 8)
		p.LightInfluence = 1
		p.Parent = att
	elseif kind == "run" or kind == "stalk" then
		state.running = false
		state.caught = false
		state.phase = 0
	end
	table.insert(anims, { inst = inst, kind = kind, state = state })
end

local function watch(props: Instance)
	stopHeart()
	anims = {}
	propsBorn = os.clock()
	register(props)
	for _, d in props:GetDescendants() do
		register(d)
	end
	props.DescendantAdded:Connect(register)
end

local function hookCorridor(c: Instance)
	local props = c:FindFirstChild("Props")
	if props then
		watch(props)
	end
	c.ChildAdded:Connect(function(ch)
		if ch.Name == "Props" then
			watch(ch)
		end
	end)
end

task.spawn(function()
	local folder = Workspace:WaitForChild("Corridors")
	local hooked: { [string]: boolean } = {}
	local function try()
		local slot = player:GetAttribute("Corridor")
		if typeof(slot) ~= "number" then
			return
		end
		local name = "C" .. slot
		if hooked[name] then
			return
		end
		local c = folder:FindFirstChild(name)
		if c then
			hooked[name] = true
			hookCorridor(c)
		end
	end
	folder.ChildAdded:Connect(try)
	player:GetAttributeChangedSignal("Corridor"):Connect(try)
	try()
end)

-- Swing the arms/legs of a figure while it moves.
local function stride(m: Model, phase: number)
	local torso = m.PrimaryPart
	if not torso then
		return
	end
	local swing = math.sin(phase) * 0.8
	local base = torso.CFrame
	local s = ((m:GetAttribute("Height") or 7.5) :: number) / 7.5
	local limbs: { [string]: { number } } = { LegL = { -0.55, 1.5, 1 }, LegR = { 0.55, 1.5, -1 }, ArmL = { -1.5, 4.25, -1 }, ArmR = { 1.5, 4.25, 1 } }
	for name, spec in limbs do
		local limb = m:FindFirstChild(name) :: BasePart?
		if limb then
			local hinge = base * CFrame.new(spec[1] * s, (spec[2] + (if spec[2] > 3 then 1.4 else 1.5) - 4.4) * s, 0)
			limb.CFrame = hinge * CFrame.Angles(swing * spec[3], 0, 0) * CFrame.new(0, -limb.Size.Y / 2, 0)
		end
	end
end

local function faceToward(m: Model, target: Vector3, step: Vector3?)
	local pivot = m:GetPivot()
	local pos = pivot.Position + (step or Vector3.zero)
	local flat = Vector3.new(target.X, pos.Y, target.Z)
	if (flat - pos).Magnitude > 0.1 then
		m:PivotTo(CFrame.lookAt(pos, flat))
	end
end

RunService.RenderStepped:Connect(function(dt: number)
	local head = myHead()
	local t = os.clock()
	for _, a in anims do
		local inst = a.inst
		if not inst.Parent then
			continue
		end
		local kind = a.kind
		if kind == "spin" then
			local m = inst :: Model
			m:PivotTo(m:GetPivot() * CFrame.Angles(0, dt * 5, 0))
		elseif kind == "track" and head then
			local h = a.state.head :: BasePart
			local cf = CFrame.lookAt(a.state.pivot, head.Position)
			h.CFrame = cf
			for part, rel in a.state.rel :: { [BasePart]: CFrame } do
				part.CFrame = cf * rel
			end
		elseif kind == "eye" and head then
			local p = inst :: BasePart
			local center = p:GetAttribute("Center") :: Vector3
			local dir = (head.Position - center).Unit
			p.CFrame = CFrame.new(center + dir * 0.36)
		elseif kind == "shake" then
			local p = inst :: BasePart
			local knock = math.sin(t * 9) > 0.55
			p.CFrame = a.state.base * CFrame.new(if knock then (math.random() - 0.5) * 0.12 else 0, 0, 0)
		elseif kind == "clock" then
			local label = (inst :: BasePart):FindFirstChildWhichIsA("TextLabel", true)
			if label then
				local secs = ((inst:GetAttribute("Start") or 0) :: number) + (t - propsBorn) * 60 * ((inst:GetAttribute("Rate") or 1) :: number)
				secs %= 86400
				local h = math.floor(secs / 3600)
				local m = math.floor(secs / 60) % 60
				local colon = if math.floor(t * 2) % 2 == 0 then ":" else " "
				label.Text = string.format("%02d%s%02d", h, colon, m)
			end
		elseif kind == "stalk" and head then
			local m = inst :: Model
			local pos = m:GetPivot().Position
			local toFig = pos - camera.CFrame.Position
			local dist = toFig.Magnitude
			local looking = camera.CFrame.LookVector:Dot(toFig.Unit) > 0.55
			if not looking and dist > 6 then
				local flat = Vector3.new(head.Position.X - pos.X, 0, head.Position.Z - pos.Z)
				local step = flat.Unit * math.min(dt * 18, flat.Magnitude - 5)
				faceToward(m, head.Position, step)
				if not a.state.whispered and dist < 30 then
					a.state.whispered = true
					Sfx.play("whispers", 0.5)
				end
			else
				faceToward(m, head.Position)
			end
		elseif kind == "run" and head then
			local m = inst :: Model
			local pos = m:GetPivot().Position
			local flat = Vector3.new(head.Position.X - pos.X, 0, head.Position.Z - pos.Z)
			local dist = flat.Magnitude
			if not a.state.running then
				faceToward(m, head.Position)
				if dist < 92 then
					a.state.running = true
					Sfx.play("run", 0.8)
					Sfx.play("sting", 0.5, 1.2)
					if not heart then
						local s = Instance.new("Sound")
						s.SoundId = Sfx.Ids.heartbeat
						s.Looped = true
						s.Volume = 0.8
						s.Parent = game:GetService("SoundService")
						s:Play()
						heart = s
					end
				end
			elseif not a.state.caught then
				a.state.phase += dt * 16
				faceToward(m, head.Position, flat.Unit * math.min(dt * 25, dist))
				stride(m, a.state.phase)
				if dist < 3.2 then
					a.state.caught = true
					stopHeart()
					action:FireServer("caught")
				end
			end
		end
	end
end)

player:GetAttributeChangedSignal("InShift"):Connect(function()
	if player:GetAttribute("InShift") ~= true then
		stopHeart()
	end
end)

-- Lobby: elevator doors slide open as you approach, the pad pulses ----------------------------

task.spawn(function()
	local lobby = Workspace:WaitForChild("Map"):WaitForChild("Lobby")
	local l = lobby:WaitForChild("ElevatorL") :: BasePart
	local r = lobby:WaitForChild("ElevatorR") :: BasePart
	local pad = lobby:WaitForChild("ElevatorPad") :: BasePart
	local lBase, rBase = l.CFrame, r.CFrame
	local open = false
	RunService.Heartbeat:Connect(function()
		pad.Transparency = 0.35 + math.sin(os.clock() * 3) * 0.2
		local h = myHead()
		local near = h ~= nil and (h.Position - pad.Position).Magnitude < 22
		if near ~= open then
			open = near
			local info = TweenInfo.new(0.9, Enum.EasingStyle.Quad, Enum.EasingDirection.InOut)
			TweenService:Create(l, info, { CFrame = if open then lBase * CFrame.new(-5, 0, 0) else lBase }):Play()
			TweenService:Create(r, info, { CFrame = if open then rBase * CFrame.new(5, 0, 0) else rBase }):Play()
			if open then
				Sfx.play("ding", 0.4)
			end
		end
	end)
end)
