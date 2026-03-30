# Obituary Name Matching Implementation Note

This change keeps the obituary matcher on a lightweight, deterministic `rapidfuzz` foundation instead of introducing `recordlinkage`, `dedupe`, or another heavier entity-resolution stack.

Why this fit the repo better:
- The service already depends on `rapidfuzz`, so integration cost stayed low.
- Scoring remains inspectable: every component has an explicit score, weight, and evidence string.
- Thresholds and weights are code-level tuning knobs instead of learned model state.
- The pipeline stays synchronous and deterministic, which is easier to test and reason about in scan runs.

What changed:
- Added deterministic normalization for punctuation, hyphenation, suffix stripping, ASCII folding, and token sorting.
- Folded nickname expansion into first-name scoring instead of treating it as a separate override.
- Added weighted component scoring for last name, first name, full name, optional middle name, and location bonus.
- Added confidence bands (`high`, `medium`, `low`) plus structured explanation details for PR/debug use.

Trade-offs:
- This is still a heuristic matcher, not a trained linker; very ambiguous populations may still need review thresholds rather than auto-confirmation.
- Confidence bands are intentionally conservative and tunable in code, which favors transparency over maximum recall.
