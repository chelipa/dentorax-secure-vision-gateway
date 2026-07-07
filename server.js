import express from 'express'
import cors from 'cors'
import crypto from 'crypto'

const VERSION = '0.1.1'
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

const FULL_OPG_PROMPT = `You are Dentorax Vision Engine, a dentist-in-the-loop visual review system for cropped dental panoramic radiographs / OPG images.
Analyze ONLY the uploaded cropped OPG and optional PA images in this request. Return ONLY strict JSON, no markdown.

Clinical boundary:
- This is a draft visual review for a licensed dentist, not a final diagnosis and not a treatment plan.
- The dentist makes all final clinical decisions and decides what the patient can see.
- Do not overstate certainty. OPG is a panoramic screening image and has limits around restoration margins, early caries, periapical detail, and periodontal measurements.
- If OPG evidence is limited, recommend PA, bitewing-style imaging, periodontal probing, or clinical exam as appropriate.

Return this exact JSON shape:
{
  "caseId": "DX-LIVE",
  "patientCode": "PT-XXXXXX",
  "analysisDate": "YYYY-MM-DD",
  "evidenceLevel": "A|B|C",
  "evidenceSummaryEN": "string",
  "evidenceSummaryFA": "string",
  "findings": [{
    "id": "F1",
    "category": "caries|periapical|periodontal|missing_tooth|impacted_tooth|restoration|rct|crown_bridge|implant|orthodontic|aesthetic_morphology|other",
    "severity": "stable|watch|concern|high_concern",
    "severityColor": "green|yellow|orange|red|purple|blue",
    "toothFDI": "string or null",
    "regionEN": "string",
    "regionFA": "string",
    "labelEN": "string",
    "labelFA": "string",
    "doctorNoteEN": "string",
    "doctorNoteFA": "string",
    "patientTextEN": "calm simple text",
    "patientTextFA": "متن ساده و آرام فارسی",
    "confidence": 0,
    "evidenceLevel": "A|B|C",
    "evidenceNeed": "none|pa_recommended|bitewing_recommended|clinical_exam_required",
    "visibleToPatient": false,
    "requiresDoctorReview": true,
    "findingGridCell": "A1"
  }],
  "paRequests": [],
  "visualAnnotations": [{
    "findingId": "F1",
    "toothFDI": "string or null",
    "region": "upper-left|upper-right|lower-left|lower-right|anterior-maxilla|anterior-mandible|generalized",
    "findingGridCell": "A1",
    "x": 50,
    "y": 50,
    "radius": 7,
    "color": "green|yellow|orange|red|purple|blue",
    "label": "F1",
    "calloutEN": "short",
    "calloutFA": "کوتاه"
  }],
  "technicalSummaryEN": ["string"],
  "technicalSummaryFA": ["string"],
  "patientRecapEN": [],
  "patientRecapFA": [],
  "warnings": ["Dentist review required before patient communication."]
}

Use findingGridCell as the primary approximate location. The OPG board is a 5×4 grid: columns A–E, rows 1–4.
Return at most 4 findings. Keep each text field concise. Patient text must be calm, non-coercive, and not fear-based.
Do not generate patient recap before dentist approval; patientRecapEN and patientRecapFA must be empty arrays.
Persian patient text should sound like a helpful dentist explaining beside the chair, not a radiology report.
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
  if (value === 'pa_recommended' || value === 'bitewing_recommended' || value === 'clinical_exam_required') return value
  return 'none'
}

function normalizeGatewayAnalysis(parsed) {
  const base = parsed && typeof parsed === 'object' ? parsed : {}
  const rawFindings = Array.isArray(base.findings) ? base.findings : []
  const findings = rawFindings.slice(0, 6).map((finding, index) => {
    const evidenceNeed = normalizeEvidenceNeed(finding?.evidenceNeed)
    return {
      id: finding?.id || `F${index + 1}`,
      category: finding?.category || 'other',
      severity: finding?.severity || 'watch',
      severityColor: finding?.severityColor || 'yellow',
      toothFDI: finding?.toothFDI ?? null,
      regionEN: finding?.regionEN || 'Visual review area',
      regionFA: finding?.regionFA || 'ناحیه قابل بررسی',
      labelEN: finding?.labelEN || 'Visual review finding',
      labelFA: finding?.labelFA || 'یافته قابل بررسی',
      doctorNoteEN: finding?.doctorNoteEN || 'Dentist review required.',
      doctorNoteFA: finding?.doctorNoteFA || 'بررسی دندانپزشک لازم است.',
      patientTextEN: finding?.patientTextEN || 'Your dentist may review this area with you.',
      patientTextFA: finding?.patientTextFA || 'دندانپزشک این ناحیه را با شما مرور می‌کند.',
      confidence: normalizeConfidence(finding?.confidence),
      evidenceLevel: ['A', 'B', 'C'].includes(finding?.evidenceLevel) ? finding.evidenceLevel : 'B',
      evidenceNeed,
      visibleToPatient: false,
      requiresDoctorReview: Boolean(finding?.requiresDoctorReview ?? true),
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
          : 'A focused PA image may improve confidence.',
      reasonFA: finding.evidenceNeed === 'bitewing_recommended'
        ? 'نمای bitewing می‌تواند دقت بررسی را بیشتر کند.'
        : finding.evidenceNeed === 'clinical_exam_required'
          ? 'معاینه کلینیکی پیش از توضیح نهایی به بیمار توصیه می‌شود.'
          : 'تصویر PA می‌تواند دقت بررسی را بیشتر کند.',
      priority: finding.evidenceNeed === 'clinical_exam_required' || finding.severityColor === 'red' ? 'important' : 'recommended',
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
