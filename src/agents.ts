import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

// Initialize LLM (Gemini 2.0 or Claude 3.7)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-thinking-exp" });

// --- AGENT 1: ARCHITECT ---
export async function runArchitect(userRequest: string) {
    const prompt = `
    You are a Software Architect.
    User Request: "${userRequest}"
    
    Output a JSON object ONLY with this structure:
    {
      "business_type": "string",
      "color_palette": ["hex1", "hex2"],
      "sections": ["hero", "features", "contact"],
      "technical_spec": "string (detailed instructions for the developer)"
    }
  `;
    const result = await model.generateContent(prompt);
    return result.response.text(); // Returns the JSON spec
}

// --- AGENT 2: BUILDER ---
export async function runBuilder(spec: string, feedback: string = "") {
    const prompt = `
    You are an Expert Web Developer.
    SPEC: ${spec}
    FEEDBACK FROM PREVIOUS AUDIT: ${feedback ? feedback : "None (First draft)"}
    
    Task: Write a SINGLE HTML file containing all CSS (Tailwind via CDN) and JS.
    - Use <script src="https://cdn.tailwindcss.com"></script>
    - Ensure it is mobile responsive.
    - RETURN ONLY THE RAW HTML CODE. No markdown formatting.
  `;
    const result = await model.generateContent(prompt);
    let code = result.response.text();
    // Cleanup: remove markdown ticks if the LLM adds them
    return code.replace(/```html/g, "").replace(/```/g, "");
}

// --- AGENT 3: AUDITOR ---
export async function runAuditor(htmlCode: string) {
    const prompt = `
    You are a QA Engineer. Audit this code.
    CODE: ${htmlCode.substring(0, 15000)}... (truncated for context)
    
    Check for:
    1. <meta name="viewport"> tag (Mobile Responsiveness).
    2. Tailwind script tag.
    3. At least 3 distinct sections.
    
    Output JSON ONLY:
    {
      "passed": boolean,
      "issues": "string (concise list of what to fix, or 'None' if passed)"
    }
  `;
    const result = await model.generateContent(prompt);
    return JSON.parse(result.response.text());
}