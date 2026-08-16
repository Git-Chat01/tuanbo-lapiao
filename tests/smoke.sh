#!/usr/bin/env bash
# Worker 冒烟测试：200 / 401 / 400 / 400 枚举非法 四类用例
# 用法：BASE=http://127.0.0.1:8787 CODE=你的入口码 ./tests/smoke.sh
# 输出 PASS/FAIL 行，任何 FAIL 都以非零码退出

set -u

BASE="${BASE:-http://127.0.0.1:8787}"
CODE="${CODE:?请设置入口码: CODE=xxx ./tests/smoke.sh}"

pass=0
fail=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "PASS  $name"
    pass=$((pass + 1))
  else
    echo "FAIL  $name (期望 $expected, 实际 $actual)"
    fail=$((fail + 1))
  fi
}

# 合法请求体（话术 ≥20 字）
BODY='{"accessCode":"'$CODE'","stage":{"voteGap":"far","timeLeft":"final"},"host":["pressuring"],"chat":["quiet"],"rival":{"votes":"ahead","fans":"separate"},"note":"","script":"家人们帮帮忙，我第一次播，求求大家可怜可怜我，给我上点票吧，我不想被淘汰"}'

echo "== 用例 1：合法请求 → 200 + 五段报告 =="
resp=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/coach" \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:8080' \
  -d "$BODY")
code=$(echo "$resp" | tail -n1)
check "状态码 200" "200" "$code"
body=$(echo "$resp" | sed '$d')
echo "$body" | grep -q '"ok":true' && ok="yes" || ok="no"
check "响应 ok:true" "yes" "$ok"
echo "$body" | grep -q '"line_reviews"' && has="yes" || has="no"
check "含 line_reviews" "yes" "$has"

echo "== 用例 2：错入口码 → 401 =="
BAD_BODY='{"accessCode":"wrong-code-xyz","stage":{"voteGap":"far","timeLeft":"final"},"host":[],"chat":[],"rival":{"votes":"ahead","fans":"separate"},"note":"","script":"家人们帮帮忙我第一次播求求大家可怜可怜我给我上点票吧我不想被淘汰"}'
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/coach" \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:8080' \
  -d "$BAD_BODY")
check "状态码 401" "401" "$code"

echo "== 用例 3：缺 stage 字段 → 400 =="
MISSING_BODY='{"accessCode":"'$CODE'","script":"家人们帮帮忙我第一次播求求大家可怜可怜我给我上点票吧"}'
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/coach" \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:8080' \
  -d "$MISSING_BODY")
check "状态码 400" "400" "$code"

echo "== 用例 4：非法枚举值 → 400 =="
BAD_ENUM_BODY='{"accessCode":"'$CODE'","stage":{"voteGap":"hacked","timeLeft":"final"},"host":[],"chat":[],"rival":{"votes":"ahead","fans":"separate"},"note":"","script":"家人们帮帮忙我第一次播求求大家可怜可怜我给我上点票吧我不想被淘汰"}'
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/coach" \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:8080' \
  -d "$BAD_ENUM_BODY")
check "状态码 400" "400" "$code"

echo "== 用例 5：健康检查 → 200 =="
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Origin: http://localhost:8080' "$BASE/health")
check "状态码 200" "200" "$code"

echo ""
echo "结果：$pass 通过 / $fail 失败"
[ "$fail" -eq 0 ]
