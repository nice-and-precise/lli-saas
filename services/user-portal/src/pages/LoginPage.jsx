import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { getRequiredServiceBaseUrl } from "../runtimeConfig";
import { setAccessToken } from "../session";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const crmAdapterBaseUrl = getRequiredServiceBaseUrl("crmAdapterBaseUrl");
      const response = await fetch(`${crmAdapterBaseUrl}/session/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Login failed");
      }

      setAccessToken(payload.access_token);
      navigate("/dashboard");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page auth-page">
      <section className="panel hero">
        <p className="eyebrow">MVP operator access</p>
        <h1>Broker access starts here.</h1>
        <p className="lede">
          Connect Monday, keep the customer CRM as the owner-data source of truth, and launch
          obituary intelligence scans without maintaining a separate owner database.
        </p>
      </section>
      <section className="panel form-panel">
        <h2>Login</h2>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Email
            <input
              type="email"
              placeholder="david@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button type="submit" disabled={submitting}>
            {submitting ? "Signing in..." : "Continue to dashboard"}
          </button>
        </form>
        {error ? <p className="subtle">{error}</p> : null}
        <p className="subtle">
          Pilot operator access now issues a bearer token through <code>/session/login</code>. After
          sign-in, continue to the <Link to="/dashboard">dashboard</Link>.
        </p>
      </section>
    </main>
  );
}
