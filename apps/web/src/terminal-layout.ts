/** Keep xterm's cell grid inside its viewport when the frame or web fonts change. */
export function observeTerminalLayout(host: HTMLElement, fit: () => void): () => void {
  let active = true;
  const run = () => {
    if (!active) return;
    try { fit(); } catch { /* the terminal may be between mount and dispose */ }
  };

  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(run);
  observer?.observe(host);
  window.addEventListener("resize", run);
  requestAnimationFrame(run);
  if (document.fonts) void document.fonts.ready.then(run);

  return () => {
    active = false;
    observer?.disconnect();
    window.removeEventListener("resize", run);
  };
}
