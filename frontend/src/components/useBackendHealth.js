"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/services/apiClient";

/**
 * Measured backend reachability. "online" means the backend answered
 * GET /api/health within the timeout — nothing more. Camera and controller
 * status are not measured because they are not integrated.
 */
export function useBackendHealth(intervalMs = 15000) {
  const [state, setState] = useState({ status: "checking", checkedAt: null, message: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let controller = null;
    const run = () => {
      controller = new AbortController();
      api.health(controller.signal)
        .then(() => { if (!cancelled) setState({ status: "online", checkedAt: new Date(), message: null }); })
        .catch((err) => {
          if (cancelled || err.cancelled) return;
          setState({ status: "offline", checkedAt: new Date(), message: err.message });
        });
    };
    const first = setTimeout(run, 0);
    const timer = setInterval(run, intervalMs);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
      if (controller) controller.abort();
    };
  }, [intervalMs, tick]);

  const retry = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, retry };
}
