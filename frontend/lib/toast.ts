/**
 * Lightweight toast notification utility.
 * Renders a fixed-position toast that auto-dismisses.
 * No external dependencies — pure DOM manipulation.
 */

type ToastVariant = "default" | "success" | "warning" | "error";

interface ToastOptions {
  variant?: ToastVariant;
  duration?: number;
}

const VARIANT_STYLES: Record<ToastVariant, string> = {
  default:
    "background:#18181b;color:#fafafa;",
  success:
    "background:#166534;color:#f0fdf4;",
  warning:
    "background:#854d0e;color:#fefce8;",
  error:
    "background:#991b1b;color:#fef2f2;",
};

let containerEl: HTMLDivElement | null = null;

function getContainer(): HTMLDivElement {
  if (containerEl && document.body.contains(containerEl)) return containerEl;

  containerEl = document.createElement("div");
  containerEl.style.cssText =
    "position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;display:flex;flex-direction:column;gap:0.5rem;pointer-events:none;";
  document.body.appendChild(containerEl);
  return containerEl;
}

export function toast(message: string, options: ToastOptions = {}): void {
  const { variant = "default", duration = 4000 } = options;

  const el = document.createElement("div");
  el.style.cssText = `${VARIANT_STYLES[variant]}padding:0.75rem 1rem;border-radius:0.5rem;font-size:0.875rem;line-height:1.25rem;font-family:system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.15);opacity:0;transform:translateY(0.5rem);transition:opacity 200ms ease,transform 200ms ease;max-width:24rem;pointer-events:auto;`;
  el.textContent = message;

  const container = getContainer();
  container.appendChild(el);

  // Animate in
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateY(0)";
  });

  // Animate out + remove
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(0.5rem)";
    setTimeout(() => el.remove(), 220);
  }, duration);
}
