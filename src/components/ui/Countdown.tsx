"use client";

import { useEffect, useState } from "react";

/** "23 h 12 min left", counting down to an instant; "Expired" afterwards. */
export function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // Set after mount so the server render and the first client render agree.
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);

  if (now === null) return <span className="text-muted">…</span>;
  const minutes = Math.floor((Date.parse(until) - now) / 60_000);
  if (minutes <= 0) return <span className="font-semibold text-destructive">Expired</span>;
  const hours = Math.floor(minutes / 60);
  return (
    <span className="font-semibold">
      {hours > 0 ? `${hours} h ` : ""}
      {minutes % 60} min left
    </span>
  );
}
