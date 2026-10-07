#!/bin/bash
# Stop Hook — 멈추기 전에 lint·build·test를 돌린다.
# 실패하면 exit 2와 stderr로 출력 끝부분을 Claude에게 돌려줘 이어서 고치게 한다.
# (exit 1은 막지 못하는 오류라 Claude에게 전달되지 않고 세션이 그냥 끝난다)
# 이 hook 때문에 이미 한 번 이어서 작업했으면(stop_hook_active) 다시 막지 않는다. 고칠 수 없는 실패에서 무한 반복을 막는다.

INPUT=$(cat)
ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
OUTPUT=$( { npm run lint && npm run build && npm run test; } 2>&1 )
STATUS=$?
if [ "$STATUS" -eq 0 ]; then
  exit 0
fi

{
  echo "Stop hook: lint·build·test 중 실패가 있습니다. 이번 작업으로 생긴 실패면 고친 뒤 끝내고, 아니면 사용자에게 알리고 멈추세요."
  echo "$OUTPUT" | tail -n 80
} >&2
if [ "$ACTIVE" = "true" ]; then
  exit 1
fi
exit 2
