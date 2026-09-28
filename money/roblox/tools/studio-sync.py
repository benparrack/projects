#!/usr/bin/env python3
"""Push a game's scripts into the open Studio place over MCP (no Rojo plugin needed).

  tools/studio-sync.py <game>

Reads games/<game>/default.project.json, rebuilds every "$path" folder as a Folder of
Script / LocalScript / ModuleScript instances with the file contents as Source, applies the
"$properties" of services, and clears the Workspace of anything but Camera/Terrain.
Works in Edit mode only; restart the playtest afterwards. Don't save the place over another game's file.
"""
import json, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
game = ROOT / "games" / sys.argv[1]
project = json.loads((game / "default.project.json").read_text())


def lua_str(s):
    level = 0
    while ("]" + "=" * level + "]") in s:
        level += 1
    eq = "=" * level
    return f"[{eq}[\n{s}]{eq}]"


def build_folder(path):
    out = []
    for f in sorted(path.iterdir()):
        if f.is_dir():
            out.append(f'{{n={json.dumps(f.name)},c="Folder",k={{{",".join(build_folder(f))}}}}}')
            continue
        name = f.name
        if name.endswith(".server.luau"):
            cls, name = "Script", name[: -len(".server.luau")]
        elif name.endswith(".client.luau"):
            cls, name = "LocalScript", name[: -len(".client.luau")]
        elif name.endswith(".luau"):
            cls, name = "ModuleScript", name[: -len(".luau")]
        else:
            continue
        out.append(f'{{n={json.dumps(name)},c="{cls}",s={lua_str(f.read_text())}}}')
    return out


def lua_value(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        return json.dumps(v)
    raise SystemExit(f"unsupported property value {v!r}")


mounts, props = [], []


def lua_path(path):
    return "{" + ",".join(json.dumps(x) for x in path) + "}"


def walk(node, parent_path):
    for key, child in node.items():
        if key.startswith("$"):
            continue
        path = parent_path + [key]
        if "$properties" in child:
            for p, v in child["$properties"].items():
                props.append(f'{{p={lua_path(path)},k={json.dumps(p)},v={lua_value(v)}}}')
        if "$path" in child:
            kids = build_folder((game / child["$path"]).resolve())
            mounts.append(f'{{p={lua_path(path)},k={{{",".join(kids)}}}}}')
        walk(child, path)


walk(project["tree"], [])
code = f"""
local mounts = {{{",".join(mounts)}}}
local props = {{{",".join(props)}}}
local function resolve(path)
	local inst = game:GetService(path[1])
	for i = 2, #path do
		inst = inst:FindFirstChild(path[i])
	end
	return inst
end
local function make(spec, parent)
	local inst = Instance.new(spec.c)
	inst.Name = spec.n
	if spec.s then inst.Source = spec.s end
	for _, k in spec.k or {{}} do make(k, inst) end
	inst.Parent = parent
end
for _, ws in workspace:GetChildren() do
	if not ws:IsA("Camera") and not ws:IsA("Terrain") then ws:Destroy() end
end
for _, svc in {{"ServerScriptService", "ReplicatedStorage", "StarterGui", "StarterPack", "Lighting"}} do
	for _, c in game:GetService(svc):GetChildren() do c:Destroy() end
end
for _, c in game:GetService("StarterPlayer").StarterPlayerScripts:GetChildren() do c:Destroy() end
for _, c in game:GetService("StarterPlayer").StarterCharacterScripts:GetChildren() do c:Destroy() end
local n = 0
for _, m in mounts do
	local parentPath = table.clone(m.p)
	local name = table.remove(parentPath)
	local parent = resolve(parentPath)
	make({{n = name, c = "Folder", k = m.k}}, parent)
	n += #m.k
end
for _, p in props do
	resolve(p.p)[p.k] = p.v
end
print("studio-sync: {sys.argv[1]} ->", n, "top-level scripts")
"""
argfile = ROOT / "build/sync-args.json"
argfile.write_text(json.dumps({"datamodel_type": "Edit", "code": code}))
sys.exit(subprocess.call([str(ROOT / "tools/mcp-call.py"), "execute_luau", f"@{argfile}"]))
