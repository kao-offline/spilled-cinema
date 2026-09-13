export type ToastTone = "error" | "success" | "info";

export const TOAST_EVENT = "spilled:toast";

export function showToast(message: string, tone: ToastTone = "error") {
  if (typeof window === "undefined" || !message.trim()) return;
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { message, tone } }));
}
