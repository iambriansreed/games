import { registerSW } from 'virtual:pwa-register';

/** Register the service worker (autoUpdate) and re-check when the app resumes. */
export function setupPWA(): void {
    const updateSW = registerSW({ immediate: true });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void updateSW();
    });
}
