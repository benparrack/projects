#!/usr/bin/env python3
"""Call Roblox Studio MCP tools from the shell (fallback when the MCP tools aren't loaded in Claude Code).

  tools/mcp-call.py <tool> '<json args>'   # studio_id is filled in automatically
  tools/mcp-call.py <tool> @args.json      # same, args read from a file
  tools/mcp-call.py --list
  tools/mcp-call.py --stop                 # stop the background daemon

The first call starts a background daemon that keeps one StudioMCP proxy running, because Studio
takes ~15-20 s to discover a new proxy. Image results are written to build/shots/<ms>.png.
"""
import base64, json, os, pathlib, select, socket, subprocess, sys, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOCK = str(ROOT / "build/mcp.sock")


# ---- daemon ------------------------------------------------------------------------------
def daemon():
    proc = subprocess.Popen([str(ROOT / "tools/studio-mcp.sh")], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, text=True, bufsize=1)
    counter = [0]

    def rpc(method, params=None, timeout=300.0):
        counter[0] += 1
        msg = {"jsonrpc": "2.0", "id": counter[0], "method": method}
        if params is not None:
            msg["params"] = params
        proc.stdin.write(json.dumps(msg) + "\n")
        proc.stdin.flush()
        deadline = time.time() + timeout
        while time.time() < deadline:
            r, _, _ = select.select([proc.stdout], [], [], 1)
            if not r:
                continue
            line = proc.stdout.readline()
            if not line:
                raise SystemExit("proxy exited")
            try:
                m = json.loads(line)
            except ValueError:
                continue
            if m.get("id") == counter[0]:
                return m
        return {"error": {"message": f"timeout waiting for {method}"}}

    rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "cli", "version": "1"}})
    proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
    proc.stdin.flush()

    tools = []
    studio_id = None

    def ensure_studio():
        nonlocal studio_id
        for _ in range(60):
            res = rpc("tools/call", {"name": "list_roblox_studios", "arguments": {}})
            try:
                studios = json.loads(res["result"]["content"][0]["text"])["studios"]
            except Exception:
                studios = []
            if studios:
                studio_id = studios[0]["id"]
                return
            time.sleep(1)

    if os.path.exists(SOCK):
        os.unlink(SOCK)
    srv = socket.socket(socket.AF_UNIX)
    srv.bind(SOCK)
    srv.listen(4)
    while True:
        conn, _ = srv.accept()
        with conn:
            buf = b""
            while not buf.endswith(b"\n"):
                chunk = conn.recv(65536)
                if not chunk:
                    break
                buf += chunk
            req = json.loads(buf or b"{}")
            if req.get("stop"):
                conn.sendall(b"{}\n")
                proc.terminate()
                os.unlink(SOCK)
                return
            if not tools:
                for _ in range(20):
                    tools = rpc("tools/list")["result"]["tools"]
                    if tools:
                        break
                    time.sleep(1)
            if req.get("list"):
                out = {"tools": tools}
            else:
                args = req.get("args", {})
                schema = next((t["inputSchema"] for t in tools if t["name"] == req["name"]), {})
                if "studio_id" in schema.get("properties", {}) and "studio_id" not in args:
                    if not studio_id:
                        ensure_studio()
                    args["studio_id"] = studio_id or ""
                out = rpc("tools/call", {"name": req["name"], "arguments": args})
                text = json.dumps(out)
                if "No Roblox Studio" in text or "not connected" in text.lower():
                    studio_id = None  # rediscover next time
            conn.sendall(json.dumps(out).encode() + b"\n")


# ---- client ------------------------------------------------------------------------------
def request(payload):
    for attempt in range(40):
        try:
            s = socket.socket(socket.AF_UNIX)
            s.connect(SOCK)
            break
        except OSError:
            if attempt == 0:
                (ROOT / "build").mkdir(exist_ok=True)
                subprocess.Popen([sys.executable, __file__, "--daemon"], start_new_session=True,
                                 stdout=subprocess.DEVNULL, stderr=open(ROOT / "build/mcp-daemon.log", "a"))
            time.sleep(0.5)
    else:
        sys.exit("could not start daemon (see build/mcp-daemon.log)")
    s.sendall(json.dumps(payload).encode() + b"\n")
    buf = b""
    while not buf.endswith(b"\n"):
        chunk = s.recv(1 << 20)
        if not chunk:
            break
        buf += chunk
    return json.loads(buf)


def main():
    a = sys.argv[1:]
    if a and a[0] == "--daemon":
        return daemon()
    if a and a[0] == "--stop":
        return request({"stop": True})
    if a and a[0] == "--list":
        for t in request({"list": True})["tools"]:
            print(t["name"], json.dumps(t["inputSchema"].get("properties", {}))[:400])
        return
    raw = a[1] if len(a) > 1 else "{}"
    if raw.startswith("@"):  # @file: read the JSON args from a file (for big payloads)
        raw = open(raw[1:]).read()
    args = json.loads(raw)
    res = request({"name": a[0], "args": args})
    if "error" in res:
        print("ERROR", json.dumps(res["error"]))
        sys.exit(1)
    shots = ROOT / "build/shots"
    for c in res["result"].get("content", []):
        if c.get("type") == "image":
            shots.mkdir(parents=True, exist_ok=True)
            path = shots / f"{int(time.time() * 1000)}.png"
            path.write_bytes(base64.b64decode(c["data"]))
            print("IMAGE", path)
        else:
            print(c.get("text", json.dumps(c)))


main()
