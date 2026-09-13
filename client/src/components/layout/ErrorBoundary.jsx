import { Component } from 'react';

// Without a boundary, one component throwing while it renders unmounts the entire app to a blank
// page. That happened for real: an AI reply missing its `insights` list was cached for a day and
// crashed the whole dashboard for everyone on that filter. Wrapped around a panel, the failure
// stays inside that panel; wrapped around the app, it at least says what happened.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('[ui] a component failed to render:', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
        Something on this page failed to display. Reload the page to try again.
      </div>
    );
  }
}
