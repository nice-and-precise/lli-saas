import WelcomeContent from "./WelcomeContent";

// The pre-connect first-run panel shown on the dashboard when Monday isn't
// connected yet. Sets expectations before the OAuth handoff.
export default function WelcomePanel({ onConnect }) {
  return (
    <section className="panel connect-panel welcome-panel" aria-label="Get started">
      <WelcomeContent onConnect={onConnect} />
    </section>
  );
}
