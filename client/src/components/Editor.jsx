import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';

let uidSeq = 0;
const newUid = () => `row-${Date.now()}-${uidSeq++}`;

const REL_HINT = {
  unchanged: ['将被记为：沿用（内容未变）', 'rel-unchanged'],
  renumbered: ['将被记为：改号，内容未变', 'rel-renumbered'],
  modified: ['将被记为：内容已修改', 'rel-modified'],
  split: ['将被记为：拆分', 'rel-split'],
  merged: ['将被记为：合并', 'rel-merged'],
  created: ['将被记为：新增条款', 'rel-created'],
};

function textOf(r) {
  return `${(r.heading || '').trim()}\n\n${(r.body || '').trim()}`;
}

export default function Editor({ docId, base, onCommitted, onConflict, setError }) {
  const sourceClauses = base.clauses;
  const sourceById = useMemo(() => new Map(sourceClauses.map((c) => [c.id, c])), [sourceClauses]);

  const fromBase = () =>
    sourceClauses.map((c) => ({
      uid: newUid(),
      num: c.num,
      heading: c.heading,
      body: c.body,
      sources: [c.id],
    }));

  const [rows, setRows] = useState(fromBase);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [draftMsg, setDraftMsg] = useState('');
  const [mergeMode, setMergeMode] = useState(false);
  const [picked, setPicked] = useState(new Set());
  const baseNo = base.version.no;
  const initialized = useRef(false);

  // 载入同基准版本的草稿
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    api(`/api/revisions/drafts/${docId}`)
      .then((r) => {
        if (r.draft && r.draft.baseVersionNo === baseNo && Array.isArray(r.draft.data.rows)) {
          if (window.confirm('发现基于当前版本保存的草稿，是否恢复？')) {
            setRows(r.draft.data.rows.map((x) => ({ ...x, uid: x.uid || newUid(), sources: x.sources || [] })));
            setNote(r.draft.data.note || '');
            setDraftMsg('已恢复上次保存的草稿');
          }
        }
      })
      .catch(() => {});
  }, [docId, baseNo]);

  const update = (uid, patch) => setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  const move = (idx, delta) =>
    setRows((rs) => {
      const j = idx + delta;
      if (j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return copy;
    });

  const addRow = (afterIdx = -1) => {
    const row = { uid: newUid(), num: '', heading: '', body: '', sources: [] };
    setRows((rs) => {
      const copy = [...rs];
      copy.splice(afterIdx + 1, 0, row);
      return copy;
    });
  };

  const removeRow = (uid) => {
    if (!window.confirm('确认删除该条款？其签核不会继承；无法在新版匹配的批注将进入待重新定位，已删除条款上的批注保留在历史版本。')) return;
    setRows((rs) => rs.filter((r) => r.uid !== uid));
  };

  // 拆分：复制一行插到其后，共享相同来源
  const splitRow = (idx) => {
    const src = rows[idx];
    const copy = { uid: newUid(), num: '', heading: '', body: '', sources: [...src.sources] };
    setRows((rs) => {
      const xs = [...rs];
      xs.splice(idx + 1, 0, copy);
      return xs;
    });
    setDraftMsg('已按拆分创建新条款，共享来源：' + src.sources.map((id) => `§${sourceById.get(id)?.num}`).join('、'));
  };

  // 合并选中行到第一行
  const mergePicked = () => {
    const targets = rows.filter((r) => picked.has(r.uid));
    if (targets.length < 2) return;
    const first = targets[0];
    const sources = [...new Set(targets.flatMap((t) => t.sources))];
    const mergedBody = targets.map((t) => t.body.trim()).filter(Boolean).join('\n\n');
    const merged = { ...first, sources, body: mergedBody };
    const removeUids = new Set(targets.slice(1).map((t) => t.uid));
    setRows((rs) => rs.map((r) => (r.uid === first.uid ? merged : r)).filter((r) => !removeUids.has(r.uid)));
    setPicked(new Set());
    setMergeMode(false);
    setDraftMsg(`已合并 ${targets.length} 个条款（来源 ${sources.map((id) => `§${sourceById.get(id)?.num}`).join('、')}）`);
  };

  const dupNums = useMemo(() => {
    const seen = new Map();
    const dups = new Set();
    for (const r of rows) {
      const n = r.num.trim();
      if (!n) continue;
      seen.set(n, (seen.get(n) || 0) + 1);
      if (seen.get(n) >= 2) dups.add(n);
    }
    return dups;
  }, [rows]);

  // 客户端沿革预览（与服务端 computeLineage 的同一套规则）
  const relationHint = (r) => {
    if (r.sources.length === 0) return 'created';
    if (r.sources.length >= 2) return 'merged';
    const src = sourceById.get(r.sources[0]);
    if (!src) return 'created';
    const sameSourceRows = rows.filter((x) => x.sources.includes(src.id));
    if (sameSourceRows.length >= 2) return 'split';
    const sameText = textOf(src) === textOf(r);
    if (sameText) return src.num === r.num.trim() ? 'unchanged' : 'renumbered';
    return 'modified';
  };

  const saveDraft = async () => {
    setBusy(true);
    try {
      const r = await api(`/api/revisions/drafts/${docId}`, {
        method: 'PUT',
        body: { baseVersionNo: baseNo, data: { note, rows } },
      });
      if (r.currentVersionNo !== baseNo) {
        setError(`注意：草稿保存时当前版本已是 v${r.currentVersionNo}，您的基准是 v${baseNo}，正式提交将被拒绝，请先取回新版本。`);
      } else {
        setDraftMsg('草稿已保存 ' + new Date().toLocaleTimeString());
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (dupNums.size) {
      setError(`存在重复编号：${[...dupNums].join('、')}，请先修正。`);
      return;
    }
    if (rows.some((r) => !r.num.trim() || !r.body.trim())) {
      setError('每个条款都必须有编号和正文。');
      return;
    }
    if (!window.confirm(`确认基于 v${baseNo} 提交为 v${baseNo + 1}？提交后将计算编号沿革、重定位批注并继承未变条款的签核。`)) return;
    setBusy(true);
    try {
      const payload = {
        baseVersionNo: baseNo,
        note: note.trim() || '修订提交',
        rows: rows.map((r) => ({ rowId: r.uid, num: r.num.trim(), heading: r.heading, body: r.body, sources: r.sources })),
      };
      const r = await api(`/api/revisions/docs/${docId}/commit`, { method: 'POST', body: payload });
      onCommitted(r);
    } catch (e) {
      if (e.code === 'STALE_VERSION') {
        onConflict(e);
      } else {
        setError(e.code === 'BROKEN_REFERENCE' ? `${e.message}${e.details?.missing ? '（' + e.details.missing.join('、') + '）' : ''}` : e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="editor">
      <div className="card editor-toolbar">
        <div className="editor-toolbar-row">
          <label className="note-label">修订说明
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="本次修订要点…" />
          </label>
          <div className="toolbar-btns">
            <button className="btn" onClick={() => addRow(rows.length - 1)}>＋ 新增条款</button>
            <button className={`btn ${mergeMode ? 'btn-primary' : ''}`} onClick={() => { setMergeMode((v) => !v); setPicked(new Set()); }}>
              {mergeMode ? '退出合并模式' : '合并模式'}
            </button>
            {mergeMode && (
              <button className="btn btn-primary" disabled={picked.size < 2} onClick={mergePicked}>
                合并选中的 {picked.size || ''} 项
              </button>
            )}
            <button className="btn" onClick={saveDraft} disabled={busy}>保存草稿</button>
            <button className="btn btn-primary" onClick={commit} disabled={busy}>{busy ? '处理中…' : `提交为 v${baseNo + 1}`}</button>
          </div>
        </div>
        <div className="muted small">
          基准版本：v{baseNo} · 行内 ↑↓ 换序；「拆分」复制当前条款的来源到新行（改内容后提交即为拆分）；
          合并模式勾选多行后合并（来源取并集）。内容逐字未变仅换序/改号时，批注沿用、签核继承。
        </div>
        {draftMsg && <div className="muted small">{draftMsg}</div>}
        {dupNums.size > 0 && <div className="alert alert-error">重复编号：{[...dupNums].join('、')}，提交将被拒绝。</div>}
      </div>

      {rows.map((r, idx) => {
        const hint = REL_HINT[relationHint(r)];
        const sources = r.sources.map((id) => sourceById.get(id)).filter(Boolean);
        return (
          <div key={r.uid} className="card edit-row">
            <div className="edit-row-head">
              {mergeMode && <input type="checkbox" checked={picked.has(r.uid)} onChange={(e) => {
                setPicked((s) => { const n = new Set(s); e.target.checked ? n.add(r.uid) : n.delete(r.uid); return n; });
              }} />}
              <input
                className={`num-input ${dupNums.has(r.num.trim()) ? 'input-error' : ''}`}
                value={r.num}
                onChange={(e) => update(r.uid, { num: e.target.value })}
                placeholder="编号"
              />
              <input
                className="heading-input"
                value={r.heading}
                onChange={(e) => update(r.uid, { heading: e.target.value })}
                placeholder="条款标题"
              />
              <span className={`badge ${hint[1]}`}>{hint[0]}</span>
              <span className="spacer" />
              <button className="btn btn-xs btn-ghost" onClick={() => move(idx, -1)} disabled={idx === 0}>↑</button>
              <button className="btn btn-xs btn-ghost" onClick={() => move(idx, 1)} disabled={idx === rows.length - 1}>↓</button>
              <button className="btn btn-xs" onClick={() => splitRow(idx)} title="复制来源并在其后新增一行">拆分</button>
              <button className="btn btn-xs btn-danger" onClick={() => removeRow(r.uid)}>删除</button>
            </div>
            <textarea
              className="body-input"
              rows={Math.max(3, r.body.split('\n').length)}
              value={r.body}
              onChange={(e) => update(r.uid, { body: e.target.value })}
              placeholder="条款正文（Markdown），引用用 §编号 或 第编号条"
            />
            <div className="sources-line small muted">
              来源条款：
              {sources.length === 0 && <em className="text-warn">无（将记为新增）</em>}
              {sources.map((s) => (
                <span key={s.id} className="source-chip">
                  §{s.num} {s.heading}
                  <button
                    title="移除来源"
                    onClick={() => update(r.uid, { sources: r.sources.filter((x) => x !== s.id) })}
                  >×</button>
                </span>
              ))}
              <SourcePicker row={r} sourceClauses={sourceClauses} onAdd={(id) => update(r.uid, { sources: [...new Set([...r.sources, id])] })} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SourcePicker({ row, sourceClauses, onAdd }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn btn-xs btn-ghost" onClick={() => setOpen(true)}>＋ 指定来源</button>;
  return (
    <select
      defaultValue=""
      onChange={(e) => { if (e.target.value) onAdd(e.target.value); setOpen(false); }}
      onBlur={() => setOpen(false)}
    >
      <option value="">选择上一版条款…</option>
      {sourceClauses.filter((c) => !row.sources.includes(c.id)).map((c) => (
        <option key={c.id} value={c.id}>§{c.num} {c.heading}</option>
      ))}
    </select>
  );
}
