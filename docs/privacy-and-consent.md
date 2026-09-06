# Privacy and Consent

## Product Position

Meeting Observer is a private meeting companion. It should analyze only observable meeting text and present intent as evidence-backed hypotheses.

It should not claim to know private thoughts, motives, emotions, or psychological state.

## MVP Defaults

- The user turns on Google Meet live captions.
- The extension reads rendered caption text.
- No audio is captured.
- No cloud model is required.
- The backend can run locally or on a private DGX box.
- Session deletion is available through the dashboard API.

## Output Rules

Every intent insight should include:

- Participant name.
- Intent label.
- Hypothesis wording.
- Confidence.
- Evidence from transcript lines.
- Suggested user move.

Avoid wording like:

- "Alex intends to block this."
- "Maria is lying."
- "Dan is manipulating the group."

Prefer wording like:

- "Alex may be resisting scope expansion."
- "Maria may be avoiding a firm commitment."
- "Dan may be trying to move ownership."

## Before Real Deployment

Add:

- Consent and disclosure workflow.
- Organization retention policy.
- Local authentication.
- Audit logging.
- Sensitive-term redaction.
- Data export and deletion.
- Clear per-meeting recording and analysis state.
