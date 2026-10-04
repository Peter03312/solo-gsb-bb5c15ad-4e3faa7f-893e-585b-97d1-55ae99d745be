/**
 * 纯逻辑自测：node src/selftest.js
 * 不依赖数据库，覆盖 Markdown 解析、引用校验、沿革推导、片段锚定。
 */
import assert from 'node:assert/strict';
import { parseClauses, extractReferences, mdToPlain, quoteOccurrences, normalizeNum, contentHash } from './util.js';
import { computeLineage, deriveSources } from './lineage.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };

/* ---------- 解析 ---------- */
test('解析带编号的条款', () => {
  const md = '# 1 总则\n本规程适用于……\n# 2 术语\n见 #1。';
  const { clauses, references, errors } = parseClauses(md);
  assert.equal(errors.length, 0);
  assert.deepEqual(clauses.map((c) => c.num), ['1', '2']);
  assert.equal(clauses[0].body, '本规程适用于……');
  assert.equal(references[0].num, '1');
  assert.equal(references[0].clauseNum, '2');
});

test('拒绝重复编号', () => {
  const { errors } = parseClauses('# 3.1 甲\n\n# 3.1 乙');
  assert.ok(errors.some((e) => e.includes('重复')));
});

test('拒绝正文先于标题', () => {
  const { errors } = parseClauses('游离正文\n# 1 标题');
  assert.ok(errors.some((e) => e.includes('非空白内容')));
});

test('围栏代码块中的 # 不是标题', () => {
  const md = '# 1 标题\n正文\n```\n# not heading\n```\n# 2 次条';
  const { clauses, errors } = parseClauses(md);
  assert.equal(errors.length, 0, errors.join(';'));
  assert.equal(clauses.length, 2);
});

test('全角编号与点号归一化', () => {
  assert.equal(normalizeNum('３．１．２'), '3.1.2');
});

test('引用语法 #编号 与 〔编号〕', () => {
  const refs = extractReferences('见 #A.1 及〔B.2〕规定');
  assert.deepEqual(refs.map((r) => r.num), ['A.1', 'B.2']);
});

test('引用不存在条款被检出（交给服务层拒绝）', () => {
  const md = '# 1 甲\n参见 #99\n# 2 乙';
  const { clauses, references } = parseClauses(md);
  const nums = new Set(clauses.map((c) => c.num));
  const missing = references.filter((r) => !nums.has(r.num));
  assert.equal(missing[0].num, '99');
});

/* ---------- 片段匹配 ---------- */
test('片段唯一/重复/不存在计数', () => {
  const body = '设备应接地，接地电阻不大于 4Ω。';
  assert.equal(quoteOccurrences('', body, '接地电阻'), 1);
  assert.equal(quoteOccurrences('', body + '接地电阻应复测。', '接地电阻'), 2);
  assert.equal(quoteOccurrences('', body, '不存在的句子'), 0);
});

test('Markdown 转纯文本用于匹配', () => {
  const plain = mdToPlain('# 3.1 **接地**\n设备应 `x` 接地');
  assert.ok(plain.includes('设备应'));
  assert.ok(!plain.includes('#'));
});

/* ---------- 沿革 ---------- */
const mkOld = (id, num, title, body) => ({ id, num, title, body, content_hash: contentHash(title, body) });
const mkNew = (id, num, title, body, sources) => ({ id, num, title, body, content_hash: contentHash(title, body), sources });

test('未变条款（含换序）为 unchanged，仅哈希变化为 modified', () => {
  const old = [mkOld('a', '1', '甲', '正文一'), mkOld('b', '2', '乙', '正文二')];
  const n = [mkNew('c', '2', '乙', '正文二'), mkNew('d', '1', '甲', '正文一改', [])];
  deriveSources(old, n);
  // c 编号 2 自动对应 b；d 内容变了
  const { edges, errors } = computeLineage(old, n);
  assert.equal(errors.length, 0);
  const rel = Object.fromEntries(edges.filter((e) => e.from && e.to).map((e) => [e.from, e.relation]));
  assert.equal(rel.b, 'unchanged'); // 换序但内容未变
  assert.equal(rel.a, 'modified');
});

test('换编号但内容未变 => unchanged，编号变化记录在边上', () => {
  const old = [mkOld('a', 'A', '甲', '原文')];
  const n = [mkNew('b', 'A1', '甲', '原文')];
  deriveSources(old, n);
  assert.deepEqual(n[0].sources, ['a']);
  const { edges } = computeLineage(old, n);
  const e = edges.find((x) => x.from && x.to);
  assert.equal(e.relation, 'unchanged');
  assert.equal(e.fromNum, 'A');
  assert.equal(e.toNum, 'A1');
});

test('拆分产生 split，合并产生 merged', () => {
  const old = [mkOld('a', '1', '甲', '大段'), mkOld('b', '2', '乙', '乙文')];
  const n = [mkNew('c', '1', '甲上', '上半', ['a']), mkNew('d', '1a', '甲下', '下半', ['a']), mkNew('e', '2', '合并', '合体', ['a', 'b'])];
  const { edges, errors } = computeLineage(old, n);
  assert.equal(errors.length, 0);
  const kinds = edges.filter((e) => e.from && e.to).map((e) => e.relation).sort();
  assert.deepEqual(kinds, ['merged', 'merged', 'split', 'split']);
});

test('新增与删除', () => {
  const old = [mkOld('a', '1', '甲', '文')];
  const n = [mkNew('b', '2', '乙', '文', [])];
  const { edges } = computeLineage(old, n);
  assert.ok(edges.some((e) => e.relation === 'added'));
  assert.ok(edges.some((e) => e.relation === 'deleted'));
});

test('来源不属于基准版本时拒绝', () => {
  const old = [mkOld('a', '1', '甲', '文')];
  const n = [mkNew('b', '1', '甲', '文', ['ghost'])];
  const { errors } = computeLineage(old, n);
  assert.ok(errors.length);
});

console.log(`\n全部通过：${passed} 组测试`);
