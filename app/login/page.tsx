"use client";

import { useState } from "react";

const CSS = `
  .lgn {
    --gold: #C8952A; --gold-border: rgba(200,149,42,0.28);
    --bg: #0A0806; --surface: #121009; --border: #28200F;
    --text: #F0E8D8; --muted: #8A7A60; --red: #C0543A;
    font-family: 'Figtree', sans-serif; background: var(--bg); color: var(--text);
    min-height: 100%; display: flex; align-items: center; justify-content: center;
    padding: 1rem;
  }
  .lgn-card {
    width: 100%; max-width: 360px; background: var(--surface);
    border: 1px solid var(--border); border-radius: 14px; padding: 1.5rem 1.25rem;
  }
  .lgn-title { font-family: 'Cormorant Garamond', serif; font-size: 2rem; margin: 0 0 1.25rem; }
  .lgn-input {
    font: inherit; font-size: 1rem; width: 100%; min-height: 44px; color: var(--text);
    background: var(--bg); border: 1px solid var(--gold-border); border-radius: 8px;
    padding: 0.65rem 0.75rem; margin-bottom: 0.9rem;
  }
  .lgn-input:focus-visible { outline: 2px solid var(--gold); outline-offset: 1px; }
  .lgn-btn {
    font: inherit; font-weight: 600; width: 100%; min-height: 44px; cursor: pointer;
    background: var(--gold); color: #0A0806; border: 0; border-radius: 10px;
  }
  .lgn-btn:disabled { opacity: 0.6; cursor: default; }
  .lgn-error { color: #E8A090; font-size: 0.88rem; margin: 0 0 0.9rem; }
`;

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      const next = new URLSearchParams(window.location.search).get("next");
      // Only follow same-site paths.
      window.location.assign(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
      return;
    }
    setBusy(false);
    setError(
      res.status === 401 ? "That password is wrong." : "Couldn't sign in. Try again."
    );
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="lgn flex-1">
        <form className="lgn-card" onSubmit={submit}>
          <h1 className="lgn-title">Budget</h1>
          <input
            className="lgn-input"
            type="password"
            aria-label="Password"
            placeholder="Password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="lgn-error" role="alert">{error}</p>}
          <button className="lgn-btn" disabled={busy || !password}>
            Sign in
          </button>
        </form>
      </div>
    </>
  );
}
