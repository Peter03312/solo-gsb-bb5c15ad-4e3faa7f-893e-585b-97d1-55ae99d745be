import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Editor from './Editor.jsx';
import History from './History.jsx';

const RELATION_LABEL = {
  unchanged: { text: '沿用', cls: 'rel-unchanged' },
  renumbered: { text: '改号·内容未变', cls: 'rel-renumbered' },
  modified: { text: '内容已修改', cls: 'rel-modified' },
  split_from: { text: '由上版拆分', cls: 'rel-split' },
  merged_into: { text: '合并而来', cls: 'rel-merged' },
  deleted: { text: '已删除', cls: 'rel-deleted' },
  created: { text: '新增', cls: 'rel-created' },
};

export default function DocView({ docId, onBack }) {
  const [payload, setPayload] = useState(null);
  const [versions, setVersions] = useState([]);
  const [viewNo, setViewNo] = useState(null);
  const [viewData, setViewData] = useState(null);
  const [tab, setTab] = useState('read');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(null);

  const loadCurrent = async () => {
    const r = await api(`/api/docs/${docId}`);
    setPayload(r);
    setViewNo(r.version.no);
    return r;
  };

  useEffect(() => {
    setError('');
    loadCurrent().catch((e) => setError(e.message));
    api(`/api/docs/${docId}/history`).then((r) => setVersions(r.versions)).catch(() => {});
  }, [docId]);

  useEffect(() => {
    if (viewNo == null || !payload) return;
    if (viewNo === payload.version.no) {
      setViewData(payload);
      return;
    }
    let alive = true;
    api(`/api/docs/${docId}/versions/${viewNo}`).then((r) => alive && setViewData(r)).catch((e) => setError(e.message));
    return () => { alive = false; };
  }, [viewNo, payload, docId]);

  const reloadHistoryList = async () => {
    const r = await api(`/api/docs/${docId}/history`);
    setVersions(r.versions);
  };

  const onCommitted = async (r) => {
    await loadCurrent();
    await reloadHistoryList();
    setTab('read');
    setNotice(`已提交 v${r.version.no}（${r.version.note}）`);
    setTimeout(() => setNotice(''), 4000);
  };

  const onConflict = (err) => {
    setConflict({
      base: err.details?.baseVersionNo,
      current: err.details?.currentVersionNo,
      currentPayload: err.details?.current,
    });
  };

  if (!payload || !viewData) return <div className="loading">{error || '加载中…'}</div>;

  const isCurrent = viewData.isCurrent;
  const pending = viewData.annotations.filter((a) => a.status === 'pending');
  const deletedHistory = viewData.annotations.filter((a) => a.status === 'deleted_history');

  return (
    <div>
      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
          <button className="btn btn-xs btn-ghost" style={{ float: 'right' }} onClick={() => setError('')}>关闭</button>
        </div>
      )}
      <div className="page-head doc-head">
        <div>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>← 返回列表</button>
          <h2 className="doc-title">{viewData.title} <span className="ver-tag">v{viewData.version.no}{isCurrent ? '' : '（历史版本）'}</span></h2>
          <div className="muted small">
            {viewData.version.creator?.displayName} 提交于 {viewData.version.createdAt} · 备注：{viewData.version.note}
          </div>
        </div>
        <div>
          <select className="ver-select" value={viewNo} onChange={(e) => setViewNo(Number(e.target.value))}>
            {versions.map((v) => (
              <option key={v.no} value={v.no}>v{v.no} — {v.note}{v.no === payload.version.no ? '（当前）' : ''}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="tabs tabs-main">
        <button className={tab === 'read' ? 'tab active' : 'tab'} onClick={() => setTab('read')}>阅读 / 批注 / 签核</button>
        {isCurrent && <button className={tab === 'edit' ? 'tab active' : 'tab'} onClick={() => setTab('edit')}>修订（重排·拆分·合并）</button>}
        <button className={tab === 'history' ? 'tab active' : 'tab'} onClick={() => setTab('history')}>编号沿革</button>
      </div>

      {notice && <div className="alert alert-success">{notice}</div>}

      {tab === 'read' && (
        <ReadView
          docId={docId}
          data={viewData}
          isCurrent={isCurrent}
          pending={pending}
          deletedHistory={deletedHistory}
          onChanged={loadCurrent}
          setError={setError}
        />
      )}
      {tab === 'edit' && isCurrent && (
        <Editor key={`${docId}@${payload.version.no}`} docId={docId} base={payload} onCommitted={onCommitted} onConflict={onConflict} setError={setError} />
      )}
      {tab === 'history' && <History docId={docId} currentNo={payload.version.no} />}

      {conflict && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>⛔ 版本冲突，提交已被拒绝</h3>
            <p>
              您基于 <b>v{conflict.base}</b> 修订，但当前最新版本已是 <b>v{conflict.current}</b>。
              系统未做任何覆盖。请取回当前版本，对照后把您的修改重新应用，再提交。
            </p>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => {
                setConflict(null);
                loadCurrent();
                setTab('edit');
              }}>取回当前 v{conflict.current} 重新处理</button>
              <button className="btn btn-ghost" onClick={() => setConflict(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReadView({ docId, data, isCurrent, pending, deletedHistory, onChanged, setError }) {
  const incomingByClause = useMemo(() => {
    const m = new Map();
    for (const e of data.lineage) {
      if (!m.has(e.newClauseId)) m.set(e.newClauseId, []);
      m.get(e.newClauseId).push(e);
    }
    return m;
  }, [data.lineage]);

  return (
    <div>
      {pending.length > 0 && isCurrent && (
        <div className="alert alert-warning">
          <b>{pending.length} 条批注待重新定位</b>：原条款内容改变、拆分合并或原文片段已无法唯一匹配。
          请在下方逐条手动重新锚定。
        </div>
      )}
      {!isCurrent && (
        <div className="alert alert-info">
          正在查看历史版本。被删除条款的批注保留在此版本中（不会传播到新版本）。
        </div>
      )}

      {pending.length > 0 && isCurrent && (
        <div className="card pending-panel">
          <h3>🧭 待重新定位的批注</h3>
          {pending.map((a) => <PendingRow key={a.id} ann={a} data={data} onChanged={onChanged} setError={setError} />)}
        </div>
      )}

      <div className="clause-list">
        {data.clauses.map((c) => (
          <ClauseCard
            key={c.id}
            docId={docId}
            clause={c}
            edges={incomingByClause.get(c.id) || []}
            annotations={data.annotations.filter((a) => a.clauseId === c.id && a.status === 'anchored')}
            signoffs={data.signoffs[c.id]?.users || []}
            isCurrent={isCurrent}
            onChanged={onChanged}
            setError={setError}
          />
        ))}
      </div>

      {deletedHistory.length > 0 && (
        <div className="card">
          <h3>🗄 已删除条款的批注（仅存于历史版本）</h3>
          {deletedHistory.map((a) => (
            <div key={a.id} className="ann ann-history">
              <div className="ann-meta">{a.author.displayName} · 原锚定第 {a.clauseNum} 条 · {a.createdAt}</div>
              <blockquote className="quote">{a.anchorQuote}</blockquote>
              <div>{a.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PendingRow({ ann, data, onChanged, setError }) {
  const [targetId, setTargetId] = useState('');
  const [quote, setQuote] = useState(ann.anchorQuote);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!targetId) return setError('请选择要锚定的目标条款');
    setBusy(true);
    try {
      await api(`/api/annotations/${ann.id}/relocate`, {
        method: 'POST',
        body: { clauseId: targetId, quote },
      });
      await onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ann ann-pending">
      <div className="ann-meta">{ann.author.displayName} · 原锚定第 {ann.anchorNum} 条 · {ann.createdAt}</div>
      <blockquote className="quote">{ann.anchorQuote}</blockquote>
      <div>{ann.body}</div>
      <div className="relocate-row">
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          <option value="">选择目标条款…</option>
          {data.clauses.map((c) => <option key={c.id} value={c.id}>第 {c.num} 条 {c.heading}</option>)}
        </select>
        <input value={quote} onChange={(e) => setQuote(e.target.value)} placeholder="目标条款中的原文片段" />
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={submit}>重新锚定</button>
      </div>
    </div>
  );
}

function ClauseCard({ docId, clause, edges, annotations, signoffs, isCurrent, onChanged, setError }) {
  const [sel, setSel] = useState('');
  const [showBox, setShowBox] = useState(false);
  const [quoteInput, setQuoteInput] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const myId = JSON.parse(localStorage.getItem('rc_user') || 'null')?.id;
  const signedByMe = signoffs.some((u) => u.id === myId);

  const onMouseUp = () => {
    const s = window.getSelection();
    const t = s?.toString().trim() || '';
    if (t) {
      setSel(t);
      setQuoteInput(t);
    }
  };

  const submitAnn = async () => {
    const quote = sel || quoteInput;
    if (!text.trim() || !quote) return;
    setBusy(true);
    try {
      await api(`/api/annotations/docs/${docId}`, {
        method: 'POST',
        body: { clauseId: clause.id, quote, body: text.trim() },
      });
      setText(''); setSel(''); setQuoteInput(''); setShowBox(false);
      await onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleSign = async () => {
    try {
      if (signedByMe) {
        await api(`/api/signoffs/docs/${docId}/clauses/${clause.id}`, { method: 'DELETE' });
      } else {
        await api(`/api/signoffs/docs/${docId}/clauses/${clause.id}`, { method: 'POST', body: {} });
      }
      await onChanged();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="card clause-card" id={`clause-${clause.num.replace(/\./g, '-')}`}>
      <div className="clause-head">
        <h3><span className="clause-num">第 {clause.num} 条</span> {clause.heading}</h3>
        <div className="badges">
          {edges.map((e, i) => {
            const r = RELATION_LABEL[e.relation] || { text: e.relation, cls: '' };
            return (
              <span key={i} className={`badge ${r.cls}`} title={`上一版第 ${e.oldNum ?? '?'} 条 → 第 ${e.newNum ?? '?'} 条`}>
                {e.oldNum ? `上版§${e.oldNum} ` : ''}{r.text}
              </span>
            );
          })}
        </div>
      </div>
      <div className="clause-body" onMouseUp={isCurrent ? onMouseUp : undefined}>
        {clause.body.split('\n').map((ln, i) => <div key={i}>{ln || ' '}</div>)}
      </div>

      <div className="clause-actions">
        <span className="signoff-line">
          {signoffs.length > 0 && (
            <span className="signoffs">✅ 已签核：{signoffs.map((u) => u.displayName).join('、')}</span>
          )}
        </span>
        {isCurrent && (
          <span className="action-btns">
            <button className="btn btn-sm btn-ghost" onClick={() => setShowBox((v) => !v)}>＋ 批注{sel ? '（已选片段）' : ''}</button>
            <button className={`btn btn-sm ${signedByMe ? 'btn-warn' : 'btn-ok'}`} onClick={toggleSign}>
              {signedByMe ? '撤回我的签核' : '签核本条款'}
            </button>
          </span>
        )}
      </div>

      {showBox && isCurrent && (
        <div className="ann-box">
          <div className="muted small">在上方正文划选片段，或手动粘贴（须在本条款中唯一出现）：</div>
          <input value={sel || quoteInput} onChange={(e) => { setSel(''); setQuoteInput(e.target.value); }} placeholder="锚定的原文片段" />
          <textarea rows={2} placeholder="批注内容…" value={text} onChange={(e) => setText(e.target.value)} />
          <div>
            <button className="btn btn-primary btn-sm" disabled={busy || !(sel || quoteInput) || !text.trim()} onClick={submitAnn}>提交批注</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowBox(false); setSel(''); setQuoteInput(''); setText(''); }}>取消</button>
          </div>
        </div>
      )}

      {annotations.length > 0 && (
        <div className="ann-list">
          {annotations.map((a) => (
            <div key={a.id} className={`ann ${a.resolved ? 'ann-resolved' : ''}`}>
              <div className="ann-meta">{a.author.displayName} · {a.createdAt}{a.resolved ? ' · 已解决' : ''}</div>
              <blockquote className="quote">{a.anchorQuote}</blockquote>
              <div>{a.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
