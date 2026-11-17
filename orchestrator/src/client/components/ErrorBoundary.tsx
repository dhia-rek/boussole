import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("[ErrorBoundary]", error, info.componentStack);
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center"
          style={{ background: "var(--color-bg)" }}
        >
          <p className="text-lg font-semibold text-foreground">
            Something went wrong
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {this.state.error.message}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-sm text-primary underline underline-offset-4"
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
