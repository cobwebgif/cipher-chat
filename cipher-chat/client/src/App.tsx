import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import GatePage from './pages/GatePage';
import AuthPage from './pages/AuthPage';
import FriendsTab from './pages/FriendsTab';
import EveryoneTab from './pages/EveryoneTab';
import GroupsTab from './pages/GroupsTab';

type Tab = 'friends' | 'everyone' | 'groups';

function AppShell() {
  const { user, loading, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('everyone');

  if (loading) {
    return (
      <div className="gate-page">
        <div className="gate-card">
          <div className="gate-lock spin">◌</div>
        </div>
      </div>
    );
  }

  if (!user) return <AuthPage />;

  return (
    <SocketProvider>
      <div className="app">
        {/* Top bar */}
        <header className="topbar">
          <span className="topbar-logo">Cipher</span>
          <span className="topbar-user">@{user.username}</span>
          <button className="topbar-logout" onClick={logout}>Sign out</button>
        </header>

        {/* Tab navigation */}
        <nav className="tabs">
          <button
            className={`tab ${tab === 'friends' ? 'active' : ''}`}
            onClick={() => setTab('friends')}
          >
            Friends
          </button>
          <button
            className={`tab ${tab === 'everyone' ? 'active' : ''}`}
            onClick={() => setTab('everyone')}
          >
            Everyone
          </button>
          <button
            className={`tab ${tab === 'groups' ? 'active' : ''}`}
            onClick={() => setTab('groups')}
          >
            Groups
          </button>
        </nav>

        {/* Tab content */}
        <main className="tab-content">
          {tab === 'friends' && <FriendsTab />}
          {tab === 'everyone' && <EveryoneTab />}
          {tab === 'groups' && <GroupsTab />}
        </main>
      </div>
    </SocketProvider>
  );
}

function App() {
  const [unlocked, setUnlocked] = useState(() => {
    return sessionStorage.getItem('cipher_gate') === '1';
  });

  if (!unlocked) return <GatePage onUnlock={() => setUnlocked(true)} />;

  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

export default App;
