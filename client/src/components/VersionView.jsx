import React, { useState } from 'react';
import { api } from '../api.js';
import Markdown from './Markdown.jsx';
import { AnnotationDialog, HistoryModal, RelationBadge, RelocateDialog } from './Dialogs.jsx';

export default function VersionView({ data, reload, onStartRevision }) {
  const { version, clauses, pendingAnnotations } = data;
  const readonly = !version.isLatest;
  const [annFor, setAnnFor] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const [relocating, setRelocating] = useState(null);
  const [busySign, setBusySign] = useState(null);

  const toggleSign = async (clause, signed) => {
    setBusySign(clause.id);
    try {
      if (signed) {
        await api(`/versions/${version.id}/clauses/${clause.id}/signoff`, { method: 'DELETE' });
      } else {
        await api(`/versions/${version.id}/clauses/${clause.id}/signoff`, { method: 'POST' });
      }
      reload();
    } finally {
      setBusySign(null);
    }
  };

  return (
    <div>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>
              {data.document.title}
              <span className="badge gray" style={{ marginLeft: 10 }}>v{version.versionNo}</span>
              {version.isLatest
                ? <span className="badge ok" style={{ marginLeft: 8 }}>当前版本</span>
                : <span className="badge warn" style={{ marginLeft: 8 }}>历史版本（只读）</span>}
            </h2>
            <div className="muted small">
              {version.authorName} 提交于 {new Date(version.createdAt).toLocaleString('zh-CN')}
              {version.message ? ` · 说明：${version.message}` : ''}
            </div>
          </div>
          {!readonly && (
            <button className="primary" onClick={onStartRevision}>基于本版修订（v{version.versionNo}）</button>
          )}
        </div>
      </div>

      {!readonly && pendingAnnotations.length > 0 && (
        <div className="card pending-bar" style={{ borderColor: '#efd9ac', background: '#fffdf7' }}>
          <h2 style={{ color: 'var(--warn)' }}>⚠ {pendingAnnotations.length} 条批注待重新定位</h2>
          <div className="muted small" style={{ marginBottom: 8 }}>
            内容改变、拆分/合并或原文片段无法唯一匹配的批注不会自动沿用，请逐条人工锚定。
          </div>
          {pendingAnnotations.map((a) => (
            <div key={a.id} className="ann pending" style={{ marginBottom: 6 }}>
              <div><b>{a.author_name || a.authorName}</b>：{a.content}</div>
              {a.quote && <div className="quote">原片段：{a.quote}</div>}
              <button style={{ marginTop: 6 }} onClick={() => setRelocating(a)}>重新定位</button>
            </div>
          ))}
        </div>
      )}

      {clauses.map((c) => {
        const mine = c.signoffs.find((s) => s.user_id === (window.__me?.id));
        return (
          <div className="clause" key={c.id}>
            <div className="clause-head">
              <span className="num">{c.num}</span>
              <b>{c.title}</b>
              <span className="spacer" style={{ flex: 1 }} />
              <button onClick={() => setHistoryFor(c.id)}>编号沿革</button>
              {!readonly && <button onClick={() => setAnnFor(c)}>批注</button>}
              {!readonly && (
                <button
                  className={mine ? 'danger' : 'primary'}
                  disabled={busySign === c.id}
                  onClick={() => toggleSign(c, !!mine)}
                >
                  {mine ? '撤销我的签核' : '签核'}
                </button>
              )}
            </div>
            <div className="clause-body">
              <Markdown source={c.body} />

              {c.signoffs.length > 0 && (
                <div className="signoff-line">
                  <span className="muted small">签核：</span>
                  {c.signoffs.map((s) => (
                    <span key={s.id} className={`badge ${s.inherited ? 'purple' : 'ok'}`}
                      title={s.inherited ? '内容未变，自上一版本自动继承' : '本版本直接签核'}>
                      {s.user_name || s.userName}{s.inherited ? '（继承）' : ' ✓'}
                    </span>
                  ))}
                </div>
              )}

              {c.annotations.map((a) => (
                <div key={a.id} className={`ann ${a.status === 'pending' ? 'pending' : ''}`}>
                  <div className="small muted">
                    <b>{a.author_name || a.authorName}</b>
                    {new Date(a.created_at).toLocaleString('zh-CN')}
                    {a.status === 'pending' && !readonly && <button style={{ marginLeft: 8, padding: '2px 8px' }} onClick={() => setRelocating(a)}>重新定位</button>}
                  </div>
                  {a.quote && <div className="quote">“{a.quote}”</div>}
                  <div>{a.content}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {annFor && (
        <AnnotationDialog
          versionId={version.id}
          clause={annFor}
          onClose={() => setAnnFor(null)}
          onCreated={() => { setAnnFor(null); reload(); }}
        />
      )}
      {historyFor && <HistoryModal clauseId={historyFor} onClose={() => setHistoryFor(null)} />}
      {relocating && (
        <RelocateDialog
          annotation={relocating}
          clauses={clauses}
          onClose={() => setRelocating(null)}
          onDone={() => { setRelocating(null); reload(); }}
        />
      )}
    </div>
  );
}
