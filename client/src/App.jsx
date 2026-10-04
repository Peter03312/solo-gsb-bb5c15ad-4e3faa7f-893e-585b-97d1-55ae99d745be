import React, { useState } from 'react';
import { auth } from './api.js';
import Login from './components/Login.jsx';
import AppShell from './components/AppShell.jsx';

export default function App() {
  const [user, setUser] = useState(() => auth.user);

  if (!user) return <Login onLogin={setUser} />;

  return (
    <>
      <div className="topbar">
        <h1>技术规程多人校勘平台</h1>
        <span className="spacer" />
        <span className="who">{user.displayName}（{user.username}）</span>
        <button onClick={() => { auth.clear(); setUser(null); }}>退出</button>
      </div>
      <AppShell user={user} onLogout={() => setUser(null)} />
    </>
  );
}
