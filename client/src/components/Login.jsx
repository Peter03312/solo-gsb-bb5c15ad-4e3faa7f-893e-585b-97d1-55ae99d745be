import React, { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = { username, password, ...(mode === 'register' ? { displayName } : {}) };
      const r = await api(path, { method: 'POST', body });
      onLogin(r.token, r.user);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>📐 RegCollate</h1>
        <p className="subtitle">技术规程多人校勘平台</p>
        <div className="tabs">
          <button type="button" className={mode === 'login' ? 'tab active' : 'tab'} onClick={() => setMode('login')}>登录</button>
          <button type="button" className={mode === 'register' ? 'tab active' : 'tab'} onClick={() => setMode('register')}>注册</button>
        </div>
        <label>用户名<input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus /></label>
        {mode === 'register' && (
          <label>显示名<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="可选" /></label>
        )}
        <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {err && <div className="alert alert-error">{err}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
        </button>
        <p className="hint">演示账号：zhangsan / lisi，密码 demo1234</p>
      </form>
    </div>
  );
}
