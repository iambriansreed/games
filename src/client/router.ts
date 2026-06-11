import { useEffect, useState } from 'react';

export type Route =
    | { view: 'lobby' }
    | { view: 'settings' }
    | { view: 'game'; id: string }
    | { view: 'join'; code: string }
    | { view: 'dev-animations' };

function parse(pathname: string): Route {
    const g = pathname.match(/^\/g\/([^/]+)/);
    if (g) return { view: 'game', id: g[1] };
    const j = pathname.match(/^\/join\/([^/]+)/);
    if (j) return { view: 'join', code: j[1] };
    if (pathname === '/settings') return { view: 'settings' };
    if (pathname === '/dev/animations') return { view: 'dev-animations' };
    return { view: 'lobby' };
}

export function navigate(path: string): void {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
    const [route, setRoute] = useState<Route>(() => parse(window.location.pathname));
    useEffect(() => {
        const onPop = () => setRoute(parse(window.location.pathname));
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);
    return route;
}
