// 端到端冒烟测试：node scripts/smoke.mjs（需先启动服务 PORT=3111）
const BASE = process.env.BASE || 'http://localhost:3111';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`, extra ?? ''); }
}
const req = async (method, path, token, body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};

const md = `# 测试规程

## 1 范围
本规程适用于 §2 与 §3 规定的作业。

## 2 准备
断电挂牌，办理工作票。作业前确认工具齐全。

## 3 作业
先拆外部连接，再更换易损件；完工后按 §4 验收，验收合格后交付。

## 4 验收
由负责人签核交付。
`;

console.log('1) 认证');
{
  const r = await req('POST', '/api/auth/login', null, { username: 'zhangsan', password: 'demo1234' });
  ok('张三登录', r.status === 200, r.json);
  globalThis.tokenA = r.json.token;
  const r2 = await req('POST', '/api/auth/login', null, { username: 'lisi', password: 'demo1234' });
  globalThis.tokenB = r2.json.token;
  ok('李四登录', r2.status === 200);
}

console.log('2) 导入与拒绝规则');
{
  const dup = md.replace('## 4 验收', '## 3 重复编号');
  const r = await req('POST', '/api/docs', tokenA, { markdown: dup });
  ok('重复编号被拒 DUP_NUMBER', r.status === 400 && r.json.error.code === 'DUP_NUMBER');

  const broken = md.replace('## 4 验收\n由负责人签核交付。', '## 4 验收\n见 §99 条款。');
  const r2 = await req('POST', '/api/docs', tokenA, { markdown: broken });
  ok('引用不存在条款被拒 BROKEN_REFERENCE', r2.status === 422 && r2.json.error.code === 'BROKEN_REFERENCE', r2.json);

  const r3 = await req('POST', '/api/docs', tokenA, { markdown: md });
  ok('正常导入 v0', r3.status === 201 && r3.json.version.no === 0);
  globalThis.doc = r3.json;
  globalThis.docId = r3.json.documentId;
  const byNum = Object.fromEntries(r3.json.clauses.map((c) => [c.num, c]));
  globalThis.byNum = byNum;
  ok('解析出 4 个条款', r3.json.clauses.length === 4);
}

console.log('3) 批注：锚定唯一片段 / 非唯一片段拒绝');
{
  const c3 = byNum['3'];
  const r = await req('POST', `/api/annotations/docs/${docId}`, tokenB, {
    clauseId: c3.id, quote: '先拆外部连接，再更换易损件', body: '请明确外部连接的具体类型',
  });
  ok('唯一片段批注成功', r.status === 201);
  globalThis.annFollow = r.json.annotations.find((a) => a.body.includes('外部连接'));

  const r2 = await req('POST', `/api/annotations/docs/${docId}`, tokenB, {
    clauseId: c3.id, quote: '验收', body: '片段不唯一',
  });
  ok('片段不唯一被拒', r2.status === 422 && r2.json.error.code === 'QUOTE_NOT_UNIQUE', r2.json);

  // 第 4 条批注（之后会删除该条，验证批注留在历史版本）
  const c4 = byNum['4'];
  const r3 = await req('POST', `/api/annotations/docs/${docId}`, tokenB, {
    clauseId: c4.id, quote: '由负责人签核交付。', body: '是否需要监理会签？',
  });
  globalThis.annDeleted = r3.json.annotations.find((a) => a.body.includes('监理'));
  ok('将删除条款的批注已建立', !!annDeleted);
}

console.log('4) 签核');
{
  const c2 = byNum['2'];
  const r = await req('POST', `/api/signoffs/docs/${docId}/clauses/${c2.id}`, tokenA, {});
  ok('张三签核第 2 条', r.status === 200 && r.json.signoffs[c2.id]?.users[0]?.username === 'zhangsan');
  const c3 = byNum['3'];
  await req('POST', `/api/signoffs/docs/${docId}/clauses/${c3.id}`, tokenA, {});
}

console.log('5) 提交 v1：换序(2⇄3，内容不变) + 改内容 + 拆分 + 合并 + 删除 + 新增');
{
  // 新结构：
  // 1 范围（内容修改）
  // 2 准备（原第 3 条，换序、内容不变 → renumbered）
  // 2.1 准备补充（由原 3 拆分）
  // 3 作业（原第 2 条，换序、内容不变 → renumbered）
  // 4 验收交付（合并：无；删除原 4，新建 4 引用合并描述）
  // 5 新增条款
  const c1 = byNum['1'], c2 = byNum['2'], c3 = byNum['3'], c4 = byNum['4'];
  const rows = [
    { rowId: 'r1', num: '1', heading: '范围', body: '本规程适用于 §2、§2.1 与 §3 规定的作业，并覆盖 §5 的特殊情形。', sources: [c1.id] }, // modified
    { rowId: 'r2', num: '2', heading: '作业', body: '先拆外部连接，再更换易损件；完工后按 §4 验收。', sources: [c3.id] }, // renumbered
    { rowId: 'r2b', num: '2.1', heading: '作业补充', body: '高处作业应系安全带；完工后按 §4 验收。', sources: [c3.id] }, // split_from
    { rowId: 'r3', num: '3', heading: '准备', body: '断电挂牌，办理工作票。作业前确认工具齐全。', sources: [c2.id] }, // renumbered
    // 原 c4 被删除（不出现在 sources）
    { rowId: 'r4', num: '4', heading: '验收交付合并', body: '验收记录应归档保存并由负责人最终确认。', sources: [c4.id] }, // modified（保留 4 号，原片段消失）
    { rowId: 'r5', num: '5', heading: '特殊情形', body: '特殊作业还应满足 §1 的适用范围。' }, // created
  ];
  const r = await req('POST', `/api/revisions/docs/${docId}/commit`, tokenA, {
    baseVersionNo: 0, note: '重排并拆分第3条', rows,
  });
  ok('v1 提交成功', r.status === 201 && r.json.version.no === 1, r.json);
  globalThis.v1 = r.json;

  const rel = new Set(r.json.lineage.map((e) => e.relation));
  ok('沿革含 modified/renumbered/split_from/created', ['modified', 'renumbered', 'split_from', 'created'].every((x) => rel.has(x)), [...rel]);

  // 批注定位检查
  const follow = r.json.annotations.find((a) => a.id === annFollow.id);
  ok('换序/拆分批注：片段「先拆外部连接」在第2条唯一 → anchored',
    follow.status === 'anchored' && follow.clauseNum === '2', follow);

  const deletedAnn = r.json.annotations.find((a) => a.id === annDeleted.id);
  ok('第4条仅修改内容（片段消失）→ pending', deletedAnn.status === 'pending', deletedAnn);

  // 签核继承：c2 内容逐字不变但编号改为 3 → 继承；c3 被拆分 → 不继承
  const newByNum = Object.fromEntries(r.json.clauses.map((c) => [c.num, c]));
  ok('内容未变的换序条款继承签核（新3号）', !!r.json.signoffs[newByNum['3'].id]);
  ok('修改内容的条款不继承签核（新1号）', !r.json.signoffs[newByNum['1'].id]);
  ok('拆分条款不继承签核（新2号）', !r.json.signoffs[newByNum['2'].id]);
}

console.log('6) 过期版本提交必须拒绝（乐观锁）');
{
  const rows = v1.clauses.map((c) => ({ rowId: c.id, num: c.num, heading: c.heading, body: c.body, sources: [c.id] }));
  const r = await req('POST', `/api/revisions/docs/${docId}/commit`, tokenB, {
    baseVersionNo: 0, note: '李四基于旧版本提交', rows,
  });
  ok('STALE_VERSION 409 拒绝', r.status === 409 && r.json.error.code === 'STALE_VERSION');
  ok('冲突响应携带当前版本', r.json.error.details.currentVersionNo === 1);
}

console.log('7) 待重新定位批注：手动 relocate');
{
  // 第4条批注（监理会签）在 v1 待定位
  const pending = v1.annotations.find((a) => a.id === annDeleted.id);
  ok('监理批注在 v1 处于 pending', pending.status === 'pending', pending);
  const target = v1.clauses.find((c) => c.num === '4');
  const r = await req('POST', `/api/annotations/${pending.id}/relocate`, tokenB, {
    clauseId: target.id, quote: '验收记录应归档保存并由负责人最终确认。',
  });
  ok('手动重新定位成功', r.status === 200 && r.json.annotations.find((a) => a.id === pending.id).status === 'anchored');

  const bad = await req('POST', `/api/annotations/${pending.id}/relocate`, tokenB, {
    clauseId: target.id, quote: '不存在的文字xyz',
  });
  ok('重新定位到不匹配片段被拒', bad.status === 422);
}

console.log('8) 历史版本：删除条款的批注保留在历史版本');
{
  // 提交 v2 删除第 4 条
  const rows = v1.clauses
    .filter((c) => c.num !== '4')
    .map((c) => {
      let body = c.body;
      if (c.num === '2') {
        body = body.replace('完工后按 §4 验收。', '完工后由负责人确认交付，验收记录归档。');
      } else if (c.num === '2.1') {
        body = body.replace('完工后按 §4 验收。', '完工后由负责人确认交付。');
      }
      return { rowId: c.id, num: c.num, heading: c.heading, body, sources: [c.id] };
    });
  const r = await req('POST', `/api/revisions/docs/${docId}/commit`, tokenA, {
    baseVersionNo: 1, note: '删除第4条并入第2条', rows,
  });
  ok('v2 提交成功（删条）', r.status === 202 || r.status === 201);

  // v1 历史视图中该批注仍可见
  const hist = await req('GET', `/api/docs/${docId}/versions/1`, tokenA);
  const kept = hist.json.annotations.find((a) => a.id === annDeleted.id);
  ok('批注保留在历史版本 v1', kept && kept.status === 'anchored');
  // v2 中不出现（deleted_history 不向前传播）——注意该批注已 relocate 到 v1 第4条，v2 应转为 deleted_history 展示
  const inV2 = r.json.annotations.find((a) => a.id === annDeleted.id);
  ok('删除条款批注在新版本标记为 deleted_history', inV2 && inV2.status === 'deleted_history', inV2);
}

console.log('9) 历史沿革接口');
{
  const r = await req('GET', `/api/docs/${docId}/history`, tokenA);
  ok('版本列表 0/1/2', r.json.versions.length === 3);
  ok('沿革边数 >= 10', r.json.lineage.length >= 10);
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
