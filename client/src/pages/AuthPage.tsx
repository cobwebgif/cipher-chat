import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function AuthPage() {
  const { register, login } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError('');
    if (!username.trim()) return setError('Enter a username.');
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) return setError('PIN must be exactly 4 digits.');

    setLoading(true);
    try {
      if (mode === 'register') {
        await register(username.trim(), pin);
      } else {
        await login(username.trim(), pin);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="gate-page">
      <div className="gate-card">
        <div className="gate-lock">◈</div>
        <h1 className="gate-title">Cipher</h1>

        <div className="auth-tabs">
          <button
            className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => { setMode('login'); setError(''); }}
          >
            Sign In
          </button>
          <button
            className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => { setMode('register'); setError(''); }}
          >
            Create Account
          </button>
        </div>

        <div className="gate-form">
          <div className="field-group">
            <label className="field-label">Username</label>
            <input
              type="text"
              className="input"
              placeholder="your_username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              autoComplete="username"
              autoFocus
            />
          </div>

          <div className="field-group">
            <label className="field-label">4-digit PIN</label>
            <input
              type="password"
              className="input"
              placeholder="••••"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              autoComplete="current-password"
            />
          </div>

          {error && <p className="error-msg">{error}</p>}

          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Please wait…' : mode === 'register' ? 'Create Account' : 'Sign In'}
          </button>
        </div>

        {mode === 'register' && (
          <p className="gate-note">
            Your PIN is hashed before storage. Messages are end-to-end encrypted.
          </p>
        )}
      </div>
    </div>
  );
}
