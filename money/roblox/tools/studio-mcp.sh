#!/bin/sh
# stdio MCP bridge to Roblox Studio running under Vinegar (Flatpak/Wine) on Linux.
# Runs Studio's own StudioMCP.exe proxy inside the live Vinegar sandbox, using the same
# Wine build and prefix as Studio. Studio must already be open.
INST=$(flatpak ps --columns=instance,application | awk '$2=="org.vinegarhq.Vinegar"{print $1; exit}')
if [ -z "$INST" ]; then
	echo "Roblox Studio (Vinegar) is not running - start it with: flatpak run org.vinegarhq.Vinegar run" >&2
	exit 1
fi
DATA="$HOME/.var/app/org.vinegarhq.Vinegar/data/vinegar"
exec flatpak enter "$INST" env WINEPREFIX="$DATA/prefixes/studio" WINEDEBUG=-all DATA="$DATA" sh -c '
	WINE=$(ls -d /var/data/vinegar/*/bin/wine 2>/dev/null | head -1)
	EXE=$(ls -t "$DATA"/versions/*/StudioMCP.exe | head -1)
	exec "$WINE" "$EXE" --stdio
'
