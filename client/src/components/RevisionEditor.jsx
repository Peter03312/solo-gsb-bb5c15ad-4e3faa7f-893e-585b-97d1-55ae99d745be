import React, { useEffect, useMemo, useState } from 'react';
import { api, parseNums, versionToMarkdown } from '../api.js';

/**
 * 修订编辑器。
 * - 初始载入当前最新版本 Markdown；基准版本号固定提交时再次校验。
 * - 拆分/合并通过“新条款 ← 基准条款（可多选）”来源映射表达；留空表示新增。
 * - 收到 409 时绝不静默覆盖：展示冲突说明与服务器当前版本，供用户重新处理。
 */
export default function RevisionEditor({ docId, initial, onClose, onCommitted }) {
  const [markdown, setMarkdown] = useState(() => versionToMarkdown(initial.clauses));
  const [message, setMessage] = useState('');
  const [baseVersion, setBaseVersion] = useState(initial.latestVersionNo);
  const [serverCurrent, setServerCurrent] = useState(null); // 409 携带的当前版本
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showMap, setShowMap] = useState(false);

  // 新条款编号 -> 基准条款 id 数组
  const [sourceMap, setSourceMap] = useState({});

  const newNums = useMemo(() => parseNums(markdown), [markdown]);
  const baseClauses = (serverCurrent?.clauses || initial.clauses);

  // 切换基准（冲突后载入服务器版本）时重置来源映射
  useEffect(() => { setSourceMap({}); }, [baseVersion]);

  const toggleSource = (newNum, clauseId) => {
    setSourceMap((m) => {
      const cur = new Set(m[newNum] || []);
      if (cur.has(clauseId)) cur.delete(clauseId);
      else cur.add(clauseId);
      return { ...m, [newNum]: [...cur] };
    });
  };

  const submit = async (overwriteBase) => {
    setError('');
    // 客户端预检：重复编号给快速提示（服务器仍会严格校验）
    const dup = newNums.filter((n, i) => newNums.indexOf(n) !== i);
    if (dup.length && !window.confirm(`检测到重复编号 ${[...new Set(dup)].join('、')}，服务器将拒绝提交。仍要提交吗？`)) return;

    const map = {};
    for (const [n, ids] of Object.entries(sourceMap)) if (ids.length) map[n] = ids;
    setBusy(true);
    try {
      const res = await api(`/documents/${docId}/revisions`, {
        method: 'POST',
        body: {
          baseVersionNo: overwriteBase ?? baseVersion,
          markdown,
          message,
          sourceMap: Object.keys(map).length ? map : undefined,
        },
      });
      onCommitted(res.versionNo);
    } catch (e) {
      if (e.code === 'version_conflict' && e.detail?.currentVersion) {
        setServerCurrent(e.detail.currentVersion);
        setError(`${e.message}\n\n请对照下方“服务器当前版本”调整后，点“基于当前版本重新提交”；直接覆盖他人修订是不允许的。`);
      } else {
        const detail = e.detail?.errors ? `\n\n${e.detail.errors.map((x) => `· ${x}`).join('\n')}` : '';
        setError(e.message + detail);
      }
    } finally {
      setBusy(false);
    }
  };

  const adoptServerVersion = () => {
    setMarkdown(versionToMarkdown(serverCurrent.clauses));
    setBaseVersion(serverCurrent.version.versionNo);
    setServerCurrent(null);
    setError('');
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 920 }}>
        <h3>提交修订 <span className="muted small">（基准版本 v{baseVersion}）</span></h3>
        {error && <div className="alert error">{error}</div>}
        {serverCurrent && (
          <div className="alert info">
            <b>服务器当前版本 v{serverCurrent.version.versionNo}</b>（{serverCurrent.version.authorName} 提交于
            {' '}{new Date(serverCurrent.version.createdAt).toLocaleString('zh-CN')}）。
            可载入其条款文本作为编辑基础，系统将以 v{serverCurrent.version.versionNo} 为新基准重新校验。
            <div style={{ marginTop: 8 }}><button className="primary" onClick={adoptServerVersion}>载入服务器当前版本继续修订</button></div>
          </div>
        )}

        <div style={{ marginBottom: 10 }}>
          <label>修订说明</label>
          <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="例：重排 3.1–3.4，拆分接地条款" />
        </div>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <label style={{ margin: 0 }}>规程 Markdown（#编号 标题；#编号 或 〔编号〕为条款引用）</label>
          <button type="button" onClick={() => setShowMap((v) => !v)}>
            {showMap ? '收起' : '设置'}拆并来源映射
          </button>
        </div>
        <textarea rows={14} value={markdown} onChange={(e) => setMarkdown(e.target.value)} spellCheck="false" />

        {showMap && (
          <div style={{ marginTop: 10, border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
            <div className="muted small" style={{ marginBottom: 8 }}>
              为每个新条款选择其在 <b>基准版本 v{baseVersion}</b> 中的来源：
              不选＝新增；选 1 条＝修改/沿用；选多条＝<b>合并</b>；同一条款被多个新条款选择＝<b>拆分</b>。
              未设置时默认按相同编号一对一匹配。
            </div>
            {newNums.length === 0 && <div className="muted small">未解析到条款标题。</div>}
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {newNums.map((n) => (
                <div className="src-map-row" key={n} style={{ gridTemplateColumns: '150px 1fr', borderBottom: '1px dashed var(--border)' }}>
                  <span className="mono"># {n}</span>
                  <div className="row wrap" style={{ gap: 4 }}>
                    {baseClauses.map((c) => {
                      const checked = (sourceMap[n] || []).includes(c.id);
                      return (
                        <label key={c.id} style={{ margin: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <input type="checkbox" style={{ width: 'auto' }} checked={checked}
                            onChange={() => toggleSource(n, c.id)} />
                          <span className="mono small">{c.num}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              按住 Ctrl/⌘ 点击可多选；当前映射：
              {Object.entries(sourceMap).filter(([, v]) => v.length).map(([n, ids]) =>
                ` #${n}←${ids.length}条`).join('，') || '（按编号自动匹配）'}
            </div>
          </div>
        )}

        <div className="foot">
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={busy} onClick={() => submit()}>
            {busy ? '校验提交中…' : `提交为 v${baseVersion + 1}`}
          </button>
        </div>
      </div>
    </div>
  );
}
