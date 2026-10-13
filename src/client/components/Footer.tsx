/** The credit at the bottom of every screen but the game board. */
export function Footer() {
    return (
        <footer className="site-footer">
            Made with{' '}
            <svg className="heart" viewBox="0 0 24 24" role="img" aria-label="love">
                <path d="M12 21s-7.5-4.6-9.8-9.2C.6 8.6 2.4 4.5 6.3 4.5c2.3 0 3.9 1.3 5.7 3.4 1.8-2.1 3.4-3.4 5.7-3.4 3.9 0 5.7 4.1 4.1 7.3C19.5 16.4 12 21 12 21z" />
            </svg>{' '}
            by{' '}
            <a href="https://iambrian.com" target="_blank" rel="noopener">
                Brian
            </a>
        </footer>
    );
}
