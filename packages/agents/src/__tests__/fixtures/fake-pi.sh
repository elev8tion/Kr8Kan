#!/usr/bin/env bash
# Mock pi CLI for runner integration tests: emits a canned json-mode event
# stream (assistant message with a fenced JSON block, then agent_settled).
cat <<'EOF'
{"type":"tool_execution_start","toolName":"read"}
{"type":"tool_execution_end","toolName":"read"}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"The board looks healthy.\n\n```json\n{\"summary\": \"all good — 2 lists, 3 cards, nothing overdue\", \"highlights\": [\"Done list is growing\"]}\n```"}]}}
{"type":"agent_settled"}
EOF
# linger like the real pi does; the runner reaps us on agent_settled
sleep 30
