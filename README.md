# Cipher — Private Encrypted Messaging

A minimalistic, end-to-end encrypted messaging application. Black and white. No fluff.

---

## Features

- **Password-gated access** — site password required to even open the app
- **Account creation** with username + 4-digit PIN (hashed with bcrypt)
- **End-to-end encryption** — messages are encrypted in the browser; the server never sees plaintext
- **Direct messages** — private 1-to-1 conversations
- **Global chat** — everyone in one room
- **Group chats** — create named groups, invite members
- **Real-time** — Socket.IO for live messaging
- **Mobile-first** — responsive, works on Android phones

---

## Encryption Architecture

```
Direct Messages (Hybrid RSA-OAEP + AES-GCM):
  1. Generate random 256-bit AES key per message
  2. Encrypt plaintext with AES-GCM
  3. Encrypt the AES key with recipient's RSA-2048 public key
  4. Server stores: { ciphertext, iv, encryptedKey } — all opaque

Group / Global Chat (Symmetric AES-GCM):
  - Global: key derived from site password via PBKDF2 (shared by all members)
  - Groups: random AES key per group, encrypted with each member's RSA public key

Private keys are stored in IndexedDB — they NEVER leave the device.
```

---

## Project Structure

```
cipher-chat/
├── server/              # Node.js + Express + Socket.IO
│   ├── src/
│   │   ├── index.ts     # Entry point
│   │   ├── database.ts  # SQLite schema & init
│   │   ├── socket.ts    # Real-time events
│   │   ├── middleware/
│   │   │   └── auth.ts  # JWT middleware
│   │   └── routes/
│   │       ├── auth.ts      # Register, login, /me
│   │       ├── users.ts     # User list, public keys
│   │       └── messages.ts  # DMs, global, groups
│   ├── package.json
│   └── tsconfig.json
│
├── client/              # React + TypeScript + Vite
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── styles.css
│   │   ├── types/
│   │   ├── utils/
│   │   │   ├── crypto.ts    # All E2E encryption logic
│   │   │   ├── api.ts       # Fetch wrapper
│   │   │   └── uuid.ts
│   │   ├── contexts/
│   │   │   ├── AuthContext.tsx
│   │   │   └── SocketContext.tsx
│   │   ├── pages/
│   │   │   ├── GatePage.tsx
│   │   │   ├── AuthPage.tsx
│   │   │   ├── FriendsTab.tsx
│   │   │   ├── EveryoneTab.tsx
│   │   │   └── GroupsTab.tsx
│   │   └── components/
│   │       ├── MessageBubble.tsx
│   │       └── MessageInput.tsx
│   ├── package.json
│   └── vite.config.ts
│
├── package.json         # Root scripts
├── render.yaml          # Render deployment
├── netlify.toml         # Netlify deployment
└── README.md
```

---

## Local Development Setup

### Prerequisites
- Node.js 18+
- npm 9+

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/cipher-chat.git
cd cipher-chat
npm run install:all
# OR manually:
cd server && npm install
cd ../client && npm install
```

### 2. Configure environment variables

**Server** (`server/.env`):
```env
PORT=3001
JWT_SECRET=your-super-secret-jwt-key-at-least-64-chars-long
CLIENT_URL=http://localhost:5173
DB_PATH=./data/cipher.db
```

**Client** (`client/.env`):
```env
VITE_API_URL=http://localhost:3001
VITE_SITE_PASSWORD=talha2010
```

### 3. Run in development

```bash
# From root (runs both server and client)
npm install  # installs concurrently
npm run dev

# Or separately:
cd server && npm run dev     # runs on :3001
cd client && npm run dev     # runs on :5173
```

Open http://localhost:5173

---

## Production Deployment

### Option A: Render (backend) + Netlify (frontend)

**Deploy Backend to Render:**

1. Push the repo to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Settings:
   - **Build Command**: `cd server && npm install && npm run build`
   - **Start Command**: `cd server && npm start`
   - **Environment**: Node
5. Add environment variables:
   - `JWT_SECRET` — generate a random 64-char string
   - `CLIENT_URL` — your Netlify URL (add after deploying frontend)
   - `DB_PATH` — `/var/data/cipher.db`
6. Add a **Disk** (Render free tier doesn't have persistent disk; upgrade or use a cloud DB)
   - Mount path: `/var/data`, Size: 1 GB

**Deploy Frontend to Netlify:**

1. Go to [netlify.com](https://netlify.com) → Add new site → Import from Git
2. Settings:
   - **Base directory**: `client`
   - **Build command**: `npm run build`
   - **Publish directory**: `client/dist`
3. Add environment variables:
   - `VITE_API_URL` — your Render backend URL (e.g. `https://cipher-chat.onrender.com`)
   - `VITE_SITE_PASSWORD` — `talha2010`
4. Deploy

Then go back to Render and update `CLIENT_URL` to your Netlify URL.

---

### Option B: Render only (full-stack)

Serve the frontend as static files from Express:

1. Build the client: `npm run build --prefix client`
2. In `server/src/index.ts`, add:
```typescript
import path from 'path';
app.use(express.static(path.join(__dirname, '../../client/dist')));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
});
```
3. Deploy to Render as a single service

---

### Option C: Railway

1. Connect GitHub repo to [railway.app](https://railway.app)
2. Add a service for the server
3. Set environment variables same as above
4. Add a volume for SQLite persistence

---

## Security Notes

- **Site password** is checked client-side (in `sessionStorage`). For higher security, validate it server-side during token issuance.
- **Private keys** are stored in IndexedDB. Clearing browser storage will lose the ability to decrypt old messages.
- **New device login**: generates a new key pair, which means old encrypted messages cannot be decrypted on the new device. This is a trade-off of true E2E encryption without a key backup scheme.
- The `JWT_SECRET` must be a long, random string in production. Use `openssl rand -base64 64` to generate one.

---

## Environment Variables Reference

| Variable | Where | Description |
|---|---|---|
| `PORT` | server | Port to listen on (default: 3001) |
| `JWT_SECRET` | server | Secret for signing JWTs |
| `CLIENT_URL` | server | Frontend URL (for CORS) |
| `DB_PATH` | server | Path to SQLite database file |
| `VITE_API_URL` | client | Backend URL |
| `VITE_SITE_PASSWORD` | client | Site access password |

---

## License

Private use only.
