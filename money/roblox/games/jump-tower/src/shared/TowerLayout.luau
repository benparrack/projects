--!strict
-- Deterministic tower geometry: an upward spiral of pillars around the spawn plaza.
-- Pure data (no Instances), so server, client and tests all agree on it.

local Config = if script then require(script.Parent.Config) else require("./Config")
local Formulas = if script then require(script.Parent.Formulas) else require("./Formulas")

export type Pillar = {
	index: number, -- 1-based along the spiral
	zone: number,
	step: number, -- 1..PillarsPerZone within the zone
	x: number,
	z: number,
	top: number, -- Y of the standing surface
	rise: number, -- height above the previous pillar (or the plaza)
	need: number, -- jump stat needed to make this step
	isZoneEnd: boolean,
}

local TowerLayout = {}

function TowerLayout.build(): { Pillar }
	local pillars: { Pillar } = {}
	local n = Config.PillarsPerZone
	local angle = 0
	local top = 0
	local prevNeed = 0
	local index = 0
	for zi, zone in Config.Zones do
		for step = 1, n do
			index += 1
			-- Requirement ramps from the previous zone's need to this zone's need across its steps.
			local t = (step - 1) / (n - 1)
			local need = prevNeed + (zone.need - prevNeed) * t
			local rise = Formulas.jumpHeight(need) * Config.StepSlack
			top += rise
			local radius = Config.SpiralStartRadius + Config.SpiralRadiusGrowth * index
			angle += Config.PillarSpacing / radius
			table.insert(pillars, {
				index = index,
				zone = zi,
				step = step,
				x = math.cos(angle) * radius,
				z = math.sin(angle) * radius,
				top = top,
				rise = rise,
				need = need,
				isZoneEnd = step == n,
			})
		end
		prevNeed = zone.need
	end
	return pillars
end

return TowerLayout
