--!strict
-- Pure base/stealing rules, shared by the server and the Lune tests.

local Rules = {}

-- First empty pad index (1..count), or nil when the base is full.
function Rules.freeSlot(slots: { [number]: any }, count: number): number?
	for i = 1, count do
		if slots[i] == nil then
			return i
		end
	end
	return nil
end

function Rules.usedSlots(slots: { [number]: any }): number
	local n = 0
	for _ in slots do
		n += 1
	end
	return n
end

export type StealCheck = {
	isOwner: boolean,
	locked: boolean,
	alreadyCarrying: boolean,
	targetCarried: boolean,
	thiefHasRoom: boolean,
	stunned: boolean,
}

-- Returns nil when the steal may start, otherwise the reason shown to the thief.
function Rules.stealBlocker(c: StealCheck): string?
	if c.isOwner then
		return "That's already yours!"
	elseif c.locked then
		return "This base is locked! 🔒"
	elseif c.stunned then
		return "You're stunned!"
	elseif c.alreadyCarrying then
		return "You're already carrying one!"
	elseif c.targetCarried then
		return "Someone is already stealing that!"
	elseif not c.thiefHasRoom then
		return "Your base is full! Sell a satellite first."
	end
	return nil
end

-- Converts saved satellites ({ t = id, s = slot }) into a slot map, dropping unknown ids,
-- out-of-range and duplicate slots, and packing leftovers into free pads.
function Rules.loadSlots(saved: { { t: string, s: number } }, count: number, known: { [string]: any }): { [number]: string }
	local slots: { [number]: string } = {}
	local leftovers = {}
	for _, entry in saved do
		if known[entry.t] then
			if type(entry.s) == "number" and entry.s >= 1 and entry.s <= count and slots[entry.s] == nil then
				slots[entry.s] = entry.t
			else
				table.insert(leftovers, entry.t)
			end
		end
	end
	for _, id in leftovers do
		local free = Rules.freeSlot(slots, count)
		if not free then
			break
		end
		slots[free] = id
	end
	return slots
end

function Rules.saveSlots(slots: { [number]: string }): { { t: string, s: number } }
	local out = {}
	for s, id in slots do
		table.insert(out, { t = id, s = s })
	end
	table.sort(out, function(a, b)
		return a.s < b.s
	end)
	return out
end

return Rules
