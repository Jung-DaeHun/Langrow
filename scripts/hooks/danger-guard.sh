#!/bin/bash
# Danger Guard Hook — PreToolUse[Bash]
# 되돌리기 어려운 명령(rm -rf, git push --force, git reset --hard, DROP TABLE)을 막는다.
# 입력은 stdin JSON의 tool_input.command다(환경변수로 오지 않는다).
# exit 1은 막지 못하는 오류라 명령이 그대로 실행된다. 그래서 deny JSON을 낸다(tdd-guard.sh와 같은 방식).

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if echo "$COMMAND" | grep -qE 'rm\s+-rf|git\s+push\s+--force|git\s+reset\s+--hard|DROP\s+TABLE'; then
  cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BLOCKED: 위험한 명령어가 감지되었습니다 (rm -rf, git push --force, git reset --hard, DROP TABLE). 필요하면 사용자가 직접 실행한다."
  }
}
EOF
fi

exit 0
