import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export function ImportDialog({ onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [markdown, setMarkdown] = useState('# 1 总则\n\n本规程适用于……\n\n# 2 引用示例\n\n参见 #1。');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      const res = await api('/documents', { method: 'POST', body: { title, markdown } });
      onCreated(res.docId);
    } catch (e) {
      const detail = e.detail?.errors ? `\n\n${e.detail.errors.map((x) => `· ${x}`).join('\n')}` : '';
      setError(e.message + detail);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>导入规程（初始版本 v1）</h3>
        {error && <div className="alert error">{error}</div>}
        <div style={{ marginBottom: 10 }}>
          <label>规程标题</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：电气装置安装工程接地技术规程" />
        </div>
        <label>带唯一条款编号的 Markdown</label>
        <textarea rows={14} value={markdown} onChange={(e) => setMarkdown(e.target.value)} spellCheck="false" />
        <div className="muted small" style={{ marginTop: 6 }}>
          规则：每个条款以 <code># 编号 标题</code> 开始，编号全文档唯一；正文引用用 <code>#编号</code> 或 <code>〔编号〕</code>，
          重复编号或引用不存在的条款将被拒绝。
        </div>
        <div className="foot">
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={busy} onClick={submit}>{busy ? '校验导入中…' : '导入 v1'}</button>
        </div>
      </div>
    </div>
  );
}

export default function AppShell({ user, onLogout }) {
  const [docs, setDocs] = useState([]);
  const [docId, setDocId] = useState(null);
  const [versions, setVersions] = useState([]);
  const [versionNo, setVersionNo] = useState(null);
  const [data, setData] = useState(null);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loadError, setLoadError] = useState('');

  window.__me = user;

  const loadDocs = async () => {
    const res = await api('/documents');
    setDocs(res.documents);
  };
  useEffect(() => { loadDocs().catch((e) => setLoadError(e.message)); }, []);

  const openDoc = async (id) => {
    setDocId(id);
    const res = await api(`/documents/${id}/versions`);
    setVersions(res.versions);
    const latest = res.versions.at(-1).version_no;
    setVersionNo(latest);
  };

  useEffect(() => {
    if (!docId || !versionNo) return;
    let cancelled = false;
    api(`/documents/${docId}/versions/${versionNo}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => !cancelled && setLoadError(e.message));
    return () => { cancelled = true; };
  }, [docId, versionNo]);

  const reloadCurrent = async () => {
    const res = await api(`/documents/${docId}/versions`);
    setVersions(res.versions);
    const d = await api(`/documents/${docId}/versions/${versionNo}`);
    setData(d);
  };

  return (
    <div className="layout">
      <div className="sidebar">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <b>规程文档</b>
          <button className="primary" onClick={() => setImporting(true)}>＋ 导入</button>
        </div>
        {loadError && <div className="alert error">{loadError}</div>}
        {docs.length === 0 && <div className="muted small">尚无文档，点击“导入”创建第一份规程。</div>}
        {docs.map((d) => (
          <div key={d.id} className={`doc-item ${d.id === docId ? 'active' : ''}`} onClick={() => openDoc(d.id)}>
            <div className="t">{d.title}</div>
            <div className="muted small">{d.version_count} 个版本 · 最新 v{d.latest_version}</div>
          </div>
        ))}
      </div>

      <div className="main">
        {!docId && (
          <div className="card">
            <h2>开始使用</h2>
            <div className="muted">
              1. 左侧“导入”带唯一条款编号的 Markdown，系统建立 v1 并校验编号唯一性与引用完整性。<br />
              2. 在当前版本上批注（锚定条款 + 唯一原文片段）、签核条款。<br />
              3. “基于本版修订”可重排、拆分、合并条款；提交时记录相邻版本沿革，批注与签核按规则继承。<br />
              4. 多人同时修订时以版本号检测冲突：过期基准返回 409 与当前版本，不会静默覆盖。
            </div>
          </div>
        )}
        {docId && (
          <div className="row wrap" style={{ marginBottom: 14, gap: 6 }}>
            <b style={{ marginRight: 6 }}>版本：</b>
            {versions.map((v) => (
              <span key={v.id} className={`ver-item ${v.version_no === versionNo ? 'active' : ''}`}
                onClick={() => setVersionNo(v.version_no)}>
                v{v.version_no}
                {v.version_no === versions.at(-1).version_no && <span className="badge ok" style={{ marginLeft: 4 }}>最新</span>}
              </span>
            ))}
          </div>
        )}
        {docId && data && !editing && (
          <VersionViewWrapper
            data={data}
            reload={reloadCurrent}
            onStartRevision={() => setEditing(true)}
          />
        )}
        {docId && editing && data && (
          <RevisionEditorWrapper
            docId={docId}
            initial={data.version.isLatest ? data : null}
            latestLoader={() => api(`/documents/${docId}/versions/latest`)}
            onClose={() => setEditing(false)}
            onCommitted={async (no) => {
              setEditing(false);
              const res = await api(`/documents/${docId}/versions`);
              setVersions(res.versions);
              setVersionNo(no);
              await loadDocs();
            }}
          />
        )}
      </div>

      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onCreated={async (id) => {
            setImporting(false);
            await loadDocs();
            await openDoc(id);
          }}
        />
      )}
    </div>
  );
}

// 轻包装：修订编辑器始终基于最新版本打开（历史版本按钮不出现，仅最新版可修订）
import VersionView from './VersionView.jsx';
import RevisionEditor from './RevisionEditor.jsx';

function VersionViewWrapper(props) { return <VersionView {...props} />; }
function RevisionEditorWrapper({ latestLoader, ...rest }) {
  const [latest, setLatest] = React.useState(rest.initial);
  React.useEffect(() => {
    if (!latest) latestLoader().then(setLatest).catch(() => {});
  }, []);
  if (!latest) return <div className="card muted">载入最新版本中…</div>;
  return <RevisionEditor {...rest} initial={latest} />;
}
