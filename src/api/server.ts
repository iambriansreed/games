import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { api } from './routes';
import { devRouter } from './dev';
import { authConfigured, authRouter, requireAuth } from './auth';
import { initRealtime } from './realtime';
import { log } from './log';

const PORT = Number(process.env.PORT) || 1010;

// The server compiles to dist/server/api/, so the built SPA sits at dist/.
const WEB_DIST = process.env.WEB_DIST || path.resolve(__dirname, '../..');

const app = express();
// Behind Railway's proxy: trust X-Forwarded-* so req.protocol is https
// (needed for the OAuth redirect URI and `secure` cookies).
app.set('trust proxy', 1);
app.use(express.json());

if (!authConfigured) {
    console.warn('[games] GOOGLE_CLIENT_ID/SECRET unset — Google sign-in disabled.');
}

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Public auth endpoints (login redirect, callback, /me, logout).
app.use('/api/auth', authRouter);

// Admin-only dev tools (registered before the general /api router so the more
// specific prefix wins). The router itself enforces the admin-email gate.
app.use('/api/dev', requireAuth, devRouter);

// All other data routes require a session.
app.use('/api', requireAuth, api);

// Serve the built SPA. Content-hashed assets are immutable; the shell and SW
// must always revalidate so new builds are picked up immediately.
app.use(
    express.static(WEB_DIST, {
        setHeaders(res, filePath) {
            const base = path.basename(filePath);
            if (base === 'sw.js' || base === 'index.html' || base.startsWith('workbox-')) {
                res.setHeader('Cache-Control', 'no-cache');
            } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            }
        },
    }),
);

app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(WEB_DIST, 'index.html'));
});

const server = http.createServer(app);
initRealtime(server);

server.listen(PORT, () => {
    log(`listening on :${PORT} — serving SPA from ${WEB_DIST}`);
});
