import express from 'express'
import cors from 'cors'
import crypto from 'crypto'

const VERSION = '0.1.2'
const PUBLIC_GATEWAY_NAME = 'Dentorax Secure Vision Gateway'
const PUBLIC_ENGINE_ALIAS = 'Dentorax Vision Engine'

const app = express()
app.disable('x-powered-by')

const maxJsonBody = process.env.MAX_JSON_BODY || '18mb'
app.use(express.json({ limit: maxJsonBody }))

function parseList(value = '') {
  return String(value).split(',').map((item) => item.trim()).filter(Boolean)
}

const allowedOrigins = parseList(process.env.ALLOWED_ORIGINS || '*')
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true)
    return callback(new Error('origin_not_allowed_by_gateway_cors'))
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['content-type', 'x-dentorax-admin-token'],
  maxAge: 86400,
}))

app.use((req, _res, next) => {
  req.ctx = { requestId: crypto.randomUUID(), startedAt: Date.now() }
  next()
})

function nowIso() { return new Date().toISOString() }
function todayISO() { return new Date().toISOString().slice(0, 10) }
function safeBool(value) { return Boolean(value && String(value).trim()) }

function send(res, status, payload) {
  res.status(status).json({ gateway: PUBLIC_GATEWAY_NAME, gatewayVersion: VERSION, timestamp: nowIso(), ...payload })
}

function getConfig() {
  return {
    provider: (process.env.ENGINE_PRIMARY || 'gemini').toLowerCase(),
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
    baseUrl: process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
    apiMode: (process.env.GEMINI_API_MODE || 'interactions').toLowerCase(),
    requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 90000),
    regionLabel: process.env.DENTORAX_GATEWAY_REGION || 'foreign-hosted',
    maxInlineImageBytes: Number(process.env.MAX_INLINE_IMAGE_BYTES || 9000000),
    adminToken: process.env.DENTORAX_ADMIN_TOKEN || '',
  }
}

function publicConfig() {
  const config = getConfig()
  return {
    providerHiddenFromClinicUI: true,
    publicEngineAlias: PUBLIC_ENGINE_ALIAS,
    promptProtocol: '8.8.3H-v0.2',
    primaryProviderConfigured: safeBool(config.apiKey),
    selectedModel: config.model,
    apiMode: config.apiMode,
    regionLabel: config.regionLabel,
    requestTimeoutMs: config.requestTimeoutMs,
    maxJsonBody,
    maxInlineImageBytes: config.maxInlineImageBytes,
    retentionMode: process.env.RETENTION_MODE || 'stateless_no_raw_image_storage',
    allowedOrigins: allowedOrigins.includes('*') ? ['*'] : allowedOrigins,
  }
}

function requireAdmin(req, res) {
  const configured = getConfig().adminToken
  if (!configured) return true
  const supplied = req.headers['x-dentorax-admin-token']
  if (supplied === configured) return true
  send(res, 401, { ok: false, status: 'admin_token_required', requestId: req.ctx?.requestId })
  return false
}

function normalizeError(error) {
  const message = error instanceof Error ? error.message : String(error || 'gateway_runtime_error')
  if (message.includes('PERMISSION_DENIED') || message.includes('API key') || message.includes('403')) return 'gateway_permission_or_region_403'
  if (message.includes('400')) return 'gateway_invalid_request_400'
  if (message.includes('404')) return 'gateway_model_or_endpoint_404'
  if (message.includes('429')) return 'gateway_quota_or_rate_limit_429'
  if (message.includes('AbortError')) return 'gateway_timeout'
  return message
}

function estimateBytesFromBase64(base64 = '') {
  return Math.round(String(base64).length * 0.75)
}

function validateImagePayload(image) {
  if (!image?.base64 || !image?.mimeType) return { ok: false, status: 'missing_image_payload' }
  if (!String(image.mimeType).startsWith('image/')) return { ok: false, status: 'unsupported_mime_type' }
  const estimatedBytes = estimateBytesFromBase64(image.base64)
  if (estimatedBytes > getConfig().maxInlineImageBytes) return { ok: false, status: 'image_payload_too_large', estimatedBytes }
  return { ok: true, estimatedBytes }
}


function extractJsonCandidate(text) {
  const source = String(text || '').trim()
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = (fenced?.[1] ?? source).trim()
  const firstObject = raw.indexOf('{')
  const firstArray = raw.indexOf('[')
  let first = -1
  let closing = '}'
  if (firstObject >= 0 && (firstArray === -1 || firstObject < firstArray)) {
    first = firstObject
    closing = '}'
  } else if (firstArray >= 0) {
    first = firstArray
    closing = ']'
  }
  const last = raw.lastIndexOf(closing)
  if (first === -1 || last === -1 || last <= first) throw new Error('provider_response_did_not_contain_json')
  return raw.slice(first, last + 1)
}

function normalizeJsonText(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
}

function insertMissingCommasOutsideStrings(value) {
  const input = String(value || '')
  let output = ''
  let inString = false
  let escaped = false
  let lastEndedValueAt = -1

  function nextSignificant(index) {
    for (let i = index; i < input.length; i += 1) {
      if (!/\s/.test(input[i])) return input[i]
    }
    return ''
  }

  function shouldInsertCommaAfter(endChar, nextChar) {
    if (!nextChar) return false
    if (nextChar === ',' || nextChar === '}' || nextChar === ']' || nextChar === ':') return false
    if (endChar === '"' && nextChar === ':') return false
    return ['{', '[', '"', 't', 'f', 'n', '-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(nextChar)
  }

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]
    output += char

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
        lastEndedValueAt = i
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '}' || char === ']') {
      lastEndedValueAt = i
    }

    if (lastEndedValueAt === i) {
      const next = nextSignificant(i + 1)
      if (shouldInsertCommaAfter(char, next)) output += ','
    }
  }

  return output
}

function parseJsonWithRepair(text) {
  const candidate = extractJsonCandidate(text)
  const attempts = []
  const variants = [
    { name: 'direct', value: candidate },
    { name: 'normalized', value: normalizeJsonText(candidate) },
    { name: 'missing_comma_repair', value: insertMissingCommasOutsideStrings(normalizeJsonText(candidate)) },
  ]

  for (const variant of variants) {
    try {
      return { parsed: JSON.parse(variant.value), repair: variant.name, repaired: variant.name !== 'direct' }
    } catch (error) {
      attempts.push(`${variant.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const last = attempts[attempts.length - 1] || 'unknown_json_parse_error'
  const err = new Error(`provider_json_parse_failed_after_repair: ${last}`)
  err.attempts = attempts
  err.rawPreview = candidate.length > 1200 ? `${candidate.slice(0, 1200)}\n…[truncated]` : candidate
  throw err
}

function extractJsonObject(text) {
  return parseJsonWithRepair(text).parsed
}

function extractInteractionText(result) {
  if (typeof result?.output_text === 'string' && result.output_text.trim()) return result.output_text
  const steps = Array.isArray(result?.steps) ? result.steps : []
  const modelOutputs = steps.filter((step) => step?.type === 'model_output')
  const lastOutput = modelOutputs[modelOutputs.length - 1]
  const content = Array.isArray(lastOutput?.content) ? lastOutput.content : []
  return content.map((item) => item?.text ?? '').filter(Boolean).join('\n')
}

function extractGenerateContentText(result) {
  const candidates = Array.isArray(result?.candidates) ? result.candidates : []
  const parts = Array.isArray(candidates?.[0]?.content?.parts) ? candidates[0].content.parts : []
  return parts.map((part) => part?.text ?? '').filter(Boolean).join('\n')
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try { return await fetch(url, { ...init, signal: controller.signal }) }
  finally { clearTimeout(timeout) }
}

function buildInteractionInput(prompt, image, paImages = []) {
  const input = [{ type: 'text', text: prompt }]
  if (image?.base64 && image?.mimeType) input.push({ type: 'image', data: image.base64, mime_type: image.mimeType, resolution: 'high' })
  paImages.slice(0, 3).forEach((pa, index) => {
    if (pa?.base64 && pa?.mimeType) {
      input.push({ type: 'text', text: `Additional PA image ${index + 1}. Use it only as supplementary evidence for the same case.` })
      input.push({ type: 'image', data: pa.base64, mime_type: pa.mimeType, resolution: 'high' })
    }
  })
  return input
}

function buildGenerateContentParts(prompt, image, paImages = []) {
  const parts = [{ text: prompt }]
  if (image?.base64 && image?.mimeType) parts.push({ inlineData: { mimeType: image.mimeType, data: image.base64 } })
  paImages.slice(0, 3).forEach((pa, index) => {
    if (pa?.base64 && pa?.mimeType) {
      parts.push({ text: `Additional PA image ${index + 1}. Use it only as supplementary evidence for the same case.` })
      parts.push({ inlineData: { mimeType: pa.mimeType, data: pa.base64 } })
    }
  })
  return parts
}

async function callGemini({ prompt, image, paImages = [] }) {
  const config = getConfig()
  if (!config.apiKey) throw new Error('missing_gemini_api_key')

  if (config.apiMode === 'generate_content') {
    const endpoint = `${config.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: buildGenerateContentParts(prompt, image, paImages) }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 7000, responseMimeType: 'application/json' },
      }),
    }, config.requestTimeoutMs)
    if (!response.ok) throw new Error(`provider_${response.status}_${await response.text()}`)
    const result = await response.json()
    const text = extractGenerateContentText(result)
    if (!text) throw new Error('provider_empty_response')
    return { text, rawMode: 'generate_content' }
  }

  const endpoint = `${config.baseUrl.replace(/\/$/, '')}/interactions`
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
    body: JSON.stringify({
      model: config.model,
      input: buildInteractionInput(prompt, image, paImages),
      store: false,
      background: false,
      generation_config: { temperature: 0.1, max_output_tokens: 7000 },
      response_format: { type: 'text', mime_type: 'application/json' },
    }),
  }, config.requestTimeoutMs)
  if (!response.ok) throw new Error(`provider_${response.status}_${await response.text()}`)
  const result = await response.json()
  const text = extractInteractionText(result)
  if (!text) throw new Error('provider_empty_response')
  return { text, rawMode: 'interactions' }
}

const TEXT_PING_PROMPT = `Return strict JSON only: {"ok": true, "test": "text_ping", "app": "Dentorax Secure Vision Gateway"}`

const IMAGE_TRIAGE_PROMPT = `You are Dentorax Vision Engine in image-triage mode.
Analyze only the uploaded cropped OPG image.
Return strict JSON only:
{
  "ok": true,
  "test": "image_triage",
  "imageQuality": "good|limited|poor",
  "coverage": "full_opg|partial|uncertain",
  "visiblePatterns": ["short visible non-diagnostic observations"],
  "possibleFindings": ["short cautious visual notes"],
  "needsAdditionalImage": false,
  "safetyNote": "Dentist review required."
}
Do not diagnose. Do not create a treatment plan.`

const FULL_OPG_PROMPT = `You are Dentorax Vision Engine, a dentist-facing panoramic radiograph review assistant.

You review uploaded dental panoramic radiographs (OPG) and optional supplementary PA images and return a structured JSON draft for dentist review only.

You do not diagnose.
You do not replace the dentist.
You do not generate patient-facing conclusions before dentist approval.
You do not generate an image in this step.

Your purpose is to help the dentist review the OPG more carefully by surfacing:
1. clear visible findings,
2. subtle radiographic review signals,
3. areas where additional imaging or clinical examination may improve confidence,
4. visual annotation coordinates for review,
5. a visual board plan that can later be used to create a dentist-approved patient explanation board.

CORE PRINCIPLE:
Radiographic truth takes precedence over visual appeal.

IMPORTANT BALANCE:
Do not be so conservative that you suppress useful dentist-only review signals.
If a subtle contrast change, margin irregularity, periapical shadow, bone contour asymmetry, restoration boundary issue, periodontal pattern, or root-adjacent shadow may be clinically relevant, include it as a dentist-only review signal.

But:
- Do not call subtle signals definitive disease.
- Do not overstate pathology.
- Do not use frightening patient language.
- Do not create final diagnosis.
- Do not create treatment recommendations.
- Do not mark anything patient-visible before dentist approval.

DENTIST-ONLY SIGNAL PHILOSOPHY:
A dentist may benefit from seeing areas that deserve closer review, even if they are not diagnostic on OPG alone.

Therefore:
- Clear visible issues may be returned as clinical findings.
- Subtle or uncertain areas should be returned as review signals.
- Neutral useful observations may be returned as reference observations.
- Every uncertain signal must include why it was flagged and what evidence may help confirm or dismiss it.

PATIENT SAFETY:
All findings and review signals must have:
"visibleToPatient": false
"requiresDoctorReview": true

patientRecapEN and patientRecapFA must always be empty arrays:
"patientRecapEN": []
"patientRecapFA": []

Only the Dentorax application may create patient-facing recap after dentist approval.

DO NOT:
- mention AI, model, provider, automation, Gemini, API, or machine diagnosis
- expose patient identity, name, date, radiology center name, phone, or source branding
- invent implants, bridges, root canal treatment, posts, missing teeth, or pathology unless clearly visible
- use labels like abscess, failed treatment, urgent extraction, severe infection unless unmistakably visible, and even then phrase as requiring dentist confirmation
- output markdown
- output explanations outside JSON
- output invalid JSON

LANGUAGE STYLE:
Doctor notes can be clinically specific.
Patient text must be calm, non-alarming, and tentative.
Use "review", "may", "appears", "possible", "clinical correlation", "additional imaging may help" when appropriate.

EVIDENCE LEVEL:
Use:
A = clearly visible on OPG
B = visible but needs clinical or PA/bitewing correlation
C = subtle review signal only, not diagnostic

CATEGORIES:
Use one of:
restoration
caries
periapical
periodontal
impacted_tooth
bone_support
endodontic
prosthodontic
anatomy
other

FINDING TYPES:
Use:
clinical_finding = relatively clear visible finding
review_signal = subtle or uncertain dentist-only signal
reference_observation = neutral observation useful for explanation or visual board

CERTAINTY TYPES:
Use:
confirmed_visible = clearly visible on OPG
suspected_signal = visible but uncertain
review_zone = area worth dentist review without diagnostic claim

SEVERITY:
Use:
stable
watch
concern
high_concern

SEVERITY COLOR:
Use:
blue = existing treatment / neutral finding
green = preserved or stable structure
yellow = watch / mild review
orange = concern / review recommended
red = high concern for dentist review only

Never use red for patient-facing output. Red is only allowed as dentist-only review emphasis.

EVIDENCE NEED:
Use:
none
pa_recommended
bitewing_recommended
clinical_exam_required
cbct_may_be_considered_by_dentist

Use CBCT only sparingly and only when the pattern may justify advanced evaluation by the dentist. Never state that CBCT is mandatory.

VISUAL ANNOTATIONS:
Return x and y as percentages from 0 to 100 relative to the uploaded image.
Use radius 4 to 12.
Keep annotations accurate and sparse.
Do not cover the entire image with excessive markers.

GRID:
Use a 5x4 grid:
A1 A2 A3 A4
B1 B2 B3 B4
C1 C2 C3 C4
D1 D2 D3 D4
E1 E2 E3 E4

A = patient left side of image area
E = patient right side of image area
1 = upper region
4 = lower region

Return only valid JSON using exactly this structure:

{
  "caseId": "DX-LIVE",
  "patientCode": "PT-DEMO",
  "analysisDate": "YYYY-MM-DD",
  "evidenceLevel": "A|B|C",
  "evidenceSummaryEN": "",
  "evidenceSummaryFA": "",
  "findings": [
    {
      "id": "F1",
      "findingType": "clinical_finding|review_signal|reference_observation",
      "certaintyType": "confirmed_visible|suspected_signal|review_zone",
      "category": "restoration|caries|periapical|periodontal|impacted_tooth|bone_support|endodontic|prosthodontic|anatomy|other",
      "severity": "stable|watch|concern|high_concern",
      "severityColor": "blue|green|yellow|orange|red",
      "toothFDI": "string or null",
      "regionEN": "",
      "regionFA": "",
      "labelEN": "",
      "labelFA": "",
      "doctorNoteEN": "",
      "doctorNoteFA": "",
      "patientTextEN": "",
      "patientTextFA": "",
      "whyFlaggedEN": "",
      "whyFlaggedFA": "",
      "confidence": 0,
      "signalStrength": "low|moderate|high",
      "evidenceLevel": "A|B|C",
      "evidenceNeed": "none|pa_recommended|bitewing_recommended|clinical_exam_required|cbct_may_be_considered_by_dentist",
      "visibleToPatient": false,
      "requiresDoctorReview": true,
      "findingGridCell": "A1"
    }
  ],
  "paRequests": [
    {
      "findingId": "F1",
      "toothFDI": "string or null",
      "regionEN": "",
      "regionFA": "",
      "reasonEN": "",
      "reasonFA": "",
      "priority": "optional|recommended|important"
    }
  ],
  "visualAnnotations": [
    {
      "findingId": "F1",
      "toothFDI": "string or null",
      "region": "",
      "findingGridCell": "A1",
      "x": 0,
      "y": 0,
      "radius": 6,
      "color": "blue|green|yellow|orange|red|gray",
      "label": "F1",
      "calloutEN": "",
      "calloutFA": ""
    }
  ],
  "technicalSummaryEN": [],
  "technicalSummaryFA": [],
  "patientRecapEN": [],
  "patientRecapFA": [],
  "visualBoardPlan": {
    "boardType": "premium_opg_consultation_board",
    "visualTone": "dark navy, subtle gold accents, premium dental editorial, patient-friendly, dentist-guided",
    "mainPanelFocus": "",
    "allowedLabels": [
      "Existing Restoration",
      "Restoration Margin Review",
      "Posterior Restoration Review",
      "Bone Support Overview",
      "Dentist Review Area",
      "Treatment Discussion Zone",
      "Additional Imaging May Be Needed",
      "Clinical Correlation Required"
    ],
    "forbiddenLabels": [
      "Implant unless clearly visible",
      "Bridge unless clearly visible",
      "Failed treatment",
      "Urgent extraction",
      "Abscess",
      "Severe infection",
      "Definitive diagnosis"
    ],
    "suggestedCalloutsEN": [],
    "suggestedCalloutsFA": [],
    "auxiliaryPanels": [
      "Restoration Zone Map",
      "Bone Support Overview",
      "Dentist Review Notes"
    ],
    "dentistReviewNotesEN": [],
    "dentistReviewNotesFA": [],
    "disclaimerEN": "This visual board is for dentist-reviewed communication and product evaluation only. It does not replace clinical diagnosis or treatment planning.",
    "disclaimerFA": "نسخه آزمایشی برای ارزیابی تخصصی دندانپزشکان"
  },
  "warnings": [
    "Dentist review required before patient communication."
  ]
}

FIELD RULES:
1. findings:
Return 2 to 8 items maximum.
Include both clinical findings and subtle review signals when relevant.
Do not force findings if image quality is insufficient.
If no reliable finding exists, return an empty findings array and explain limitation in evidenceSummary.

2. findingType:
clinical_finding = visible enough to be a main dentist review item.
review_signal = subtle shadow, contrast change, boundary issue, asymmetry, or uncertain area.
reference_observation = neutral observation such as existing restoration or bone overview.

3. confidence:
Use 70-95 for clear visible findings.
Use 45-75 for subtle review signals.
Do not use 100.

4. patientText:
Even though patientText is included for later dentist editing, keep visibleToPatient false.
Use calm wording.
Do not say infection, fracture, failure, or urgent treatment in patientText unless the dentist later confirms.

5. whyFlagged:
Always explain why the region was flagged visually.
Examples:
- localized radiolucent shadow near root apex
- irregular radiographic margin near restoration
- asymmetric bone contour
- root-adjacent contrast change
- crown margin shadow
- interproximal radiolucency suspicion

6. paRequests:
Create evidence requests when any finding has evidenceNeed other than none.
For review_signal items, evidence need is usually clinical_exam_required, pa_recommended, or bitewing_recommended.

7. visualBoardPlan:
Do not create a full patient recap.
Only prepare a board plan for later dentist-approved visual explanation.
Use conservative visual language.

8. JSON validity:
Return valid JSON only.
No trailing commas.
No markdown.
No comments.
No extra text.

Today: ${todayISO()}.`

function choosePrompt(mode) {
  if (mode === 'text_ping') return TEXT_PING_PROMPT
  if (mode === 'image_triage') return IMAGE_TRIAGE_PROMPT
  return FULL_OPG_PROMPT
}

async function runGatewayMode({ mode, image, paImages = [] }) {
  const prompt = choosePrompt(mode)
  const providerResult = await callGemini({ prompt, image, paImages })
  let parsedResult = null
  try {
    parsedResult = parseJsonWithRepair(providerResult.text)
  } catch (firstError) {
    if (mode !== 'full_opg_json') throw firstError
    const retryPrompt = `${prompt}

CRITICAL RETRY INSTRUCTION:
Your previous response could not be parsed as JSON. Return a SHORTER valid JSON object only.
Limit findings to maximum 3. Keep each text field short. No markdown. No comments. No trailing commas.
Do not include patient-facing recap arrays; return patientRecapEN: [] and patientRecapFA: [].`
    const retryResult = await callGemini({ prompt: retryPrompt, image, paImages })
    const retryParsed = parseJsonWithRepair(retryResult.text)
    return {
      parsed: retryParsed.parsed,
      providerApiModeUsed: retryResult.rawMode,
      rawPreview: retryResult.text.length > 1600 ? `${retryResult.text.slice(0, 1600)}\n…[truncated]` : retryResult.text,
      jsonRepair: { repaired: retryParsed.repaired, method: retryParsed.repair, retryUsed: true, firstError: firstError instanceof Error ? firstError.message : String(firstError) },
    }
  }
  return {
    parsed: parsedResult.parsed,
    providerApiModeUsed: providerResult.rawMode,
    rawPreview: providerResult.text.length > 1600 ? `${providerResult.text.slice(0, 1600)}\n…[truncated]` : providerResult.text,
    jsonRepair: { repaired: parsedResult.repaired, method: parsedResult.repair, retryUsed: false },
  }
}


function normalizeConfidence(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 70
  if (n > 0 && n <= 1) return Math.round(n * 100)
  return Math.round(Math.min(100, Math.max(0, n)))
}

function normalizeEvidenceNeed(value) {
  if (
    value === 'pa_recommended' ||
    value === 'bitewing_recommended' ||
    value === 'clinical_exam_required' ||
    value === 'cbct_may_be_considered_by_dentist'
  ) return value
  return 'none'
}

function normalizeFindingType(value) {
  if (value === 'clinical_finding' || value === 'review_signal' || value === 'reference_observation') return value
  return 'clinical_finding'
}

function normalizeCertaintyType(value) {
  if (value === 'confirmed_visible' || value === 'suspected_signal' || value === 'review_zone') return value
  return 'suspected_signal'
}

function normalizeSignalStrength(value) {
  if (value === 'low' || value === 'moderate' || value === 'high') return value
  return 'moderate'
}

function normalizeSeverityColor(value) {
  if (['blue', 'green', 'yellow', 'orange', 'red', 'purple'].includes(value)) return value
  return 'yellow'
}

function normalizeCategory(value) {
  const allowed = ['restoration', 'caries', 'periapical', 'periodontal', 'impacted_tooth', 'bone_support', 'endodontic', 'prosthodontic', 'anatomy', 'other']
  if (allowed.includes(value)) return value
  if (value === 'rct') return 'endodontic'
  if (value === 'crown_bridge' || value === 'implant') return 'prosthodontic'
  if (value === 'missing_tooth' || value === 'orthodontic' || value === 'aesthetic_morphology') return 'other'
  return 'other'
}

function defaultVisualBoardPlan() {
  return {
    boardType: 'premium_opg_consultation_board',
    visualTone: 'dark navy, subtle gold accents, premium dental editorial, patient-friendly, dentist-guided',
    mainPanelFocus: 'Dentist-reviewed OPG visual consultation board',
    allowedLabels: [
      'Existing Restoration',
      'Restoration Margin Review',
      'Posterior Restoration Review',
      'Bone Support Overview',
      'Dentist Review Area',
      'Treatment Discussion Zone',
      'Additional Imaging May Be Needed',
      'Clinical Correlation Required',
    ],
    forbiddenLabels: [
      'Implant unless clearly visible',
      'Bridge unless clearly visible',
      'Failed treatment',
      'Urgent extraction',
      'Abscess',
      'Severe infection',
      'Definitive diagnosis',
    ],
    suggestedCalloutsEN: [],
    suggestedCalloutsFA: [],
    auxiliaryPanels: [
      'Restoration Zone Map',
      'Bone Support Overview',
      'Dentist Review Notes',
    ],
    dentistReviewNotesEN: [],
    dentistReviewNotesFA: [],
    disclaimerEN: 'This visual board is for dentist-reviewed communication and product evaluation only. It does not replace clinical diagnosis or treatment planning.',
    disclaimerFA: 'نسخه آزمایشی برای ارزیابی تخصصی دندانپزشکان',
  }
}

function normalizeVisualBoardPlan(value) {
  const fallback = defaultVisualBoardPlan()
  if (!value || typeof value !== 'object') return fallback
  return {
    ...fallback,
    ...value,
    allowedLabels: Array.isArray(value.allowedLabels) ? value.allowedLabels.slice(0, 12) : fallback.allowedLabels,
    forbiddenLabels: Array.isArray(value.forbiddenLabels) ? value.forbiddenLabels.slice(0, 12) : fallback.forbiddenLabels,
    suggestedCalloutsEN: Array.isArray(value.suggestedCalloutsEN) ? value.suggestedCalloutsEN.slice(0, 8) : [],
    suggestedCalloutsFA: Array.isArray(value.suggestedCalloutsFA) ? value.suggestedCalloutsFA.slice(0, 8) : [],
    auxiliaryPanels: Array.isArray(value.auxiliaryPanels) ? value.auxiliaryPanels.slice(0, 5) : fallback.auxiliaryPanels,
    dentistReviewNotesEN: Array.isArray(value.dentistReviewNotesEN) ? value.dentistReviewNotesEN.slice(0, 6) : [],
    dentistReviewNotesFA: Array.isArray(value.dentistReviewNotesFA) ? value.dentistReviewNotesFA.slice(0, 6) : [],
  }
}

function normalizeGatewayAnalysis(parsed) {
  const base = parsed && typeof parsed === 'object' ? parsed : {}
  const rawFindings = Array.isArray(base.findings) ? base.findings : []
  const findings = rawFindings.slice(0, 6).map((finding, index) => {
    const evidenceNeed = normalizeEvidenceNeed(finding?.evidenceNeed)
    return {
      id: finding?.id || `F${index + 1}`,
      findingType: normalizeFindingType(finding?.findingType),
      certaintyType: normalizeCertaintyType(finding?.certaintyType),
      category: normalizeCategory(finding?.category),
      severity: ['stable', 'watch', 'concern', 'high_concern'].includes(finding?.severity) ? finding.severity : 'watch',
      severityColor: normalizeSeverityColor(finding?.severityColor),
      toothFDI: finding?.toothFDI ?? null,
      regionEN: finding?.regionEN || 'Visual review area',
      regionFA: finding?.regionFA || 'ناحیه قابل بررسی',
      labelEN: finding?.labelEN || 'Visual review finding',
      labelFA: finding?.labelFA || 'یافته قابل بررسی',
      doctorNoteEN: finding?.doctorNoteEN || 'Dentist review required.',
      doctorNoteFA: finding?.doctorNoteFA || 'بررسی دندانپزشک لازم است.',
      patientTextEN: finding?.patientTextEN || 'Your dentist may review this area with you.',
      patientTextFA: finding?.patientTextFA || 'دندانپزشک این ناحیه را با شما مرور می‌کند.',
      whyFlaggedEN: finding?.whyFlaggedEN || finding?.doctorNoteEN || 'Flagged for dentist-only visual review.',
      whyFlaggedFA: finding?.whyFlaggedFA || finding?.doctorNoteFA || 'برای بررسی داخلی دندانپزشک علامت‌گذاری شد.',
      confidence: normalizeConfidence(finding?.confidence),
      signalStrength: normalizeSignalStrength(finding?.signalStrength),
      evidenceLevel: ['A', 'B', 'C'].includes(finding?.evidenceLevel) ? finding.evidenceLevel : 'B',
      evidenceNeed,
      visibleToPatient: false,
      requiresDoctorReview: true,
      findingGridCell: /^[A-E][1-4]$/.test(String(finding?.findingGridCell || '')) ? finding.findingGridCell : 'C3',
    }
  })

  const paRequestsFromFindings = findings
    .filter((finding) => finding.evidenceNeed !== 'none')
    .map((finding) => ({
      findingId: finding.id,
      toothFDI: finding.toothFDI,
      regionEN: finding.regionEN,
      regionFA: finding.regionFA,
      reasonEN: finding.evidenceNeed === 'bitewing_recommended'
        ? 'Bitewing-style evidence may improve confidence.'
        : finding.evidenceNeed === 'clinical_exam_required'
          ? 'Clinical examination is recommended before patient-facing communication.'
          : finding.evidenceNeed === 'cbct_may_be_considered_by_dentist'
            ? 'Advanced imaging may be considered by the dentist if clinical findings support it.'
            : 'A focused PA image may improve confidence.',
      reasonFA: finding.evidenceNeed === 'bitewing_recommended'
        ? 'نمای bitewing می‌تواند دقت بررسی را بیشتر کند.'
        : finding.evidenceNeed === 'clinical_exam_required'
          ? 'معاینه کلینیکی پیش از توضیح نهایی به بیمار توصیه می‌شود.'
          : finding.evidenceNeed === 'cbct_may_be_considered_by_dentist'
            ? 'در صورت تأیید بالینی، دندانپزشک می‌تواند تصویربرداری پیشرفته را مدنظر قرار دهد.'
            : 'تصویر PA می‌تواند دقت بررسی را بیشتر کند.',
      priority: finding.evidenceNeed === 'clinical_exam_required' || finding.evidenceNeed === 'cbct_may_be_considered_by_dentist' || finding.severityColor === 'red' ? 'important' : 'recommended',
    }))

  return {
    ...base,
    caseId: base.caseId || 'DX-LIVE',
    patientCode: base.patientCode || 'PT-DEMO',
    analysisDate: base.analysisDate || todayISO(),
    evidenceLevel: ['A', 'B', 'C'].includes(base.evidenceLevel) ? base.evidenceLevel : 'B',
    evidenceSummaryEN: base.evidenceSummaryEN || 'Dentorax visual review draft generated for dentist review.',
    evidenceSummaryFA: base.evidenceSummaryFA || 'پیش‌نویس بررسی تصویری دنتوراکس برای بازبینی دندانپزشک تولید شد.',
    findings,
    paRequests: Array.isArray(base.paRequests) && base.paRequests.length ? base.paRequests : paRequestsFromFindings,
    visualAnnotations: Array.isArray(base.visualAnnotations) ? base.visualAnnotations : [],
    technicalSummaryEN: Array.isArray(base.technicalSummaryEN) ? base.technicalSummaryEN : [],
    technicalSummaryFA: Array.isArray(base.technicalSummaryFA) ? base.technicalSummaryFA : [],
    patientRecapEN: [],
    patientRecapFA: [],
    visualBoardPlan: normalizeVisualBoardPlan(base.visualBoardPlan),
    warnings: Array.isArray(base.warnings) && base.warnings.length ? base.warnings : ['Dentist review required before patient communication.'],
  }
}

function payloadInspector(image, cropMeta) {
  if (!image?.base64) return null
  return {
    mimeType: image.mimeType,
    base64Length: image.base64.length,
    estimatedBytes: estimateBytesFromBase64(image.base64),
    cropMeta: cropMeta || null,
  }
}

app.get('/', (req, res) => send(res, 200, {
  ok: true,
  status: 'online',
  requestId: req.ctx.requestId,
  message: 'Dentorax Secure Vision Gateway is online.',
  routes: ['/health', '/engine/status', '/engine/ping', '/analyze-opg'],
}))

app.get('/health', (req, res) => send(res, 200, {
  ok: true,
  status: 'online',
  requestId: req.ctx.requestId,
  config: publicConfig(),
}))

app.get('/engine/status', (req, res) => {
  if (!requireAdmin(req, res)) return
  send(res, 200, {
    ok: true,
    status: 'ready',
    requestId: req.ctx.requestId,
    config: publicConfig(),
    checks: {
      gatewayPing: 'pass',
      providerKeyLoaded: safeBool(getConfig().apiKey),
      rawImageLogging: 'disabled',
      providerHiddenFromClinicUI: true,
      patientOutputLockedByDefault: true,
    },
  })
})

app.post('/engine/ping', async (req, res) => {
  if (!requireAdmin(req, res)) return
  const started = Date.now()
  const mode = req.body?.mode || 'text_ping'
  const image = req.body?.image
  const paImages = Array.isArray(req.body?.paImages) ? req.body.paImages : []
  const cropMeta = req.body?.cropMeta || null

  try {
    if (mode !== 'text_ping') {
      const validation = validateImagePayload(image)
      if (!validation.ok) return send(res, 400, {
        ok: false,
        status: validation.status,
        mode,
        requestId: req.ctx.requestId,
        payloadInspector: payloadInspector(image, cropMeta),
      })
    }

    const result = await runGatewayMode({ mode, image, paImages })
    send(res, 200, {
      ok: true,
      status: 'completed',
      mode,
      requestId: req.ctx.requestId,
      provider: 'provider_hidden',
      publicEngineAlias: PUBLIC_ENGINE_ALIAS,
      apiMode: result.providerApiModeUsed,
      modelAlias: 'DX-Vision Primary',
      jsonRepair: result.jsonRepair || null,
      requestDurationMs: Date.now() - started,
      parsed: result.parsed,
      rawPreview: result.rawPreview,
      payloadInspector: payloadInspector(image, cropMeta),
    })
  } catch (error) {
    send(res, 200, {
      ok: false,
      status: 'gateway_error',
      mode,
      requestId: req.ctx.requestId,
      provider: 'provider_hidden',
      publicEngineAlias: PUBLIC_ENGINE_ALIAS,
      apiMode: getConfig().apiMode,
      modelAlias: 'DX-Vision Primary',
      requestDurationMs: Date.now() - started,
      errorMessage: normalizeError(error),
      payloadInspector: payloadInspector(image, cropMeta),
    })
  }
})

app.post('/analyze-opg', async (req, res) => {
  if (!requireAdmin(req, res)) return
  const started = Date.now()
  const image = req.body?.image || { base64: req.body?.base64, mimeType: req.body?.mimeType }
  const paImages = Array.isArray(req.body?.paImages) ? req.body.paImages : []
  const cropMeta = req.body?.cropMeta || req.body?.context?.cropMeta || null

  try {
    const validation = validateImagePayload(image)
    if (!validation.ok) return send(res, 400, {
      ok: false,
      engineStatus: 'gateway_error',
      status: validation.status,
      requestId: req.ctx.requestId,
    })

    const result = await runGatewayMode({ mode: 'full_opg_json', image, paImages })
    send(res, 200, {
      ...normalizeGatewayAnalysis(result.parsed),
      ok: true,
      engineStatus: 'engine_active',
      source: 'secure_gateway',
      model: 'DX-Vision Primary',
      requestId: req.ctx.requestId,
      requestDurationMs: Date.now() - started,
      apiKeyLoaded: true,
      gatewayMeta: {
        publicEngineAlias: PUBLIC_ENGINE_ALIAS,
        apiMode: result.providerApiModeUsed,
        providerHiddenFromClinicUI: true,
        jsonRepair: result.jsonRepair || null,
        cropMeta,
      },
    })
  } catch (error) {
    send(res, 200, {
      ok: false,
      engineStatus: 'gateway_error',
      source: 'secure_gateway',
      model: 'DX-Vision Primary',
      requestId: req.ctx.requestId,
      requestDurationMs: Date.now() - started,
      apiKeyLoaded: safeBool(getConfig().apiKey),
      errorMessage: normalizeError(error),
      findings: [],
      paRequests: [],
      visualAnnotations: [],
      patientRecapEN: [],
      patientRecapFA: [],
      warnings: ['No mock replacement was used. Dentist review and patient recap must remain locked.'],
    })
  }
})

const port = Number(process.env.PORT || 8080)
app.listen(port, '0.0.0.0', () => {
  console.log(`${PUBLIC_GATEWAY_NAME} v${VERSION} listening on port ${port}`)
  console.log('Safe config:', JSON.stringify(publicConfig()))
})
