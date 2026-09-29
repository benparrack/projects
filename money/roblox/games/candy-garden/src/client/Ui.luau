--!strict
-- Tiny helpers for building styled UI from code.

local TweenService = game:GetService("TweenService")

local Sfx = require(script.Parent.Sfx)

local Ui = {}

Ui.Font = Enum.Font.FredokaOne
Ui.Colors = {
	panel = Color3.fromRGB(74, 36, 84),
	panelLight = Color3.fromRGB(104, 56, 116),
	text = Color3.fromRGB(255, 255, 255),
	muted = Color3.fromRGB(240, 200, 235),
	gold = Color3.fromRGB(255, 210, 70),
	green = Color3.fromRGB(80, 220, 120),
	blue = Color3.fromRGB(70, 170, 255),
	pink = Color3.fromRGB(255, 90, 170),
	red = Color3.fromRGB(255, 80, 80),
	purple = Color3.fromRGB(160, 100, 255),
}

function Ui.new(className: string, props: { [string]: any }, children: { any }?): any
	local inst = Instance.new(className)
	local parent = props.Parent
	for k, v in props do
		if k ~= "Parent" then
			(inst :: any)[k] = v
		end
	end
	for _, child in (children or {}) :: { any } do
		child.Parent = inst
	end
	if parent then
		inst.Parent = parent
	end
	return inst
end

function Ui.corner(radius: number?): Instance
	return Ui.new("UICorner", { CornerRadius = UDim.new(0, radius or 12) })
end

function Ui.stroke(color: Color3?, thickness: number?): Instance
	return Ui.new("UIStroke", {
		Color = color or Color3.fromRGB(0, 0, 0),
		Thickness = thickness or 3,
		ApplyStrokeMode = Enum.ApplyStrokeMode.Border,
	})
end

function Ui.gradient(top: Color3, bottom: Color3): Instance
	return Ui.new("UIGradient", {
		Color = ColorSequence.new(top, bottom),
		Rotation = 90,
	})
end

function Ui.label(props: { [string]: any }): TextLabel
	local defaults = {
		BackgroundTransparency = 1,
		Font = Ui.Font,
		TextColor3 = Ui.Colors.text,
		TextScaled = true,
	}
	for k, v in props do
		defaults[k] = v
	end
	local label = Ui.new("TextLabel", defaults)
	Ui.new("UIStroke", { Thickness = 2, Color = Color3.fromRGB(0, 0, 0), Transparency = 0.2, Parent = label })
	return label
end

-- A chunky rounded button with a darker bottom half and a press "squish".
function Ui.button(props: { [string]: any }, color: Color3, onClick: () -> ()): TextButton
	local defaults = {
		BackgroundColor3 = Color3.new(1, 1, 1),
		AutoButtonColor = false,
		Font = Ui.Font,
		TextColor3 = Ui.Colors.text,
		TextScaled = true,
	}
	for k, v in props do
		defaults[k] = v
	end
	local button = Ui.new("TextButton", defaults, {
		Ui.corner(12),
		Ui.stroke(color:Lerp(Color3.new(0, 0, 0), 0.55), 3),
		Ui.gradient(color, color:Lerp(Color3.new(0, 0, 0), 0.25)),
		Ui.new("UIPadding", {
			PaddingLeft = UDim.new(0, 6),
			PaddingRight = UDim.new(0, 6),
			PaddingTop = UDim.new(0, 4),
			PaddingBottom = UDim.new(0, 4),
		}),
	})
	Ui.new("UIStroke", {
		Thickness = 2,
		Color = Color3.new(0, 0, 0),
		Transparency = 0.3,
		ApplyStrokeMode = Enum.ApplyStrokeMode.Contextual,
		Parent = button,
	})
	local scale = Ui.new("UIScale", { Parent = button })
	button.MouseButton1Down:Connect(function()
		TweenService:Create(scale, TweenInfo.new(0.06), { Scale = 0.92 }):Play()
	end)
	button.MouseButton1Up:Connect(function()
		TweenService:Create(scale, TweenInfo.new(0.12, Enum.EasingStyle.Back), { Scale = 1 }):Play()
	end)
	button.MouseLeave:Connect(function()
		TweenService:Create(scale, TweenInfo.new(0.12), { Scale = 1 }):Play()
	end)
	button.Activated:Connect(function()
		Sfx.play("click", 0.5)
		onClick()
	end)
	return button
end

function Ui.pop(inst: GuiObject, from: number?)
	local scale = inst:FindFirstChildOfClass("UIScale") or Ui.new("UIScale", { Parent = inst })
	scale.Scale = from or 0.6
	TweenService:Create(scale, TweenInfo.new(0.35, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Scale = 1 })
		:Play()
end

return Ui
