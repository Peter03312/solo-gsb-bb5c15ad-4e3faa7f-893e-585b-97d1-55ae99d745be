#!/usr/bin/env bash
# 端到端 API 冒烟测试：需要已启动的服务器（$BASE）
set -uo pipefail
BASE="${BASE:-http://127.0.0.1:4099}"
pass=0; fail=0
check() { # check <描述> <期望子串> <实际>
  local exp act
  exp=$(printf '%s' "$2" | tr -d '[:space:]')
  act=$(printf '%s' "$3" | tr -d '[:space:]')
  if [[ "$act" == *"$exp"* ]]; then pass=$((pass+1)); echo "  ✓ $1";
  else fail=$((fail+1)); echo "  ✗ $1"; echo "    期望含 [$2] 实际: ${3:0:400}"; echo; fi
}
J() { python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps(d))"; }

echo "== 登录 =="
LOGIN=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}')
check "管理员登录" '"token"' "$LOGIN"
TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
AUTH="Authorization: Bearer $TOKEN"; CT="Content-Type: application/json"

echo "== 导入校验 =="
BODY=$(python3 -c "import json;print(json.dumps({'title':'重复编号规程','markdown':'# 1 甲\n文\n# 1 乙\n文'}))")
R=$(curl -s -X POST $BASE/api/documents -H "$AUTH" -H "$CT" -d "$BODY")
check "重复编号被拒绝" '条款编号重复' "$R"

BODY=$(python3 -c "import json;print(json.dumps({'title':'悬空引用规程','markdown':'# 1 甲\n参见 #99'}))")
R=$(curl -s -X POST $BASE/api/documents -H "$AUTH" -H "$CT" -d "$BODY")
check "引用不存在条款被拒绝" '不存在的条款' "$R"

echo "== 正常导入 =="
MD=$(printf '# 1 总则\n本规程适用于设备安装。参见 #2。\n# 2 安装\n设备应接地，接地电阻不大于 4Ω。\n# 3 验收\n验收应合格。')
BODY=$(python3 -c "import json,sys;print(json.dumps({'title':'测试规程','markdown':sys.argv[1]}))" "$MD")
R=$(curl -s -X POST $BASE/api/documents -H "$AUTH" -H "$CT" -d "$BODY")
check "初始导入成功" 'versionNo' "$R"
DOC=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin)['docId'])")

V1=$(curl -s "$BASE/api/documents/$DOC/versions/1" -H "$AUTH")
check "读取 v1" '"versionNo": 1' "$V1"
C2=$(echo "$V1" | python3 -c "import sys,json;d=json.load(sys.stdin);print([c for c in d['clauses'] if c['num']=='2'][0]['id'])")

echo "== 批注与片段锚定 =="
BODY=$(python3 -c "import json;print(json.dumps({'clauseId':'$C2','quote':'接地电阻不大于 4Ω','content':'建议加单位说明'}))")
R=$(curl -s -X POST "$BASE/api/versions/$(echo "$V1"|python3 -c "import sys,json;print(json.load(sys.stdin)['version']['id'])")/annotations" -H "$AUTH" -H "$CT" -d "$BODY")
check "唯一片段批注成功" '"id"' "$R"
BODY=$(python3 -c "import json;print(json.dumps({'clauseId':'$C2','quote':'接地','content':'歧义片段'}))")
R=$(curl -s -X POST "$BASE/api/versions/$(echo "$V1"|python3 -c "import sys,json;print(json.load(sys.stdin)['version']['id'])")/annotations" -H "$AUTH" -H "$CT" -d "$BODY")
check "重复片段拒绝（不唯一）" '无法唯一匹配' "$R"
BODY=$(python3 -c "import json;print(json.dumps({'clauseId':'$C2','quote':'火星文字片段XYZ','content':'找不到'}))")
R=$(curl -s -X POST "$BASE/api/versions/$(echo "$V1"|python3 -c "import sys,json;print(json.load(sys.stdin)['version']['id'])")/annotations" -H "$AUTH" -H "$CT" -d "$BODY")
check "不存在片段拒绝" '不存在' "$R"

echo "== 签核 =="
R=$(curl -s -X POST "$BASE/api/versions/$(echo "$V1"|python3 -c "import sys,json;print(json.load(sys.stdin)['version']['id'])")/clauses/$C2/signoff" -H "$AUTH")
check "签核条款" '"ok": true' "$R"

echo "== 提交 v2：换序（内容不变）+ 修改内容 + 删除 #3 + 引用保持 =="
MD2=$(printf '# 2 安装\n设备应接地，接地电阻不大于 4Ω。\n# 1 总则\n本规程适用于设备安装。参见 #2。')
BODY=$(python3 -c "import json,sys;print(json.dumps({'baseVersionNo':1,'markdown':sys.argv[1],'message':'换序并删去验收'}))" "$MD2")
R=$(curl -s -X POST "$BASE/api/documents/$DOC/revisions" -H "$AUTH" -H "$CT" -d "$BODY")
check "v2 提交成功" '"versionNo": 2' "$R"

V2=$(curl -s "$BASE/api/documents/$DOC/versions/2" -H "$AUTH")
check "换序条款批注沿用 active" '"status": "active"' "$V2"
check "删除条款 #3 后无残留 pending" '"pendingAnnotations": []' "$V2"
check "unchanged 后继继承签核(inherited=1)" '"inherited": 1' "$V2"

echo "== 过期版本提交冲突 =="
BODY=$(python3 -c "import json,sys;print(json.dumps({'baseVersionNo':1,'markdown':sys.argv[1]}))" "$MD2")
R=$(curl -s -X POST "$BASE/api/documents/$DOC/revisions" -H "$AUTH" -H "$CT" -d "$BODY")
check "基于 v1 再提交返回 409" 'version_conflict' "$R"
check "409 返回当前版本内容" 'currentVersion' "$R"

echo "== 内容修改后片段无法匹配 => pending =="
MD3=$(printf '# 2 安装\n设备应做保护接地，工频电阻不大于 4 欧姆。\n# 1 总则\n本规程适用于设备安装。参见 #2。')
BODY=$(python3 -c "import json,sys;print(json.dumps({'baseVersionNo':2,'markdown':sys.argv[1]}))" "$MD3")
curl -s -X POST "$BASE/api/documents/$DOC/revisions" -H "$AUTH" -H "$CT" -d "$BODY" > /dev/null
V3=$(curl -s "$BASE/api/documents/$DOC/versions/3" -H "$AUTH")
check "片段失配批注列为待重新定位" '"status": "pending"' "$V3"
ANN_PENDING=$(echo "$V3" | python3 -c "import sys,json;print(json.load(sys.stdin)['pendingAnnotations'][0]['id'])")

echo "== 重新定位 pending 批注 =="
C1V3=$(echo "$V3" | python3 -c "import sys,json;d=json.load(sys.stdin);print([c for c in d['clauses'] if c['num']=='1'][0]['id'])")
VID3=$(echo "$V3" | python3 -c "import sys,json;print(json.load(sys.stdin)['version']['id'])")
BODY=$(python3 -c "import json;print(json.dumps({'clauseId':'$C1V3','quote':'本规程适用于设备安装'}))")
R=$(curl -s -X POST "$BASE/api/annotations/$ANN_PENDING/relocate" -H "$AUTH" -H "$CT" -d "$BODY")
check "重新定位成功" '"ok": true' "$R"

echo "== 拆分/合并沿革 =="
# v3: #1, #2。v4: 把 #2 拆为 2、2.1，并把 #1+#2 合并为 #4
MD4=$(printf '# 2 安装\n设备应做保护接地。\n# 2.1 接地电阻\n工频接地电阻不大于 4Ω。\n# 1 总则\n本规程适用于设备安装。参见 #2。\n# 4 综合\n设备安装与接地应综合实施。')
C2V3=$(echo "$V3" | python3 -c "import sys,json;d=json.load(sys.stdin);print([c for c in d['clauses'] if c['num']=='2'][0]['id'])")
SM=$(python3 -c "import json,sys;c2=sys.argv[1];print(json.dumps({'2':[c2],'2.1':[c2],'4':[c2,sys.argv[2]]}))" "$C2V3" "$C1V3")
BODY=$(python3 -c "import json,sys;print(json.dumps({'baseVersionNo':3,'markdown':sys.argv[1],'sourceMap':json.loads(sys.argv[2])}))" "$MD4" "$SM")
R=$(curl -s -X POST "$BASE/api/documents/$DOC/revisions" -H "$AUTH" -H "$CT" -d "$BODY")
check "拆并修订提交成功" '"versionNo": 4' "$R"
HIST=$(curl -s "$BASE/api/clauses/$C2V3/history" -H "$AUTH")
check "沿革包含 split" 'split' "$HIST"
check "沿革包含 merged" 'merged' "$HIST"
check "沿革包含编号变化记录" 'fromNum' "$HIST"

echo "== 历史版本中已删除条款批注保留 =="
V1B=$(curl -s "$BASE/api/documents/$DOC/versions/1" -H "$AUTH")
check "v1 历史批注仍在历史版本可查" '建议加单位说明' "$V1B"

echo
echo "结果：通过 $pass，失败 $fail"
[ "$fail" -eq 0 ]
