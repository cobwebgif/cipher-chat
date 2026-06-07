import { useState } from 'react';

const SITE_PASSWORD = import.meta.env.VITE_SITE_PASSWORD || 'talha2010';

interface GateProps {
  onUnlock: () => void;
}

export default function GatePage({ onUnlock }: GateProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    if (input === SITE_PASSWORD) {
      sessionStorage.setItem('cipher_gate', '1');
      onUnlock();
    } else {
      setError('Incorrect password.');
      setInput('');
    }
  };

  return (
    <div className="gate-page">
      <div className="gate-card">
        <div className="gate-lock">⊗</div>
        <h1 className="gate-title">Cipher</h1>
        <p className="gate-desc">
          This is a private website only for a few people. You need to enter a
          password to open this website.
        </p>
        <div className="gate-form">
          <input
            type="password"
            className="input"
            placeholder="Enter password"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            autoComplete="off"
            autoFocus
          />
          {error && <p className="error-msg">{error}</p>}
          <button className="btn btn-primary" onClick={handleSubmit}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
