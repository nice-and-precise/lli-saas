import { Link } from "react-router-dom";

export default function LoginPage() {
  return (
    <main className="page auth-page">
      <section className="panel hero">
        <p className="eyebrow">Phase 1 pilot</p>
        <h1>Broker access starts here.</h1>
        <p className="lede">
          Connect Monday, launch the first scan, and verify delivery without waiting
          on the full production portal.
        </p>
      </section>
      <section className="panel form-panel">
        <h2>Login</h2>
        <form className="auth-form">
          <label>
            Email
            <input type="email" placeholder="david@example.com" />
          </label>
          <label>
            Password
            <input type="password" placeholder="••••••••" />
          </label>
          <button type="button">Continue to dashboard</button>
        </form>
        <p className="subtle">
          Phase 1 uses a local session stub. Proceed to the <Link to="/dashboard">dashboard</Link>.
        </p>
      </section>
    </main>
  );
}

