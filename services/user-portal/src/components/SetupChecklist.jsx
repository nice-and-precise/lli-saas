function StepRow({ done, current, children }) {
  const state = done ? "is-done" : current ? "is-current" : "is-todo";
  return (
    <li className={`checklist-step ${state}`}>
      <span className="checklist-mark" aria-hidden="true">
        {done ? "✓" : current ? "▶" : "○"}
      </span>
      <span className="checklist-label">{children}</span>
    </li>
  );
}

// First-run activation checklist: turns the (mostly automatic) setup into visible
// "done" steps and points at the one remaining action. Shown only while the
// operator is still onboarding (connected but no scans yet).
export default function SetupChecklist({ sourceBoard, hasBoard, fieldsMapped, hasScanned, onDismiss }) {
  const steps = [
    { done: true, label: "Monday.com connected" },
    {
      done: Boolean(sourceBoard),
      label: sourceBoard
        ? `Owner board found (${sourceBoard.name})`
        : "Find your owners board — import a CSV or pick one in Setup",
    },
    { done: Boolean(hasBoard), label: "“Land Legacy Leads” board built" },
    { done: Boolean(fieldsMapped), label: "Fields mapped to your board" },
    { done: Boolean(hasScanned), label: "Run your first scan" },
  ];
  const currentIndex = steps.findIndex((step) => !step.done);

  return (
    <section className="panel checklist-panel" role="status" aria-label="Setup progress">
      <div className="checklist-head">
        <div>
          <p className="eyebrow">You&apos;re connected</p>
          <h2>Finish setup — almost there</h2>
        </div>
        {onDismiss ? (
          <button type="button" className="secondary-button" onClick={onDismiss}>
            Dismiss
          </button>
        ) : null}
      </div>
      <ol className="checklist">
        {steps.map((step, index) => (
          <StepRow key={step.label} done={step.done} current={index === currentIndex}>
            {step.label}
          </StepRow>
        ))}
      </ol>
      <p className="subtle checklist-foot">
        {currentIndex === -1
          ? "All set — leads will keep arriving."
          : "Most of this happened automatically. Do the highlighted step next — the button is below."}
      </p>
    </section>
  );
}
