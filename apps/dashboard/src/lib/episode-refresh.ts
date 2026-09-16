/** One timer, no hidden/offline polling, and a cooldown shared by wake-up events. */
export function scheduleEpisodeRefresh(run: () => Promise<boolean>, intervalMs = 120_000) {
  let stopped = false;
  let running = false;
  let nextCheck = 0;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    if (stopped || running || document.visibilityState === "hidden" || !navigator.onLine) return;
    timer = setTimeout(() => void poll(), Math.max(0, nextCheck - Date.now()));
  };
  const poll = async () => {
    if (stopped || running || document.visibilityState === "hidden" || !navigator.onLine) return;
    running = true;
    try {
      failures = await run() ? 0 : failures + 1;
    } catch {
      failures += 1;
    } finally {
      running = false;
      nextCheck = Date.now() + (failures ? Math.min(300_000, 30_000 * 2 ** (failures - 1)) : intervalMs);
      schedule();
    }
  };
  window.addEventListener("focus", schedule);
  window.addEventListener("online", schedule);
  window.addEventListener("offline", schedule);
  document.addEventListener("visibilitychange", schedule);
  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
    window.removeEventListener("focus", schedule);
    window.removeEventListener("online", schedule);
    window.removeEventListener("offline", schedule);
    document.removeEventListener("visibilitychange", schedule);
  };
}
