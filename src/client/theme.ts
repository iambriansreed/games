export type Theme = 'dark' | 'light';

const KEY = 'games_theme';

export function getStoredTheme(): Theme {
    try {
        return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
    } catch {
        return 'dark';
    }
}

export function applyTheme(theme: Theme): void {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f5f7' : '#14161b');
}

export function setTheme(theme: Theme): void {
    try {
        localStorage.setItem(KEY, theme);
    } catch {
        /* ignore */
    }
    applyTheme(theme);
}
