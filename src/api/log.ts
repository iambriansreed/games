export function logError(source: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[games] ${source}: ${message}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
}

export function log(...args: unknown[]): void {
    console.log('[games]', ...args);
}
