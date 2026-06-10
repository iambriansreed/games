import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { store } from './store';
import { logError } from './log';
import { User } from './types';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

/** PWA-friendly long session: 90 days, slid forward on use. */
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

const SESSION_COOKIE = 'games_session';
const STATE_COOKIE = 'games_oauth_state';

const ALLOWED_EMAILS = new Set(
    (process.env.GAMES_ALLOWED_EMAILS || '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
);

/** The single account that unlocks admin-only features (dev tools, etc.). */
const ADMIN_EMAIL = (process.env.GAMES_ADMIN_EMAIL || '').trim().toLowerCase();

export function isAdmin(user: { email: string }): boolean {
    return ADMIN_EMAIL.length > 0 && user.email.toLowerCase() === ADMIN_EMAIL;
}

export const authConfigured = Boolean(CLIENT_ID && CLIENT_SECRET);

function isProd(): boolean {
    return process.env.NODE_ENV === 'production';
}

function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

export function parseCookies(header: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!header) return out;
    for (const part of header.split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        const k = part.slice(0, i).trim();
        const v = part.slice(i + 1).trim();
        if (k) out[k] = decodeURIComponent(v);
    }
    return out;
}

function redirectUri(req: Request): string {
    if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
    return `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
}

function oauthClient(req: Request): OAuth2Client {
    return new OAuth2Client(CLIENT_ID, CLIENT_SECRET, redirectUri(req));
}

function cookieOpts(maxAgeMs: number) {
    return {
        httpOnly: true,
        secure: isProd(),
        sameSite: 'lax' as const,
        path: '/',
        maxAge: maxAgeMs,
    };
}

async function startSession(res: Response, user: User): Promise<void> {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await store().createSession(hashToken(token), user.id, expiresAt);
    res.cookie(SESSION_COOKIE, token, cookieOpts(SESSION_TTL_MS));
}

export async function resolveUser(
    req: { headers: { cookie?: string } },
    res?: Response,
): Promise<User | null> {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    const tokenHash = hashToken(token);
    const session = await store().getSession(tokenHash);
    if (!session) return null;

    const remaining = new Date(session.expires_at).getTime() - Date.now();
    if (res && remaining < SESSION_TTL_MS - SESSION_REFRESH_AFTER_MS) {
        const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
        await store().touchSession(tokenHash, expiresAt);
        res.cookie(SESSION_COOKIE, token, cookieOpts(SESSION_TTL_MS));
    }
    return session.user;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
    const user = await resolveUser(req, res);
    if (!user) return res.status(401).json({ error: 'unauthenticated' });
    req.user = user;
    next();
}

export const authRouter = Router();

authRouter.get('/google', (req: Request, res: Response) => {
    if (!authConfigured) return res.status(503).send('Google sign-in is not configured.');
    const state = crypto.randomBytes(16).toString('base64url');
    res.cookie(STATE_COOKIE, state, cookieOpts(10 * 60 * 1000));
    const url = oauthClient(req).generateAuthUrl({
        access_type: 'online',
        scope: ['openid', 'email', 'profile'],
        state,
        prompt: 'select_account',
    });
    res.redirect(url);
});

authRouter.get('/google/callback', async (req: Request, res: Response) => {
    try {
        const { code, state } = req.query as { code?: string; state?: string };
        const expectedState = parseCookies(req.headers.cookie)[STATE_COOKIE];
        res.clearCookie(STATE_COOKIE, { path: '/' });
        if (!code || !state || !expectedState || state !== expectedState) {
            return res.redirect('/?error=auth_state');
        }

        const client = oauthClient(req);
        const { tokens } = await client.getToken(code);
        if (!tokens.id_token) return res.redirect('/?error=auth_failed');

        const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: CLIENT_ID });
        const payload = ticket.getPayload();
        if (!payload?.sub || !payload.email || !payload.email_verified) {
            return res.redirect('/?error=auth_unverified');
        }

        const email = payload.email.toLowerCase();
        if (ALLOWED_EMAILS.size > 0 && !ALLOWED_EMAILS.has(email)) {
            return res.redirect('/?error=access_denied');
        }

        const user = await store().upsertUser({
            sub: payload.sub,
            email,
            name: payload.name ?? null,
            picture: payload.picture ?? null,
        });
        await startSession(res, user);
        res.redirect('/');
    } catch (err) {
        logError('auth.callback', err);
        res.redirect('/?error=auth_failed');
    }
});

authRouter.get('/me', async (req: Request, res: Response) => {
    const user = await resolveUser(req, res);
    if (!user) return res.status(401).json({ error: 'unauthenticated' });
    res.json({ user: publicUser(user), isAdmin: isAdmin(user) });
});

authRouter.post('/logout', async (req: Request, res: Response) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await store().deleteSession(hashToken(token));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
});

export function publicUser(user: User) {
    return { id: user.id, name: user.name, email: user.email, picture: user.picture };
}
