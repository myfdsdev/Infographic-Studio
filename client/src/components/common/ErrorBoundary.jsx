import { Component } from 'react';
import { AlertTriangle, RefreshCw, LayoutDashboard } from 'lucide-react';
import Button from './Button.jsx';
import { ROUTES } from '../../utils/constants.js';

/**
 * Catches a crash while rendering a page so the rest of the app keeps
 * working: the page shows what went wrong with "Try again" instead of the
 * whole screen going blank. `resetKey` (the current path) clears the error
 * when the user moves to another page.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Page crashed', error, info?.componentStack);
  }

  componentDidUpdate(previous) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={this.props.fullPage ? 'iv-crash iv-crash--full' : 'iv-crash'} role="alert">
        <div className="iv-state">
          <div className="iv-state__icon iv-state__icon--danger" aria-hidden="true">
            <AlertTriangle />
          </div>
          <h3 className="iv-state__title">This page hit a problem</h3>
          <p className="iv-state__description">{error.message || 'Something went wrong while showing this page.'}</p>
          <div className="iv-state__action">
            <Button size="sm" icon={RefreshCw} onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
            <Button size="sm" variant="secondary" icon={LayoutDashboard} href={ROUTES.dashboard}>
              Go to dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
