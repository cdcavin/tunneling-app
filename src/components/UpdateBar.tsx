import { useRegisterSW } from "virtual:pwa-register/react";

/** Shows when a new version has been deployed. Reload swaps to it; checks for updates every 15 minutes while open. */
export default function UpdateBar() {
  const { needRefresh: [need, setNeed], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (reg) setInterval(() => { void reg.update(); }, 15 * 60 * 1000);
    },
  });
  if (!need) return null;
  return (
    <div className="update-bar" role="status">
      <span>Update available</span>
      <button type="button" className="update-go" onClick={() => void updateServiceWorker(true)}>Reload</button>
      <button type="button" className="ghost" onClick={() => setNeed(false)} aria-label="Later">Later</button>
    </div>
  );
}
