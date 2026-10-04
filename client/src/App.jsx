import React, { useEffect, useState } from 'react';
import { getAuth, setAuth, clearAuth, api } from './api.js';
import Login from './components/Login.jsx';
import DocList from './components/DocList.jsx';
import DocView from './components/DocView.jsx';

export default function App() {
  const [auth, setAuthState] = useState(getAuth());
  const [docId, setDocId] = useState(null);
  const [me, setMe] = useState(auth.user);

  useEffect(() => {
    if (auth.token) {
      api('/api/auth/me').then((r) => setMe(r.user)).catch(() => logout());
    }
  }, [auth.token]);

  const onLogin = (token, user) => {
    setAuth(token, user);
    setAuthState(getAuth());
  };
  const logout = () => {
    clearAuth();
    setAuthState({ token: null, user: null });
    setMe(null);
    setDocId(null);
  };

  if (!auth.token) return <Login onLogin={onLogin} />;

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setDocId(null)} title="返回文档列表">
          📐 RegCollate <span>技术规程多人校勘</span>
        </button>
        <div className="topbar-right">
          {me && <span className="user-chip">{me.displayName}（{me.username}）</span>}
          <button className="btn btn-ghost" onClick={logout}>退出</button>
        </div>
      </header>
      <main className="container">
        {docId
          ? <DocView docId={docId} onBack={() => setDocId(null)} />
          : <DocList onOpen={setDocId} />}
      </main>
    </div>
  );
}
