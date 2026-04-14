const { GoogleGenerativeAI } = require("@google/generative-ai");
const crypto = require("crypto");
const { getOrSetCache } = require("./cacheService");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
const AI_CACHE_TTL_MS = 10 * 60 * 1000;

function hashValue(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stripJsonFence(text) {
  return String(text || "").replace(/```json|```/gi, "").trim();
}

async function generateJson(cacheKey, prompt) {
  return getOrSetCache(cacheKey, AI_CACHE_TTL_MS, async () => {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return JSON.parse(stripJsonFence(response.text()));
  });
}

async function validateThesisText(text) {
  try {
    const cacheKey = `thesis:${hashValue(text)}`;
    return await generateJson(
      cacheKey,
      `You are checking whether a PDF is a thesis, dissertation, capstone, or formal academic research manuscript.
Return ONLY valid JSON with keys "isThesis" and "reason".

Rules:
- Mark isThesis true only if the text strongly looks like a thesis/dissertation/capstone/research paper.
- Mark isThesis false for resumes, invoices, letters, forms, slides, manuals, casual notes, or unrelated documents.
- Keep "reason" brief and user-friendly.

PDF Content:
${text}

Example JSON Structure:
{
  "isThesis": true,
  "reason": "The document includes academic research sections such as abstract, methodology, and references."
}`
    );
  } catch (err) {
    console.error("Gemini Thesis Validation Error:", err);
    throw err;
  }
}

async function summarizeText(text, options = {}) {
  try {
    const {
      length,
      style,
      format,
      focusArea,
      includeBreakdown,
      includeKeywords,
      includeHighlights,
      includeCitations
    } = options;

    const cacheKey = `summary:${hashValue(JSON.stringify({
      text,
      length,
      style,
      format,
      focusArea,
      includeBreakdown,
      includeKeywords,
      includeHighlights,
      includeCitations
    }))}`;

    const parsed = await generateJson(
      cacheKey,
      `Summarize this thesis text and extract a structured thesis profile.
Return the response ONLY as a valid JSON object with these keys:
"summary", "keywords", "highlights", "citations", and "thesisBreakdown".

Instructions:
- Summary Style: ${style}
- Summary Length: ${length}
- Format: ${format}
- Focus: ${focusArea || "overall thesis"}
- The summary must reflect thesis sections such as context, method, and findings when present.
- If includeKeywords is ${Boolean(includeKeywords)}, return 5-8 relevant keywords. Otherwise return an empty array.
- If includeHighlights is ${Boolean(includeHighlights)}, return 3-5 short highlight points. Otherwise return an empty array.
- If includeCitations is ${Boolean(includeCitations)}, return 2-5 probable APA-style citations inferred from the document when possible. Otherwise return an empty array.
- Always return a "thesisBreakdown" object even if some fields are unavailable.
- Keep unavailable breakdown fields as an empty string or empty array.
- Never invent precise facts that are not reasonably supported by the text.

The "thesisBreakdown" object must use exactly these keys:
- title
- authors
- institution
- year
- abstract
- problemStatement
- objectives
- methodology
- participants
- instruments
- findings
- limitations
- recommendations
- researchGaps

PDF Content:
${text}

Example JSON Structure:
{
  "summary": "The thesis investigates...",
  "keywords": ["cloud computing", "document analysis"],
  "highlights": ["The study used...", "The main findings show..."],
  "citations": ["Author, A. A. (2024). Title of work. Publisher."],
  "thesisBreakdown": {
    "title": "Sample Thesis Title",
    "authors": ["Author One"],
    "institution": "Sample University",
    "year": "2024",
    "abstract": "Brief abstract",
    "problemStatement": "Problem statement",
    "objectives": ["Objective 1"],
    "methodology": "Method summary",
    "participants": "Participant summary",
    "instruments": "Instrument summary",
    "findings": ["Finding 1"],
    "limitations": ["Limitation 1"],
    "recommendations": ["Recommendation 1"],
    "researchGaps": ["Gap 1"]
  }
}`
    );

      return {
        summary: parsed.summary || "",
        keywords: includeKeywords && Array.isArray(parsed.keywords) ? parsed.keywords : [],
        highlights: includeHighlights && Array.isArray(parsed.highlights) ? parsed.highlights : [],
        citations: includeCitations && Array.isArray(parsed.citations) ? parsed.citations : [],
        thesisBreakdown: normalizeBreakdown(parsed.thesisBreakdown)
      };
  } catch (err) {
    console.error("Gemini Error:", err);
    throw err;
  }
}

function normalizeBreakdown(input = {}) {
  const asArray = (value) => Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  return {
    title: String(input.title || "").trim(),
    authors: asArray(input.authors),
    institution: String(input.institution || "").trim(),
    year: String(input.year || "").trim(),
    abstract: String(input.abstract || "").trim(),
    problemStatement: String(input.problemStatement || "").trim(),
    objectives: asArray(input.objectives),
    methodology: String(input.methodology || "").trim(),
    participants: String(input.participants || "").trim(),
    instruments: String(input.instruments || "").trim(),
    findings: asArray(input.findings),
    limitations: asArray(input.limitations),
    recommendations: asArray(input.recommendations),
    researchGaps: asArray(input.researchGaps)
  };
}

function buildDocumentDigest(upload) {
  return {
    id: String(upload._id),
    title: upload.thesisBreakdown?.title || upload.originalname || "",
    filename: upload.originalname || upload.filename || "",
    summary: upload.summary || "",
    keywords: upload.keywords || [],
    thesisBreakdown: normalizeBreakdown(upload.thesisBreakdown || {})
  };
}

async function compareTheses(documents = [], focus = "") {
  const digests = documents.map(buildDocumentDigest);
  const cacheKey = `compare:${hashValue(JSON.stringify({ digests, focus }))}`;

  return generateJson(
    cacheKey,
    `Compare these thesis documents for a student doing literature review work.
Return ONLY valid JSON with these keys:
"overview", "similarities", "differences", "methodologyComparison", "recommendedPositioning".

Instructions:
- Focus area: ${focus || "overall comparison"}
- "overview" should be a short paragraph.
- "similarities", "differences", and "recommendedPositioning" must be arrays of concise strings.
- "methodologyComparison" should be an array of objects with keys "title", "methodology", and "notableFinding".
- Base your answer only on the supplied thesis digests.

Thesis Digests:
${JSON.stringify(digests, null, 2)}`
  );
}

async function findResearchGaps(documents = [], focus = "") {
  const digests = documents.map(buildDocumentDigest);
  const cacheKey = `gaps:${hashValue(JSON.stringify({ digests, focus }))}`;

  return generateJson(
    cacheKey,
    `Identify promising research gaps across these thesis digests.
Return ONLY valid JSON with these keys:
"overview", "repeatedThemes", "underexploredAreas", "futureStudyIdeas", "cautions".

Instructions:
- Focus area: ${focus || "overall research landscape"}
- All list-style fields must be arrays of concise strings.
- Keep ideas actionable for students choosing a thesis topic.
- Do not claim certainty beyond the supplied evidence.

Thesis Digests:
${JSON.stringify(digests, null, 2)}`
  );
}

async function prepareDefense(upload, emphasis = "") {
  const digest = buildDocumentDigest(upload);
  const cacheKey = `defense:${hashValue(JSON.stringify({ digest, emphasis }))}`;

  return generateJson(
    cacheKey,
    `Prepare a thesis defense brief for this thesis digest.
Return ONLY valid JSON with these keys:
"overview", "panelQuestions", "vulnerabilities", "suggestedAnswers", "presentationTips".

Instructions:
- Emphasis: ${emphasis || "balanced panel preparation"}
- "panelQuestions", "vulnerabilities", "suggestedAnswers", and "presentationTips" must be arrays of concise strings.
- Questions should sound like realistic panel questions.
- Suggested answers should be short but defensible.
- Use only the provided digest.

Thesis Digest:
${JSON.stringify(digest, null, 2)}`
  );
}

module.exports = {
  compareTheses,
  findResearchGaps,
  prepareDefense,
  summarizeText,
  validateThesisText
};
