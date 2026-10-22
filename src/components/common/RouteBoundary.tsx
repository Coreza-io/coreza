import { Component, Suspense, type ReactNode } from "react";

class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div role="alert" className="p-6 text-sm">This page could not load. <button className="underline" onClick={() => window.location.reload()}>Reload page</button></div> : this.props.children;
  }
}
export function RouteBoundary({ children }: { children: ReactNode }) {
  return <RouteErrorBoundary><Suspense fallback={<div role="status" className="p-6 text-sm text-muted-foreground">Loading…</div>}>{children}</Suspense></RouteErrorBoundary>;
}
