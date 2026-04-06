// services/geminiService.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
const crypto = require("crypto");
const { getOrSetCache } = require("./cacheService");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
const AI_CACHE_TTL_MS = 10 * 60 * 1000;

function hashValue(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function validateThesisText(text) {
  try {
    const cacheKey = `thesis:${hashValue(text)}`;
    return await getOrSetCache(cacheKey, AI_CACHE_TTL_MS, async () => {
      const prompt = `You are checking whether a PDF is a thesis, dissertation, capstone, or formal academic research manuscript.
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
}`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const cleanJson = response.text().replace(/```json|```/g, "").trim();
      return JSON.parse(cleanJson);
    });
  } catch (err) {
    console.error("Gemini Thesis Validation Error:", err);
    throw err;
  }
}

async function summarizeText(text, options = {}) {
  try {
    const { length, style, format, focusArea, includeKeywords, includeHighlights, includeCitations } = options;
    const cacheKey = `summary:${hashValue(JSON.stringify({ text, length, style, format, focusArea, includeKeywords, includeHighlights, includeCitations }))}`;

    return await getOrSetCache(cacheKey, AI_CACHE_TTL_MS, async () => {
      const keywordInstruction = includeKeywords
        ? "Extract 5-8 relevant keywords."
        : "Return an empty keywords array.";
      const highlightInstruction = includeHighlights
        ? "Include 3-5 short highlight points capturing the most important ideas."
        : "Return an empty highlights array.";
      const citationInstruction = includeCitations
        ? "Include 2-5 probable APA-style citations inferred from the document. If the source details are incomplete, provide best-effort APA references and do not invent impossible precision."
        : "Return an empty citations array.";
      const prompt = `Summarize this PDF text.
    Return the response ONLY as a valid JSON object with four keys: "summary", "keywords", "highlights", and "citations".
    
    Instructions:
    - Summary Style: ${style}
    - Summary Length: ${length}
    - Format: ${format}
    - Focus: ${focusArea}
    - Keywords: ${keywordInstruction}
    - Highlights: ${highlightInstruction}
    - Citations: ${citationInstruction}
    
    PDF Content:
    ${text}

    Example JSON Structure:
    {
      "summary": "The main text goes here...",
      "keywords": ["Keyword1", "Keyword2", "Keyword3"],
      "highlights": ["Key point one", "Key point two"],
      "citations": ["Author, A. A. (2024). Title of work. Publisher."]
    }`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const cleanJson = response.text().replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleanJson);
      return {
        summary: parsed.summary || "",
        keywords: includeKeywords && Array.isArray(parsed.keywords) ? parsed.keywords : [],
        highlights: includeHighlights && Array.isArray(parsed.highlights) ? parsed.highlights : [],
        citations: includeCitations && Array.isArray(parsed.citations) ? parsed.citations : []
      };
    });
  } catch (err) {
    console.error("Gemini Error:", err);
    throw err;
  }
}
// Ensure this exact export style
module.exports = { summarizeText, validateThesisText };
