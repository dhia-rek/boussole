import {
  getAuthBootstrapStatus,
  hasAuthenticatedSession,
  restoreAuthSessionFromLegacyCredentials,
  setupFirstAdmin,
  signInWithCredentials,
} from "@client/api";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  loadRememberedAuthUsers,
  rememberAuthUser,
} from "../lib/remembered-auth-users";

function resolveNextPath(rawNext: string | null): string {
  if (!rawNext || !rawNext.startsWith("/")) return "/jobs/ready";
  if (rawNext === "/sign-in" || rawNext.startsWith("/sign-in?")) {
    return "/jobs/ready";
  }
  return rawNext;
}

export function SignInPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);
  const [isBusy, setIsBusy] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rememberedUsers, setRememberedUsers] = useState(() =>
    loadRememberedAuthUsers(),
  );

  const nextPath = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return resolveNextPath(params.get("next"));
  }, [location.search]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const rememberedUsername = params.get("user")?.trim();
    if (rememberedUsername) {
      setUsername(rememberedUsername);
      setPassword("");
    }
  }, [location.search]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const bootstrap = await getAuthBootstrapStatus();
        if (cancelled) return;
        setSetupRequired(bootstrap.setupRequired);
        if (bootstrap.setupRequired) return;
        const restored = await restoreAuthSessionFromLegacyCredentials();
        if (cancelled) return;
        if (restored || hasAuthenticatedSession()) {
          navigate(nextPath, { replace: true });
          return;
        }
      } finally {
        if (!cancelled) setIsBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, nextPath]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password) {
      setErrorMessage("Enter both username and password.");
      return;
    }
    setIsBusy(true);
    setErrorMessage(null);
    try {
      if (setupRequired) {
        const user = await setupFirstAdmin({
          username: normalizedUsername,
          password,
          displayName: displayName.trim() || normalizedUsername,
        });
        setRememberedUsers(
          rememberAuthUser({
            username: user.username,
            displayName: user.displayName,
          }),
        );
      } else {
        await signInWithCredentials(normalizedUsername, password);
        setRememberedUsers(rememberAuthUser({ username: normalizedUsername }));
      }
      navigate(nextPath, { replace: true });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to sign in",
      );
      setIsBusy(false);
    }
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        width: "100%",
        overflow: "hidden",
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-bg)",
      }}
    >
      {/* Ambient orbs */}
      <div
        className="orb orb-blue"
        style={{
          width: 600,
          height: 600,
          top: "-15%",
          right: "-10%",
          opacity: 0.6,
        }}
      />
      <div
        className="orb orb-purple"
        style={{
          width: 500,
          height: 500,
          bottom: "-10%",
          left: "-8%",
          opacity: 0.5,
        }}
      />
      <div
        className="orb orb-teal"
        style={{
          width: 350,
          height: 350,
          top: "40%",
          left: "60%",
          opacity: 0.4,
        }}
      />

      {/* Glass card */}
      <div
        className="card-glass animate-scale-in"
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 420,
          margin: "24px",
          padding: "48px 40px",
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 64,
              height: 64,
              borderRadius: 18,
              background: "linear-gradient(145deg, #1a1a1a 0%, #2d2d2d 100%)",
              boxShadow:
                "0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)",
              color: "#fff",
              marginBottom: 20,
            }}
          >
            <img src="/favicon.svg" alt="Forsa logo" width={40} height={40} />
          </div>

          <h1
            style={{
              fontSize: "2rem",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              color: "var(--color-text)",
              marginBottom: 6,
            }}
          >
            Forsa
          </h1>
          <p
            style={{
              fontSize: "0.9375rem",
              color: "var(--color-text-secondary)",
              margin: 0,
            }}
          >
            {setupRequired ? "Create your workspace" : "Sign in to continue"}
          </p>
        </div>

        {/* Remembered users */}
        {!setupRequired && rememberedUsers.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <p
              style={{
                fontSize: "0.7rem",
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--color-text-tertiary)",
                marginBottom: 10,
              }}
            >
              Quick access
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rememberedUsers.map((user) => (
                <button
                  key={user.username}
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    setUsername(user.username);
                    setPassword("");
                    setErrorMessage(null);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 16px",
                    borderRadius: 12,
                    border: `1.5px solid ${username.trim() === user.username ? "var(--color-primary)" : "var(--color-border)"}`,
                    background:
                      username.trim() === user.username
                        ? "rgba(0,113,227,0.08)"
                        : "var(--color-surface-secondary)",
                    cursor: isBusy ? "not-allowed" : "pointer",
                    opacity: isBusy ? 0.5 : 1,
                    textAlign: "left",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: "50%",
                      background: "linear-gradient(135deg, #0071e3, #34aadc)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontSize: "0.875rem",
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {(user.displayName ?? user.username)
                      .charAt(0)
                      .toUpperCase()}
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: "0.875rem",
                        fontWeight: 600,
                        color: "var(--color-text)",
                      }}
                    >
                      {user.displayName ?? user.username}
                    </div>
                    {user.displayName && (
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "var(--color-text-tertiary)",
                        }}
                      >
                        {user.username}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
        >
          {setupRequired && (
            <div>
              <label
                htmlFor="auth-display-name"
                style={{
                  display: "block",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  color: "var(--color-text)",
                  marginBottom: 7,
                }}
              >
                Full Name
              </label>
              <input
                id="auth-display-name"
                className="input-apple"
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.currentTarget.value)}
                placeholder="Your full name"
                disabled={isBusy}
              />
            </div>
          )}

          <div>
            <label
              htmlFor="auth-username"
              style={{
                display: "block",
                fontSize: "0.8125rem",
                fontWeight: 600,
                color: "var(--color-text)",
                marginBottom: 7,
              }}
            >
              Username
            </label>
            <input
              id="auth-username"
              className="input-apple"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.currentTarget.value)}
              placeholder="Enter username"
              disabled={isBusy}
            />
          </div>

          <div>
            <label
              htmlFor="auth-password"
              style={{
                display: "block",
                fontSize: "0.8125rem",
                fontWeight: 600,
                color: "var(--color-text)",
                marginBottom: 7,
              }}
            >
              Password
            </label>
            <input
              id="auth-password"
              className="input-apple"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              placeholder="Enter password"
              disabled={isBusy}
            />
          </div>

          {errorMessage && (
            <div
              role="alert"
              style={{
                padding: "12px 16px",
                borderRadius: 10,
                background: "rgba(255,69,58,0.1)",
                border: "1px solid rgba(255,69,58,0.2)",
                color: "var(--color-error)",
                fontSize: "0.875rem",
              }}
            >
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            className="btn-apple btn-primary btn-full"
            disabled={isBusy}
            style={{ marginTop: 4 }}
          >
            {isBusy
              ? setupRequired
                ? "Setting up…"
                : "Signing in…"
              : setupRequired
                ? "Create workspace"
                : "Sign in"}
          </button>
        </form>

        <p
          style={{
            marginTop: 24,
            textAlign: "center",
            fontSize: "0.8125rem",
            color: "var(--color-text-tertiary)",
          }}
        >
          {setupRequired
            ? "This creates the first admin account"
            : "Your personal job search workspace"}
        </p>
      </div>
    </main>
  );
}
