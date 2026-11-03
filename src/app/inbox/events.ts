// The ticket pane tells the list when a ticket changed, so the list refreshes at once.
import { useEffect } from "react";

const EVENT = "replypilot:tickets-changed";

export const ticketsChanged = () => window.dispatchEvent(new Event(EVENT));

export function useTicketsChanged(onChange: () => void) {
  useEffect(() => {
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, [onChange]);
}

export async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "The app could not be reached. Check your connection and try again." } };
  }
}
