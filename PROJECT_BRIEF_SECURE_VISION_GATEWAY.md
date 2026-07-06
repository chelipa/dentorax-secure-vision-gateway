# Project Brief — Dentorax Secure Vision Gateway

## Project registration

Independent project name:

**Dentorax Secure Vision Gateway**

## Strategic goal

Build a secure, stable, foreign-hosted and compliance-aware routing layer for OPG visual review.

This layer must remove the clinic-side dependency on VPN/filter-breakers and must prevent local network restrictions from affecting Dentorax output.

## Research framing

This is not framed as sanctions evasion. It is framed as:

- compliance-aware infrastructure
- supported-region deployment
- provider-agnostic routing
- privacy-preserving image relay
- resilient medical-adjacent analysis gateway
- multi-engine validation for dentist-controlled OPG explanation

## Technical goals

1. Positive gateway ping
2. Positive text engine ping
3. Positive image engine ping
4. Positive Dentorax JSON schema ping
5. Provider-hidden clinic UI
6. Server-side API keys only
7. Temporary/de-identified OPG file handling
8. Normalized Dentorax JSON response
9. Fail-safe workflow lock on engine failure
10. Future multi-engine orchestration

## Future architecture

```text
Dentorax Frontend
→ Secure Upload API
→ Temporary Object Storage
→ Vision Gateway Worker
→ Engine Router
→ Primary Vision Engine
→ Fallback Vision Engine
→ Safety Reviewer
→ Patient Language Reviewer
→ JSON Normalizer
→ Dentist Review
```

## Phase plan

### Phase SVG-0.1
External backend + Engine Lab baseline.

### Phase SVG-0.2
Secure upload relay with signed temporary URLs.

### Phase SVG-0.3
Provider router and fallback policy.

### Phase SVG-0.4
Multi-engine validation and disagreement flag.

### Phase SVG-0.5
Audit, retention, and compliance evidence pack.
