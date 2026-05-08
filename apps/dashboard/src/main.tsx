import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

if (window.spilledNative?.kind === "native") {
  document.documentElement.classList.add("native-shell");
  document.body.classList.add("native-shell");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .getRegistrations()
      .then(async (registrations) => {
        if (registrations.length === 0) {
          return;
        }

        await Promise.all(registrations.map((registration) => registration.unregister()));
      })
      .catch(() => {
        // Ignore service worker cleanup failures and keep app startup resilient.
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
