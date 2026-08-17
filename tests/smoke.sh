#!/usr/bin/env bash
# v2 冒烟测试：批改接口 5 用例 + 管理接口 5 用例 + 健康检查，共 12 用例
# 用法：BASE=http://127.0.0.1:8787 CODE=入口码 ADMIN=管理密码 ./tests/smoke.sh
# 输出 PASS/FAIL 行，任何 FAIL 都以非零码退出
#
# 注意：用例 1 真实调 DeepSeek（约 5-10 秒）；用例 10 投喂一条案例后
# 用例 11 立即软删，保证本地 KV 不被测试数据污染。

set -u

BASE="${BASE:-http://127.0.0.1:8787}"
CODE="${CODE:?请设置入口码: CODE=xxx ./tests/smoke.sh}"
ADMIN="${ADMIN:?请设置管理密码: ADMIN=xxx ./tests/smoke.sh}"

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

# 常用请求体
GOOD_BODY='{"accessCode":"'$CODE'","voteGap":"far","script":"家人们帮帮忙，我第一次播，求求大家可怜可怜我，给我上点票吧，我不想被淘汰"}'
SHORT_BODY='{"accessCode":"'$CODE'","voteGap":"far","script":"帮帮忙"}'
OLD_BODY='{"accessCode":"'$CODE'","stage":{"voteGap":"far","timeLeft":"final"},"host":[],"chat":[],"rival":{"votes":"ahead","fans":"separate"},"note":"","script":"家人们帮帮忙我第一次播求求大家可怜可怜我给我上点票吧我不想被淘汰"}'

echo "== 用例 1：健康检查 → 200 =="
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Origin: http://localhost:8080' "$BASE/health")
check "状态码 200" "200" "$code"

echo "== 用例 2：合法批改 → 200 + v2 新契约字段 =="
resp=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/coach" \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:8080' \
  -d "$GOOD_BODY")
code=$(echo "$resp" | tail -n1)
check "状态码 200" "200" "$code"
body=$(echo "$resp" | sed '$d')
echo "$body" | grep -q '"verdict":"\(passed\|almost\|off\)"' && has="yes" || has="no"
check "verdict 枚举合法" "yes" "$has"
echo "$body" | grep -q '"card_type":"\(logic\|expression\|mentality\|persona\)"' && has="yes" || has="no"
check "card_type 枚举合法" "yes" "$has"
echo "$body" | grep -q '"one_thing"' && has="yes" || has="no"
check "含 one_thing" "yes" "$has"
echo "$body" | grep -q '"direction"' && has="yes" || has="no"
check "含 direction" "yes" "$has"

echo "== 用例 3：错入口码 → 401 =="
BAD_BODY='{"accessCode":"wrong-code-xyz","voteGap":"far","script":"家人们帮帮忙我第一次播求求大家可怜可怜我给我上点票吧我不想被淘汰"}'
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/coach" \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:8080' \
  -d "$BAD_BODY")
check "状态码 401" "401" "$code"

echo "== 用例 4：缺 voteGap 字段 → 400 =="
MISSING_BODY='{"accessCode":"'$CODE'","script":"家人们帮帮忙我第一次播求求大家可怜可怜我给我上点票吧我不想被淘汰"}'
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/coach" \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:8080' \
  -d "$MISSING_BODY")
check "状态码 400" "400" "$code"

echo "== 用例 5：voteGap 非法枚举 → 400 =="
BAD_ENUM_BODY='{"accessCode":"'$CODE'","voteGap":"hacked","script":"家人们帮帮忙我第一次播求求大家可怜可怜我给我上点票吧我不想被淘汰"}'
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/coach" \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:8080' \
  -d "$BAD_ENUM_BODY")
check "状态码 400" "400" "$code"

echo "== 用例 6：话术短于 20 字 → 400 =="
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/coach" \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:8080' \
  -d "$SHORT_BODY")
check "状态码 400" "400" "$code"

echo "== 用例 7：v1 旧 stage 结构 → 400 =="
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/coach" \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:8080' \
  -d "$OLD_BODY")
check "状态码 400" "400" "$code"

echo "== 用例 8：管理接口无 X-Admin-Code → 401 =="
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Origin: http://localhost:8080' "$BASE/api/admin/cases")
check "状态码 401" "401" "$code"

echo "== 用例 9：管理接口错头 → 401 =="
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Origin: http://localhost:8080' \
  -H 'X-Admin-Code: wrong-admin-xyz' "$BASE/api/admin/cases")
check "状态码 401" "401" "$code"

echo "== 用例 10：投喂案例 → 201 且可查到 =="
FEED_BODY='{"voteGap":"close","script":"家人们，最后三分钟啦，动动你们的小手指，把票投起来！今晚谁帮我守到第一，明天我单独给他唱一首，说到做到！","whyGood":"先给紧迫感，再给具体奖励承诺，兑现方式清晰可执行，不空喊"}'
resp=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/admin/cases" \
  -H 'Content-Type: application/json' -H 'X-Admin-Code: '$ADMIN'' \
  -d "$FEED_BODY")
code=$(echo "$resp" | tail -n1)
check "状态码 201" "201" "$code"
body=$(echo "$resp" | sed '$d')
case_id=$(echo "$body" | grep -o 'case:[A-Za-z0-9:]*' | head -n1)
check "返回案例 id" "yes" "$([ -n "$case_id" ] && echo yes || echo no)"
resp=$(curl -s -H 'X-Admin-Code: '$ADMIN'' "$BASE/api/admin/cases?source=manual")
echo "$resp" | grep -q "$case_id" && found="yes" || found="no"
check "清单里能查到" "yes" "$found"

echo "== 用例 11：软删 → 200 且默认清单不可见、includeDeleted 可见 =="
code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE \
  -H 'X-Admin-Code: '$ADMIN'' "$BASE/api/admin/cases/$case_id")
check "状态码 200" "200" "$code"
resp=$(curl -s -H 'X-Admin-Code: '$ADMIN'' "$BASE/api/admin/cases?source=manual")
echo "$resp" | grep -q "$case_id" && found="yes" || found="no"
check "默认清单已过滤" "no" "$found"
resp=$(curl -s -H 'X-Admin-Code: '$ADMIN'' "$BASE/api/admin/cases?source=manual&includeDeleted=1")
echo "$resp" | grep -q '"deleted":true' && found="yes" || found="no"
check "includeDeleted 可见" "yes" "$found"

echo "== 用例 12：投喂缺 whyGood → 400 =="
NO_WHY_BODY='{"voteGap":"close","script":"家人们，最后三分钟啦，动动你们的小手指，把票投起来！今晚谁帮我守到第一，明天我单独给他唱一首，说到做到！"}'
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/admin/cases" \
  -H 'Content-Type: application/json' -H 'X-Admin-Code: '$ADMIN'' \
  -d "$NO_WHY_BODY")
check "状态码 400" "400" "$code"

echo ""
echo "结果：$pass 通过 / $fail 失败"
[ "$fail" -eq 0 ]
