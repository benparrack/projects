#!/usr/bin/env bash
# Run a Luau file inside the open Studio playtest via the MCP bridge.
# The datamodel comes from the filename: *.client.luau -> Client, *.server.luau -> Server, else Edit.
# Start a playtest first (tools/mcp-call.py start_stop_play '{"is_start":true}').
set -euo pipefail
cd "$(dirname "$0")/.."
FILE=$1
case "$FILE" in
	*.client.luau) DM=Client ;;
	*.server.luau) DM=Server ;;
	*) DM=Edit ;;
esac
ARGS=$(python3 -c 'import json,sys; print(json.dumps({"datamodel_type": sys.argv[1], "code": open(sys.argv[2]).read()}))' "$DM" "$FILE")
MCP_TIMEOUT=${MCP_TIMEOUT:-600} exec tools/mcp-call.py execute_luau "$ARGS"
