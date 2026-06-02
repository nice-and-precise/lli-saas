// Shared onboarding copy used by both the in-app pre-connect panel (WelcomePanel)
// and the standalone /welcome page (WelcomePage), so the two never drift.
export default function WelcomeContent({ onConnect, ctaLabel = "Connect Monday" }) {
  return (
    <div className="welcome">
      <p className="eyebrow">Get started</p>
      <h2 className="welcome-title">Welcome to Land Legacy Leads</h2>
      <p className="lede">
        Turn recent Iowa obituaries into inherited-land leads, delivered straight into your
        Monday.com board.
      </p>

      <div className="welcome-cols">
        <div className="welcome-block">
          <h3>You&apos;ll need</h3>
          <ul className="welcome-list">
            <li>
              A <strong>Monday.com</strong> account you can sign in to.
            </li>
            <li>
              Your land owners in Monday, each with a <strong>county</strong> and{" "}
              <strong>state</strong>.
            </li>
            <li>
              This works for <strong>Iowa</strong> land owners — owners outside Iowa won&apos;t
              match obituaries yet.
            </li>
          </ul>
        </div>
        <div className="welcome-block">
          <h3>When you connect, we&apos;ll</h3>
          <ol className="welcome-steps">
            <li>
              <span className="welcome-step-num">1</span> Find the board that holds your owners.
            </li>
            <li>
              <span className="welcome-step-num">2</span> Build a clean “Land Legacy Leads” board.
            </li>
            <li>
              <span className="welcome-step-num">3</span> Let you run your first scan — matched
              leads appear in Monday.
            </li>
          </ol>
        </div>
      </div>

      <p className="welcome-perms subtle">
        We ask Monday for permission to <strong>read your boards</strong> and{" "}
        <strong>create the leads board</strong>. Setup takes about a minute, and you only do it
        once.
      </p>

      {onConnect ? (
        <button type="button" className="primary-action-button welcome-cta" onClick={onConnect}>
          {ctaLabel} →
        </button>
      ) : null}
    </div>
  );
}
