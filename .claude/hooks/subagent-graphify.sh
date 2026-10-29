#!/usr/bin/env bash
# SubagentStart: tell every subagent which sub-projects have a graphify graph, so it navigates by graph instead of whole-file reads.
cd "${CLAUDE_PROJECT_DIR:-/home/ben/projects}" || exit 0
dirs=$(ls -d */graphify-out */*/graphify-out 2>/dev/null | sed 's#/graphify-out##' | paste -sd, -)
[ -z "$dirs" ] && exit 0
msg="These sub-projects have a graphify graph: $dirs. When working in one, locate code with \`graphify query/explain/path\` (run from that sub-project) before Read/Grep, then read only the line ranges you need. Still read whatever code you actually edit or need to understand; graphify is for finding, not replacing reading. Run \`graphify update .\` there after code changes."
jq -n --arg m "$msg" '{hookSpecificOutput:{hookEventName:"SubagentStart",additionalContext:$m}}'
