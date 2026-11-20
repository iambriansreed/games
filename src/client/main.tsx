import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setupPWA } from './pwa';
import { applyTheme, getStoredTheme } from './theme';
import { installSfxUnlock } from './sfx';
import './styles.css';

// Apply the saved theme before first paint to avoid a flash.
applyTheme(getStoredTheme());

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);

setupPWA();
// Browsers gate audio behind a user gesture; arm the sound effects on the first tap.
installSfxUnlock();
