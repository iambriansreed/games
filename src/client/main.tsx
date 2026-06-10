import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setupPWA } from './pwa';
import { applyTheme, getStoredTheme } from './theme';
import './styles.css';

// Apply the saved theme before first paint to avoid a flash.
applyTheme(getStoredTheme());

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);

setupPWA();
