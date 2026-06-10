// Admin-only dev tools. Mounted behind requireAuth + an admin-email gate, so
// nothing here is reachable unless the signed-in user is GAMES_ADMIN_EMAIL.

import { Router, type NextFunction, type Request, type Response } from 'express';
import { store } from './store';
import { isAdmin } from './auth';
import { buildDetail } from './serialize';
import { emitLobby } from './realtime';
import { logError } from './log';
import { getScenario } from '../shared/splendor/dev';
import { SPLENDOR_MAX_PLAYERS, SPLENDOR_MIN_PLAYERS } from '../shared/splendor/engine';
import { User } from './types';

// A stable synthetic opponent so scenario games have someone to sit across from.
const BOT_PROFILE = {
    sub: 'dev-bot-splendor',
    email: 'dev-bot@games.local',
    name: 'Dev Bot',
    picture: null,
};

export const devRouter = Router();

devRouter.use((req: Request, res: Response, next: NextFunction) => {
    if (!isAdmin(req.user as User)) return res.status(403).json({ error: 'Admins only' });
    next();
});

devRouter.post('/splendor/:scenario', async (req: Request, res: Response) => {
    try {
        const admin = req.user as User;
        const scenario = getScenario(req.params.scenario);
        if (!scenario) return res.status(404).json({ error: 'Unknown scenario' });

        const bot = await store().upsertUser(BOT_PROFILE);
        const userForRole = { admin: admin.id, bot: bot.id };

        const game = await store().createGame({
            type: 'splendor',
            name: `DEV — ${scenario.label}`,
            visibility: 'private',
            hostId: admin.id,
            minPlayers: SPLENDOR_MIN_PLAYERS,
            maxPlayers: SPLENDOR_MAX_PLAYERS,
        });

        // addPlayer assigns seats 0,1,… in call order, so this fixes who sits where.
        for (const role of scenario.seats) {
            await store().addPlayer(game.id, userForRole[role]);
        }

        const players = await store().getPlayers(game.id);
        const orderedIds = players
            .slice()
            .sort((a, b) => a.seat - b.seat)
            .map((p) => p.user_id);
        const state = scenario.build(orderedIds, new Date().toISOString());
        await store().updateGame(game.id, { state, status: 'active' });

        const fresh = await store().getGame(game.id);
        emitLobby();
        res.json(buildDetail(fresh!, players, admin.id));
    } catch (err) {
        logError('dev.splendor', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load scenario' });
    }
});
