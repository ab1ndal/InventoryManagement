import React from "react";
import { useLocation } from "react-router-dom";

// Without a boundary, one failed render blanks the whole app.
//
// lazyWithReload is unaffected: its first failure reloads the page and suspends without throwing, so only
// a failure after that reload arrives here.
class Boundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("RouteErrorBoundary: page failed to render", {
      path: window.location.pathname,
      error,
      componentStack: info.componentStack,
    });
  }

  // A prop rather than a React key: a key would remount the page on every link, and some routes share a
  // page that keeps its state between URLs (Online Orders).
  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="min-h-[50vh] flex flex-col items-center justify-center px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-semibold text-storefront-charcoal mb-2">
          Something went wrong
        </h1>
        <p className="font-sans text-sm text-storefront-muted mb-6">
          This page did not load properly. Please reload to try again.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-storefront-charcoal text-storefront-cream font-sans text-[11px] font-medium tracking-widest uppercase px-8 py-3 hover:bg-storefront-warm transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-storefront-gold focus-visible:ring-offset-2"
        >
          Reload page
        </button>
      </div>
    );
  }
}

export default function RouteErrorBoundary({ children }) {
  const { pathname } = useLocation();
  return <Boundary resetKey={pathname}>{children}</Boundary>;
}
