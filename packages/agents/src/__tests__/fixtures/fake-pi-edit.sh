#!/usr/bin/env bash
# Mock pi CLI for sandbox tests: edits files in its cwd (like a dev agent
# would), then emits a canned json-mode event stream and settles.
echo "edited by agent" >> tracked.txt
echo "brand new file" > created.txt
cat <<'EOF'
{"type":"tool_execution_start","toolName":"edit"}
{"type":"tool_execution_end","toolName":"edit"}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Done.\n\n```json\n{\"what\": \"edited tracked.txt, added created.txt\", \"howToVerify\": \"cat tracked.txt\", \"notes\": \"\"}\n```"}]}}
{"type":"agent_settled"}
EOF
sleep 30
