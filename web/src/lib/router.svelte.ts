// Tiny module-scoped router. Beats prop-drilling `navigate` through every
// component that wants to link somewhere. Only the path is reactive — match
// it against route patterns inside derived/effect blocks.

export const router: { path: string } = $state({
  path: typeof window === "undefined" ? "/" : window.location.pathname,
});

export function navigate(to: string): void {
  if (typeof window === "undefined") return;
  if (to === window.location.pathname) return;
  window.history.pushState({}, "", to);
  router.path = to;
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    router.path = window.location.pathname;
  });
}

// Helper for anchor tags so they participate in client-side routing while
// still rendering as real <a href> for accessibility / right-click / new-tab.
export function onLinkClick(to: string) {
  return (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // let the browser handle
    if (e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
}
