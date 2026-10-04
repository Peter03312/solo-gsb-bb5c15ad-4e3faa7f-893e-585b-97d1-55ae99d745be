import React, { useState } from 'react';
import { api, auth } from '../api.js';

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      if (mode === 'register') {
        await api('/auth/register', { method: 'POST', body: { username, password, displayName } });
      }
      const res = await api('/auth/login', { method: 'POST', body: { username, password } });
      auth.save(res.token, res.user);
      onLogin(res.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="card">
        <div className="logo">技术规程多人校勘平台</div>
        <div className="sub">条款沿革 · 批注定位 · 签核继承 · 乐观并发</div>
        <div className="tabs">
          <button className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>登录</button>
          <button className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>注册</button>
        </div>
        {error && <div className="alert error">{error}</div>}
        <div style={{ marginBottom: 10 }}>
          <label>用户名</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </div>
        {mode === 'register' && (
          <div style={{ marginBottom: 10 }}>
            <label>显示名（可选）</label>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
        )}
        <div style={{ marginBottom: 16 }}>
          <label>密码</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </div>
        <button className="primary" style={{ width: '100%' }} disabled={busy} onClick={submit}>
          {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
        </button>
        {mode === 'login' && (
          <div className="muted small" style={{ marginTop: 10, textAlign: 'center' }}>
            默认管理员：admin / admin123（可用 ADMIN_PASSWORD 修改）
          </div>
        )}
      </div>
    </div>
  );
}
