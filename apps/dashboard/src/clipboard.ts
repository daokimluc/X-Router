/**
 * Copy text to the clipboard with a fallback for non-secure contexts.
 *
 * `navigator.clipboard` is only defined in secure contexts (HTTPS or
 * localhost). When the dashboard is opened over plain HTTP on a LAN IP
 * (e.g. http://192.168.x.x:3100) or through a tunnel, `navigator.clipboard`
 * is `undefined` and accessing `.writeText` throws
 * "Cannot read properties of undefined (reading 'writeText')".
 *
 * This helper prefers the async Clipboard API when available and falls back
 * to a hidden `<textarea>` + `document.execCommand('copy')` otherwise.
 * Returns true on success, false on failure (never throws).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }

  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    // Keep it out of view and out of the layout/scroll flow.
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
