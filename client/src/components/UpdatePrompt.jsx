import { useRegisterSW } from 'virtual:pwa-register/react';

// A deployed build ships a new service worker, but an already-open tab only
// looks for it on navigation — so someone who leaves the app open (e.g. during
// a race) can sit on a stale version indefinitely. This component polls for a
// newer build and surfaces a reload prompt so users pull in changes.

const UPDATE_CHECK_INTERVAL_MS = 60 * 1000;

// Set true to reload the instant a new build is detected (silent force-refresh)
// instead of prompting. Left false so a reload never interrupts a user
// mid-prediction — they choose when to reload.
const AUTO_RELOAD = false;

export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const check = () => {
        // update() hits the network for the SW script; skip it when offline.
        if (navigator.onLine) registration.update();
      };
      // Poll on an interval and whenever the tab regains focus, so a long-lived
      // open tab still notices a new deploy promptly.
      setInterval(check, UPDATE_CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
    onNeedRefresh() {
      if (AUTO_RELOAD) updateServiceWorker(true);
    },
  });

  if (!needRefresh) return null;

  // updateServiceWorker(true) activates the waiting worker and reloads the page.
  return (
    <div className="update-toast" role="alert" aria-live="polite">
      <span className="update-toast-text">A new version is available.</span>
      <div className="update-toast-actions">
        <button className="btn btn-primary" onClick={() => updateServiceWorker(true)}>
          Reload
        </button>
        <button className="btn btn-ghost" onClick={() => setNeedRefresh(false)}>
          Later
        </button>
      </div>
    </div>
  );
}
