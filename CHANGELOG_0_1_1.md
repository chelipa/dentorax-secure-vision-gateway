# Dentorax Secure Vision Gateway v0.1.1
## JSON Repair + Parse Retry + Schema Guard

Date: 2026-07-07

## Why this patch exists

Dentorax Studio received this repeated live-engine error:

```text
Expected ',' or ']' after array element in JSON at position 7076
```

This means the Secure Gateway route was reachable and the vision engine responded, but the returned text was malformed JSON. Dentorax Studio correctly refused to replace the failed result with mock findings.

## Fixed in v0.1.1

### 1. JSON extraction and repair

The gateway now attempts multiple parse passes:

1. Direct JSON parse
2. Normalized JSON parse
3. Missing-comma repair outside strings

Repair targets include common model JSON issues such as:

- trailing commas
- missing comma between adjacent array/object/string elements
- fenced markdown JSON blocks
- smart quote normalization
- unsafe control characters

### 2. One retry with a shorter prompt

If the first full OPG JSON parse fails, the gateway retries once with a stricter shorter JSON instruction:

- maximum 3 findings
- shorter text fields
- no markdown
- no trailing commas
- empty patient recap arrays

### 3. Schema guard for `/analyze-opg`

Before returning to Dentorax Studio, the gateway normalizes:

- `confidence` to 0–100
- `visibleToPatient` to `false`
- `patientRecapEN` and `patientRecapFA` to empty arrays
- missing `paRequests` from evidence needs
- missing basic summary/metadata fields

### 4. JSON repair metadata

Successful responses include repair metadata under:

```json
"gatewayMeta": {
  "jsonRepair": {
    "repaired": false,
    "method": "direct",
    "retryUsed": false
  }
}
```

If the retry path was used:

```json
"jsonRepair": {
  "repaired": true,
  "method": "missing_comma_repair",
  "retryUsed": true
}
```

## Expected successful `/analyze-opg` response

```json
{
  "ok": true,
  "engineStatus": "engine_active",
  "source": "secure_gateway",
  "model": "DX-Vision Primary",
  "findings": [
    {
      "confidence": 85,
      "visibleToPatient": false
    }
  ],
  "patientRecapEN": [],
  "patientRecapFA": [],
  "gatewayMeta": {
    "jsonRepair": {
      "retryUsed": false
    }
  }
}
```

## Safety behavior preserved

If parsing and retry both fail, the gateway still returns a safe locked state:

```json
{
  "ok": false,
  "engineStatus": "gateway_error",
  "findings": [],
  "paRequests": [],
  "visualAnnotations": [],
  "patientRecapEN": [],
  "patientRecapFA": []
}
```

No mock replacement is used.
