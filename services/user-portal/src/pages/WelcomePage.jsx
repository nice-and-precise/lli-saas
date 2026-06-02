import WelcomeContent from "../components/WelcomeContent";
import { resolveServiceBaseUrl } from "../runtimeConfig";

// Shareable getting-started page (route /welcome). Jordan can send this link to a
// new broker before they log in. The CTA starts the Monday connection directly.
export default function WelcomePage() {
  const startConnect = () => {
    const crmBaseUrl = resolveServiceBaseUrl("crmAdapterBaseUrl");
    window.location.href = crmBaseUrl ? `${crmBaseUrl}/auth/login` : "/dashboard";
  };

  return (
    <main className="page welcome-page" aria-label="Getting started">
      <section className="panel hero">
        <WelcomeContent onConnect={startConnect} ctaLabel="Get started — Connect Monday" />
      </section>
      <section className="panel">
        <h3>What to expect</h3>
        <ul className="welcome-list">
          <li>
            Matched leads land as items on your <strong>Land Legacy Leads</strong> Monday board —
            each scored and tiered, with a link back to the obituary.
          </li>
          <li>
            After your first scan, we re-scan <strong>automatically every day</strong>, so new
            leads keep arriving with no action from you.
          </li>
          <li>
            A run with no new leads usually just means no new Iowa obituaries matched your owners
            that week — it&apos;s not an error.
          </li>
        </ul>
        <p className="subtle">Questions? Just reply to the email that sent you here.</p>
      </section>
    </main>
  );
}
