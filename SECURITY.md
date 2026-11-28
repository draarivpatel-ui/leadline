# Security policy

## Reporting a vulnerability

Use the private GitHub Security Advisory form at [Report a vulnerability](https://github.com/draarivpatel-ui/leadline/security/advisories/new). Do not open a public issue, pull request or discussion with exploit details.

Never include a live secret, token, cookie, private key, victim hostname or proprietary payload in a report. Use synthetic values and redacted transcripts.

## Supported versions

| Version | Status |
| --- | --- |
| latest `main` | Supported |

Security fixes are applied to the latest state of the default branch.

## Scope

This policy covers the browser-only Leadline viewer, including EDF, EDF+ and BDF parsing, Web Worker message handling, montage construction, signal filtering, spectrogram rendering, annotations, sample loading and browser rendering.

In scope:

- A cross-site scripting or HTML injection path through channel labels, annotations, file metadata, error text or rendered measurement values.
- A parser or worker boundary flaw that lets a malformed recording execute attacker-controlled code, read memory outside the opened file, or corrupt another recording.
- A file-handling flaw that uploads recording data or sends it to an external origin; recordings must remain on the local device.
- A montage, annotation-alignment or filter-scope flaw that crosses documented channel boundaries in a way that could mislead a safety-critical interpretation.
- A sample or export path flaw that writes outside the user-selected file or downloads attacker-controlled content under a trusted name.

Out of scope:

- Browser vulnerabilities, operating system compromise or physical access to the machine.
- Damage caused by modified copies of the static application that do not come from this repository.
- Behavior caused solely by a user typing or pasting content into their own local browser session, unless it crosses a documented application boundary.

## Coordinated disclosure

- Acknowledgment: within 3 business days.
- Initial triage: within 14 calendar days.
- Fix or mitigation target: within 90 calendar days for confirmed reports.
- Coordinated public disclosure: up to 90 days by default, adjusted by mutual agreement when exploitation or user risk requires a different date.
