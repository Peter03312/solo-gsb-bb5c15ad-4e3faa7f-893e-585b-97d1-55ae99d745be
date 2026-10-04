import { ApiError } from './util.js';

/**
 * 在相邻两个版本之间推断条款编号沿革。
 *
 * oldClauses: [{ id, num, heading, body, contentHash, ord }]
 * nextRows:   [{ id, num, heading, body, contentHash, ord, sources:[oldId...] }]
 *   sources 由编辑者显式声明：
 *     - 一个来源 + 一行   → 修改 / 改号 / 原样
 *     - 一个来源 + 多行   → 拆分(split_from)
 *     - 多个来源 + 一行   → 合并(merged_into)
 * 未声明 sources 的旧条款按内容哈希自动一对一匹配（同编号优先，再按顺序）。
 *
 * 返回 edges: [{ oldClauseId,newClauseId,oldNum,newNum,relation }]
 * relation: unchanged | renumbered | modified | split_from | merged_into | deleted | created
 */
export function computeLineage(oldClauses, nextRows) {
  // ---------- 1. 新版本自身校验 ----------
  const numSeen = new Set();
  for (const r of nextRows) {
    if (numSeen.has(r.num)) {
      throw new ApiError(400, 'DUP_NUMBER', `条款编号重复：${r.num}`, { num: r.num });
    }
    numSeen.add(r.num);
    if (!String(r.body || '').trim()) {
      throw new ApiError(400, 'EMPTY_CLAUSE', `条款 ${r.num} 正文不能为空。`, { num: r.num });
    }
  }

  const oldById = new Map(oldClauses.map((c) => [c.id, c]));
  const edges = [];

  // ---------- 2. 显式声明的 sources ----------
  const referencedOld = new Set();      // 出现在任意 sources 中的旧条款
  const claimedRows = new Set();        // 已被显式边占用的新行
  const explicitEdges = [];             // {oldId,newRow}

  for (const row of nextRows) {
    const sources = [...new Set(row.sources || [])];
    if (!sources.length) continue;
    for (const oldId of sources) {
      if (!oldById.has(oldId)) {
        throw new ApiError(400, 'BAD_SOURCE', `来源条款 ${oldId} 不存在（可能已过期，请基于当前版本重新修订）。`, { clauseId: oldId });
      }
    }
    claimedRows.add(row.id);
    for (const oldId of sources) {
      referencedOld.add(oldId);
      explicitEdges.push({ oldId, row });
    }
  }

  // 统计每个旧条款的显式出边数
  const outCount = new Map();
  for (const e of explicitEdges) outCount.set(e.oldId, (outCount.get(e.oldId) || 0) + 1);

  for (const { oldId, row } of explicitEdges) {
    const old = oldById.get(oldId);
    let relation;
    const sameHash = old.contentHash === row.contentHash;
    if ((row.sources || []).length >= 2) {
      relation = 'merged_into';
    } else if (outCount.get(oldId) >= 2) {
      relation = 'split_from';
    } else if (sameHash && old.num === row.num) {
      relation = 'unchanged';
    } else if (sameHash) {
      relation = 'renumbered';
    } else {
      relation = 'modified';
    }
    edges.push({ oldClauseId: old.id, newClauseId: row.id, oldNum: old.num, newNum: row.num, relation });
  }

  // ---------- 3. 未声明来源：按内容哈希自动一对一匹配 ----------
  const unclaimedOld = oldClauses.filter((c) => !referencedOld.has(c.id));
  let eligibleRows = nextRows.filter((r) => !claimedRows.has(r.id));

  const claimRow = (rowId) => {
    eligibleRows = eligibleRows.filter((r) => r.id !== rowId);
  };

  for (const old of unclaimedOld) {
    const sameHash = eligibleRows.filter((r) => r.contentHash === old.contentHash);
    if (sameHash.length) {
      // 同编号优先，保证确定性
      sameHash.sort((a, b) => {
        const ax = a.num === old.num ? 0 : 1;
        const bx = b.num === old.num ? 0 : 1;
        return ax - bx || a.ord - b.ord;
      });
      const target = sameHash[0];
      edges.push({
        oldClauseId: old.id,
        newClauseId: target.id,
        oldNum: old.num,
        newNum: target.num,
        relation: target.num === old.num ? 'unchanged' : 'renumbered',
      });
      claimRow(target.id);
      continue;
    }

    const sameNum = eligibleRows.filter((r) => r.num === old.num);
    if (sameNum.length === 1) {
      const target = sameNum[0];
      edges.push({ oldClauseId: old.id, newClauseId: target.id, oldNum: old.num, newNum: target.num, relation: 'modified' });
      claimRow(target.id);
      continue;
    }
    // 无法匹配 → 删除
    edges.push({ oldClauseId: old.id, newClauseId: null, oldNum: old.num, newNum: null, relation: 'deleted' });
  }

  // ---------- 4. 剩余新行 → 新增 ----------
  for (const row of eligibleRows) {
    edges.push({ oldClauseId: null, newClauseId: row.id, oldNum: null, newNum: row.num, relation: 'created' });
  }

  // 排序：旧版本顺序优先，删除/新增附后
  const oldOrd = new Map(oldClauses.map((c, i) => [c.id, i]));
  const newOrd = new Map(nextRows.map((c, i) => [c.id, i]));
  edges.sort((a, b) => {
    const ao = a.oldClauseId ? oldOrd.get(a.oldClauseId) : Number.MAX_SAFE_INTEGER;
    const bo = b.oldClauseId ? oldOrd.get(b.oldClauseId) : Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return (a.newClauseId ? newOrd.get(a.newClauseId) : Number.MAX_SAFE_INTEGER)
         - (b.newClauseId ? newOrd.get(b.newClauseId) : Number.MAX_SAFE_INTEGER);
  });

  return edges;
}

/** 统计片段在文本中的出现次数（区分大小写的字面匹配） */
export function countOccurrences(haystack, needle) {
  const h = String(haystack || '');
  const n = String(needle || '').trim();
  if (!n) return 0;
  let count = 0, idx = 0;
  while ((idx = h.indexOf(n, idx)) !== -1) {
    count++;
    idx += n.length;
  }
  return count;
}

/**
 * 决定一条旧批注在新版本的定位：
 *  - 内容逐字未变的唯一后继（unchanged/renumbered）→ anchored 直接沿用
 *  - 内容改变 / 拆分 / 合并：原文片段在后继中恰好出现一次 → anchored，否则 pending
 *  - 后继条款被删除 → deleted_history（批注保留在历史版本）
 */
export function locateAnnotation({ quote, outgoing, newClauseById }) {
  if (!outgoing.length || outgoing.every((e) => !e.newClauseId)) {
    return { status: 'deleted_history', clauseId: null };
  }
  const live = outgoing.filter((e) => e.newClauseId);
  const autoKeep = live.length === 1 &&
    (live[0].relation === 'unchanged' || live[0].relation === 'renumbered');
  if (autoKeep) {
    return { status: 'anchored', clauseId: live[0].newClauseId };
  }
  let total = 0;
  let hitClauseId = null;
  for (const e of live) {
    const c = newClauseById.get(e.newClauseId);
    const n = c ? countOccurrences(`${c.heading}\n${c.body}`, quote) : 0;
    total += n;
    if (n > 0 && hitClauseId === null) hitClauseId = e.newClauseId;
  }
  if (total === 1 && hitClauseId) return { status: 'anchored', clauseId: hitClauseId };
  return { status: 'pending', clauseId: null };
}

/** 签核仅继承到内容未变的一对一后继（unchanged / renumbered），拆分合并不继承 */
export function signoffInheritable(edgesByOld) {
  const inherits = [];
  for (const [oldClauseId, edges] of edgesByOld) {
    if (edges.length === 1) {
      const e = edges[0];
      if (e.newClauseId && (e.relation === 'unchanged' || e.relation === 'renumbered')) {
        inherits.push({ oldClauseId, newClauseId: e.newClauseId, newNum: e.newNum });
      }
    }
  }
  return inherits;
}
