import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const TEMPLATE = `# 新规程标题

## 1 范围
本规程适用于……，术语见 §2。

## 2 术语
……
`;

export default function DocList({ onOpen }) {
  const [docs, setDocs] = useState([]);
  const [showImport, setShowImport] = useState(false);
  const [title, setTitle] = useState('');
  const [markdown, setMarkdown] = useState(TEMPLATE);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = async () => {
    const r = await api('/api/docs');
    setDocs(r.docs);
  };
  useEffect(() => { load().catch(() => {}); }, []);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMarkdown(await file.text());
    if (!title) setTitle(file.name.replace(/\.md$/i, ''));
  };

  const submit = async (ev) => {
    ev.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await api('/api/docs', { method: 'POST', body: { title, markdown } });
      onOpen(r.documentId);
    } catch (e) {
      setErr(e.code === 'BROKEN_REFERENCE' ? `${e.message}${e.details?.missing ? '（' + e.details.missing.join('、') + '）' : ''}` : e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h2>规程列表</h2>
        <button className="btn btn-primary" onClick={() => setShowImport((v) => !v)}>
          {showImport ? '取消导入' : '＋ 导入 Markdown 版本'}
        </button>
      </div>

      {showImport && (
        <form className="card import-card" onSubmit={submit}>
          <p className="muted">
            条款以 Markdown 标题标识，格式如 <code>## 1 标题</code> 或 <code>## 第1条 标题</code>。
            编号须唯一；正文中可用 <code>§2.1</code> 或「第2.1条」交叉引用，引用不存在的条款将被拒绝。
          </p>
          <label>规程标题（可空，默认取首个一级标题）
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：2026 版检修技术规程" />
          </label>
          <div className="row-between">
            <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>选择 .md 文件</button>
            <input ref={fileRef} type="file" accept=".md,.markdown,text/markdown" hidden onChange={onFile} />
          </div>
          <textarea className="md-input" rows={14} value={markdown} onChange={(e) => setMarkdown(e.target.value)} />
          {err && <div className="alert alert-error">{err}</div>}
          <button className="btn btn-primary" disabled={busy}>{busy ? '校验并导入中…' : '校验并创建初始版本（v0）'}</button>
        </form>
      )}

      <div className="doc-grid">
        {docs.length === 0 && <div className="empty">还没有规程，点击右上角导入第一份 Markdown。</div>}
        {docs.map((d) => (
          <div key={d.id} className="card doc-card" onClick={() => onOpen(d.id)}>
            <h3>{d.title}</h3>
            <div className="muted">当前版本：v{d.currentVersionNo}</div>
            <div className="muted small">创建者：{d.creator.displayName} · {d.createdAt}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
