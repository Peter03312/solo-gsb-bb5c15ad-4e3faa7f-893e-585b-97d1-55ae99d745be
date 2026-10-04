/**
 * 相邻版本沿革计算。
 * 条款在每个版本是独立快照行，版本间的对应关系由“边”表达：
 *   added     无来源
 *   deleted   新版本中没有后继
 *   unchanged 单来源且内容指纹一致（仅换序/换编号属于此类）
 *   modified  单来源但内容指纹变化
 *   split     一个旧条款被多个新条款引用
 *   merged    一个新条款引用多个旧条款
 */

export function computeLineage(oldRows, newClauses) {
  const errors = [];
  const oldById = new Map(oldRows.map((r) => [r.id, r]));
  const edges = [];
  const usage = new Map();

  for (const nc of newClauses) {
    const raw = nc.sources || [];
    const srcs = [...new Set(raw)];
    if (raw.length !== srcs.length) errors.push(`新条款「${nc.num}」的来源列表存在重复条款`);
    for (const sid of srcs) {
      if (!oldById.has(sid)) errors.push(`条款「${nc.num}」引用了不属于基准版本的来源条款（${sid}）`);
      else {
        if (!usage.has(sid)) usage.set(sid, []);
        usage.get(sid).push(nc);
      }
    }
  }
  if (errors.length) return { edges, errors };

  for (const nc of newClauses) {
    const srcs = [...new Set(nc.sources || [])];
    if (srcs.length === 0) {
      edges.push({ from: null, to: nc.id, fromNum: null, toNum: nc.num, relation: 'added' });
    } else if (srcs.length > 1) {
      for (const sid of srcs) {
        edges.push({ from: sid, to: nc.id, fromNum: oldById.get(sid).num, toNum: nc.num, relation: 'merged' });
      }
    } else {
      const sid = srcs[0];
      const old = oldById.get(sid);
      const relation = usage.get(sid).length > 1
        ? 'split'
        : old.content_hash === nc.content_hash ? 'unchanged' : 'modified';
      edges.push({ from: sid, to: nc.id, fromNum: old.num, toNum: nc.num, relation });
    }
  }

  for (const old of oldRows) {
    if (!usage.has(old.id)) {
      edges.push({ from: old.id, to: null, fromNum: old.num, toNum: null, relation: 'deleted' });
    }
  }
  return { edges, errors: [] };
}

/**
 * 客户端未显式给出来源时的兜底推断：
 * 1) 优先按相同编号一对一匹配；
 * 2) 仍无来源的新条款，若存在唯一一个“编号未被匹配占用、且内容指纹相同”的旧条款，
 *    则视为换编号沿用（unchanged，编号沿革记录 fromNum→toNum）；
 * 3) 其余视为新增。推断不了的拆并需由调用方通过 sourceMap 显式给出。
 */
export function deriveSources(oldRows, newClauses) {
  const byNum = new Map(oldRows.map((r) => [r.num, r]));
  const used = new Set();

  // 第一轮：显式来源优先占用
  for (const nc of newClauses) {
    if (nc.sources && nc.sources.length) nc.sources.forEach((s) => used.add(s));
  }
  // 第二轮：相同编号
  for (const nc of newClauses) {
    if (nc.sources && nc.sources.length) continue;
    const id = byNum.get(nc.num)?.id;
    if (id && !used.has(id)) {
      nc.sources = [id];
      used.add(id);
    }
  }
  // 第三轮：换编号但内容完全一致（指纹唯一）
  for (const nc of newClauses) {
    if (nc.sources && nc.sources.length) continue;
    const sameContent = oldRows.filter((o) => !used.has(o.id) && o.content_hash === nc.content_hash);
    if (sameContent.length === 1) {
      nc.sources = [sameContent[0].id];
      used.add(sameContent[0].id);
    } else {
      nc.sources = [];
    }
  }
}
