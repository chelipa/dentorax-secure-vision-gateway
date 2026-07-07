# Dentorax Secure Vision Gateway v0.1.2

## Prompt Protocol 8.8.3H v0.2 Integration

Date: 2026-07-07

## Added

- Prompt Protocol 8.8.3H v0.2
- Dentist-only radiographic review signal philosophy
- New finding fields:
  - `findingType`
  - `certaintyType`
  - `whyFlaggedEN`
  - `whyFlaggedFA`
  - `signalStrength`
- `visualBoardPlan` for later dentist-approved premium 2D visual board generation
- `cbct_may_be_considered_by_dentist` as a cautious evidenceNeed option
- `/health` config metadata now includes:
  - `promptProtocol: 8.8.3H-v0.2`

## Preserved

- Provider hidden from clinic UI
- No mock replacement
- JSON repair and parse retry
- Patient recap lock:
  - `patientRecapEN: []`
  - `patientRecapFA: []`
- `visibleToPatient: false` enforced by gateway
- Doctor review required before patient communication

## Deployment

Upload these files to the GitHub repository root:

- `server.js`
- `package.json`
- `package-lock.json`
- `.npmrc`
- `railway.json`
- documentation files

Then commit to `main` and wait for Railway deployment.

## Expected health check

```json
{
  "gatewayVersion": "0.1.2",
  "config": {
    "promptProtocol": "8.8.3H-v0.2"
  }
}
```
