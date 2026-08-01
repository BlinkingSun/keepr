## What this changes

<!-- One paragraph. What was wrong or missing, and what it does now. -->

## Why

<!-- If it fixes a bug, what was the failure? If it adds behaviour, what could not
     be done before? -->

## How it was verified

<!-- Be specific. "npm test passes" is a floor, not a verification.
     For extraction changes, paste the before/after table from
     `npm run corpus:analyze`. -->

- [ ] `npm test` passes
- [ ] `npx tsc -p .` is clean
- [ ] New behaviour has a test, or the bug fix has a test that failed before

## The eight rules

CONTRIBUTING.md lists eight invariants that each exist because they were got wrong
once. Confirm none are broken:

- [ ] Money stays integer minor units — no floats, no formatted strings
- [ ] No `SUM` from `receipt_data` or `item`; totals come from the canonical views
- [ ] No superseded split origin appears in a view showing totals
- [ ] Totals stay per-currency
- [ ] Word bboxes stay in stored-master pixel space; rotation stays metadata-only
- [ ] No nested worker pools
- [ ] No network access at runtime
- [ ] Any new warning state was measured against correct data before shipping

## Anything reviewers should look at closely

<!-- Trade-offs you made, things you were unsure about, anything you could not test. -->
