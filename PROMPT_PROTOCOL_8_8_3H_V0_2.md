# Dentorax Prompt Protocol 8.8.3H v0.2

## Purpose

This protocol upgrades the Secure Vision Gateway from a highly conservative OPG findings generator into a dentist-facing review assistant that can surface both:

- clear clinical findings
- subtle dentist-only radiographic review signals

The product philosophy is:

```text
Dentist-facing engine: more sensitive, signal-aware, review-oriented
Patient-facing output: locked, calm, dentist-approved only
```

## Key change

The prompt no longer suppresses every uncertain area. Instead, subtle contrast changes, margin irregularities, root-adjacent shadows, bone contour asymmetries, and periodontal/restoration boundary patterns may be returned as `review_signal` items.

These are not diagnoses. They are dentist-only review signals.

## New fields

Findings now may include:

```json
"findingType": "clinical_finding|review_signal|reference_observation",
"certaintyType": "confirmed_visible|suspected_signal|review_zone",
"whyFlaggedEN": "",
"whyFlaggedFA": "",
"signalStrength": "low|moderate|high"
```

The response also includes:

```json
"visualBoardPlan": {}
```

This plan prepares Dentorax for a later dentist-approved visual board generator.

## Safety invariants

The gateway still enforces:

```json
"visibleToPatient": false,
"requiresDoctorReview": true,
"patientRecapEN": [],
"patientRecapFA": []
```

The application, not the provider, creates patient-facing output after dentist approval.

## Expected response behavior

A good response may include:

- 2–4 clinical findings
- 1–4 subtle review signals
- PA / bitewing / clinical exam evidence needs
- visual annotations
- visualBoardPlan
- empty patient recap arrays

## Validation checklist

- `engineStatus = engine_active`
- `source = secure_gateway`
- `gatewayVersion = 0.1.2`
- `config.promptProtocol = 8.8.3H-v0.2`
- every finding has `visibleToPatient = false`
- patient recap arrays are empty
- JSON repair metadata is present
- visualBoardPlan exists
