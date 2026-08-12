import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

// App version, injected into the client as __APP_VERSION__.
const APP_VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
    .version as string;

const DEV_API_TARGET = process.env.GAMES_DEV_API || 'http://localhost:1010';

export default defineConfig({
    define: {
        __APP_VERSION__: JSON.stringify(APP_VERSION),
    },
    plugins: [
        react(),
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
                navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/],
                runtimeCaching: [
                    {
                        urlPattern: ({ url }) =>
                            url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/'),
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
        allowedHosts: ['local.games.iambrian.com'],
        host: '127.0.0.1',
        port: 4567,
        proxy: {
            '/api': { target: DEV_API_TARGET, changeOrigin: true },
            '/socket.io': { target: DEV_API_TARGET, changeOrigin: true, ws: true },
        },
    },
});
