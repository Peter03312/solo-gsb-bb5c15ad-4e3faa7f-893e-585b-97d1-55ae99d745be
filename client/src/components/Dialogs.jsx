import React, { useEffect, useRef, useState } from 'react';
import { api, RELATION_LABELS } from '../api.js';

/* ---------------- 编号沿革弹窗 ---------------- */
export function HistoryModal({ clauseId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/clauses/${clauseId}/history`).then(setData).catch((e) => setError(e.message));
  }, [clauseId]);
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 640 }}>
        <h3>条款编号沿革</h3>
        {error && <div className="alert error">{error}</div>}
        {data && (
          <>
            <div className="muted small" style={{ marginBottom: 10 }}>
              当前条款编号 <b className="mono">{data.clause.num}</b>《{data.clause.title}》（锚定于 v{data.anchorVersionNo}），沿相邻版本记录如下：
            </div>
            {data.steps.length === 0 && <div className="muted">暂无沿革记录。</div>}
            {data.steps.map((s, i) => (
              <div className="history-step" key={i}>
                <span className="badge gray">v{s.toVersionNo ?? '?'}</span>
                <span className="mono">{s.fromNum ?? '—'}</span>
                <span className="arrow">──→</span>
                <span className="mono">{s.toNum ?? '（删除）'}</span>
                <RelationBadge rel={s.relation} />
              </div>
            ))}
          </>
        )}
        <div className="foot"><button onClick={onClose}>关闭</button></div>
      </div>
    </div>
  );
}

export function RelationBadge({ rel }) {
  const cls = {
    added: 'ok', deleted: 'danger', unchanged: 'gray',
    modified: 'warn', split: 'purple', merged: 'purple',
  }[rel] || 'gray';
  return <span className={`badge ${cls}`}>{RELATION_LABELS[rel] || rel}</span>;
}

/* ---------------- 新增批注弹窗（选取原文片段） ---------------- */
export function AnnotationDialog({ versionId, clause, onClose, onCreated }) {
  const bodyRef = useRef(null);
  const [quote, setQuote] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const grabSelection = () => {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (text) setQuote(text);
  };

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      await api(`/versions/${versionId}/annotations`, {
        method: 'POST',
        body: { clauseId: clause.id, quote, content },
      });
      onCreated();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>批注条款 <span className="mono">{clause.num}</span></h3>
        {error && <div className="alert error">{error}</div>}
        <label>① 在下方原文中选取要锚定的片段（须在条款中唯一出现）</label>
        <div ref={bodyRef} onMouseUp={grabSelection}
          style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, maxHeight: 200, overflow: 'auto', background: '#fafbfd', userSelect: 'text' }}>
          <b>{clause.title}</b>
          <div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{clause.body}</div>
        </div>
        <div style={{ marginTop: 10 }}>
          <label>② 锚定原文片段（可手动编辑）</label>
          <textarea rows={2} value={quote} onChange={(e) => setQuote(e.target.value)} placeholder="在上方划选，或直接粘贴唯一片段" />
        </div>
        <div style={{ marginTop: 10 }}>
          <label>③ 批注内容</label>
          <textarea rows={3} value={content} onChange={(e) => setContent(e.target.value)} />
        </div>
        <div className="foot">
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={busy} onClick={submit}>提交批注</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 待重新定位弹窗 ---------------- */
export function RelocateDialog({ annotation, clauses, onClose, onDone }) {
  const [clauseId, setClauseId] = useState('');
  const [quote, setQuote] = useState(annotation.quote);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      await api(`/annotations/${annotation.id}/relocate`, {
        method: 'POST',
        body: { clauseId, quote: quote || annotation.quote },
      });
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>重新定位批注</h3>
        <div className="alert warn">
          该批注原锚定于修订中被改动/拆并的内容，片段无法唯一匹配，需要人工重新指定条款与原文片段。
        </div>
        <div className="small muted" style={{ marginBottom: 10 }}>批注原文：{annotation.content}</div>
        {error && <div className="alert error">{error}</div>}
        <div style={{ marginBottom: 10 }}>
          <label>目标条款</label>
          <select value={clauseId} onChange={(e) => setClauseId(e.target.value)}>
            <option value="">— 请选择 —</option>
            {clauses.map((c) => <option key={c.id} value={c.id}>{c.num} {c.title}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label>原文片段（须在目标条款中唯一出现）</label>
          <textarea rows={2} value={quote} onChange={(e) => setQuote(e.target.value)} />
        </div>
        <div className="foot">
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={busy || !clauseId} onClick={submit}>确认重新定位</button>
        </div>
      </div>
    </div>
  );
}
