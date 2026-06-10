import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';

// App version, injected into the client as __APP_VERSION__.
const APP_VERSION = JSON.parse(
    readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version as string;

// In dev, /api and /socket.io are proxied to the Express server on this target.
const DEV_API_TARGET = process.env.GAMES_DEV_API || 'http://localhost:1010';

// The dev domain (served over HTTPS by Caddy → Vite). Maps to 127.0.0.1 via
// /etc/hosts. Prod is games.iambrian.com (served by the Express app directly).
const DEV_HOST = 'local.games.iambrian.com';

// Run Caddy in front of Vite so https://local.games.iambrian.com works with a
// locally-trusted (mkcert) cert — see ./Caddyfile. Caddy terminates TLS on 443
// and reverse-proxies to Vite, forwarding WebSocket upgrades (HMR + socket.io).
// Binding 443 needs root, so caddy runs via `sudo -n` (no prompt): cache creds
// with `sudo -v` first, or add a passwordless sudoers rule. Run `npm run cert`
// once first. Set CADDY_PROXY=0 to skip and use http://127.0.0.1:4567 directly.
const CADDY_BIN = process.env.CADDY_BIN || '/opt/homebrew/bin/caddy';

// Tell a running Caddy to shut down via its admin API (localhost:2019). This
// works as a non-root user, so we never have to signal Caddy's root process —
// which a non-root Vite cannot do, and which used to leak orphaned instances.
function stopCaddy(): void {
    try {
        spawnSync(CADDY_BIN, ['stop'], { stdio: 'ignore', timeout: 5000 });
    } catch {}
}

function caddyProxy(): PluginOption {
    let proc: ChildProcess | undefined;
    let stopped = false;
    const stop = () => {
        if (stopped) return;
        stopped = true;
        stopCaddy();
        if (proc?.pid) try { process.kill(-proc.pid, 'SIGTERM'); } catch {}
        proc = undefined;
    };
    return {
        name: 'caddy-proxy',
        apply: 'serve',
        configureServer(server) {
            const log = server.config.logger;
            server.httpServer?.once('listening', () => {
                stopCaddy(); // clear any leftover instance before starting a fresh one
                proc = spawn('sudo', ['-n', CADDY_BIN, 'run', '--config', 'Caddyfile'], {
                    stdio: 'inherit',
                    detached: true,
                });
                proc.on('error', (e) => log.error(`[caddy] ${e.message}`));
                proc.on('exit', (code) => {
                    if (code && code !== 0) {
                        log.error(
                            `\n[caddy] failed to start (exit ${code}). Caddy needs root to bind :443.\n` +
                                `        Run  sudo -v  before \`npm run dev\`, or allow passwordless sudo for caddy:\n` +
                                `        echo "$(whoami) ALL=(root) NOPASSWD: ${CADDY_BIN}" | sudo tee /etc/sudoers.d/games-caddy\n` +
                                `        (or set CADDY_PROXY=0 to run Vite only on http://127.0.0.1:4567)\n`,
                        );
                    }
                });
                log.info(`  ➜  App:     https://${DEV_HOST}  (Caddy TLS → Vite)`);
            });
            server.httpServer?.once('close', stop);
            process.once('SIGINT', stop);
            process.once('SIGTERM', stop);
            process.once('exit', stop);
        },
    };
}

export default defineConfig({
    define: {
        __APP_VERSION__: JSON.stringify(APP_VERSION),
    },
    plugins: [
        react(),
        process.env.CADDY_PROXY !== '0' && caddyProxy(),
        VitePWA({
            registerType: 'autoUpdate',
            injectRegister: null,
            includeAssets: ['icon.svg'],
            manifest: {
                id: '/',
                scope: '/',
                name: 'Games — Board Games',
                short_name: 'Games',
                description: 'Play multiplayer board games like Splendor with friends.',
                theme_color: '#14161b',
                background_color: '#07080a',
                display: 'standalone',
                orientation: 'portrait',
                start_url: '/',
                icons: [
                    { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
                    { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
                ],
            },
            workbox: {
                navigateFallback: '/index.html',
                // Server routes must reach the backend, not the cached SPA shell.
                navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/],
                runtimeCaching: [
                    {
                        urlPattern: ({ url }) =>
                            url.pathname.startsWith('/api/') &&
                            !url.pathname.startsWith('/api/auth/'),
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'games-api',
                            expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 },
                        },
                    },
                ],
            },
        }),
    ],
    server: {
        host: '127.0.0.1',
        port: 4567,
        allowedHosts: [DEV_HOST],
        // The browser reaches us via https://local.games.iambrian.com (Caddy on
        // 443); point the HMR websocket there so it goes back through Caddy.
        hmr: { host: DEV_HOST, protocol: 'wss', clientPort: 443 },
        proxy: {
            '/api': { target: DEV_API_TARGET, changeOrigin: true },
            '/socket.io': { target: DEV_API_TARGET, changeOrigin: true, ws: true },
        },
    },
});
