import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const REL = {
  unchanged: ['沿用', 'rel-unchanged'],
  renumbered: ['改号·内容未变', 'rel-renumbered'],
  modified: ['内容修改', 'rel-modified'],
  split_from: ['拆分', 'rel-split'],
  merged_into: ['合并', 'rel-merged'],
  deleted: ['删除', 'rel-deleted'],
  created: ['新增', 'rel-created'],
};

export default function History({ docId, currentNo }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api(`/api/docs/${docId}/history`).then(setData).catch((e) => setErr(e.message));
  }, [docId]);

  if (err) return <div className="alert alert-error">{err}</div>;
  if (!data) return <div className="loading">加载中…</div>;

  const byNew = new Map();
  for (const e of data.lineage) {
    if (!byNew.has(e.newNo)) byNew.set(e.newNo, []);
    byNew.get(e.newNo).push(e);
  }

  return (
    <div>
      <div className="card">
        <h3>版本列表（共 {data.versions.length} 版，当前 v{currentNo}）</h3>
        <table className="grid">
          <thead><tr><th>版本</th><th>说明</th><th>提交人</th><th>时间</th></tr></thead>
          <tbody>
            {data.versions.map((v) => (
              <tr key={v.no} className={v.no === currentNo ? 'row-current' : ''}>
                <td>v{v.no}{v.no === currentNo && ' ★'}</td>
                <td>{v.note}</td>
                <td>{v.displayName}</td>
                <td className="muted">{v.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {[...byNew.keys()].sort((a, b) => a - b).map((newNo) => (
        <div className="card" key={newNo}>
          <h3>v{newNo - 1} → v{newNo} 编号沿革</h3>
          <table className="grid lineage-grid">
            <thead>
              <tr><th>上版编号</th><th>关系</th><th>新版编号</th><th>批注 / 签核影响</th></tr>
            </thead>
            <tbody>
              {byNew.get(newNo).map((e, i) => {
                const [text, cls] = REL[e.relation] || [e.relation, ''];
                const effect = {
                  unchanged: '批注沿用；签核继承',
                  renumbered: '仅换序/改号，批注沿用定位；签核继承',
                  modified: '批注尝试片段匹配，失败则待重新定位；签核不继承',
                  split_from: '片段唯一命中则沿用，否则待重新定位；签核不继承',
                  merged_into: '片段唯一命中则沿用，否则待重新定位；签核不继承',
                  deleted: '批注保留在历史版本，不向新版传播；签核不继承',
                  created: '无历史批注；需重新签核',
                }[e.relation];
                return (
                  <tr key={i}>
                    <td className="mono">{e.oldNum ? `§${e.oldNum}` : '—'}</td>
                    <td><span className={`badge ${cls}`}>{text}</span></td>
                    <td className="mono">{e.newNum ? `§${e.newNum}` : '—'}</td>
                    <td className="muted small">{effect}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
