import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

// --- HELPER: Clean LLM Output ---
function cleanLLMOutput(text: string): string {
  return text
    .replace(/```html/gi, "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

// Initialize LLM (Gemini 2.5 Flash)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

// --- ARCHITECT AGENT ---
// Takes user request and generates a technical specification
export async function runArchitect(userRequest: string): Promise<string> {
  const prompt = `
    You are a Software Architect designing a website.
    
    USER REQUEST:
    "${userRequest}"
    
    Task: Create a detailed technical specification for building this website.
    
    Output a structured specification including:
    - Business type and purpose
    - Recommended color palette (hex codes)
    - Required sections (hero, features, contact, etc.)
    - Detailed technical instructions for a developer
    - Any specific design elements or interactions
    
    Be specific and detailed. The developer will use this spec to build the site.
    Output plain text, no JSON formatting required.
  `;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

// --- BUILDER AGENT ---
// Takes a technical spec/prompt and generates a complete HTML website
export async function runBuilder(technicalSpec: string): Promise<string> {
  const prompt = `
    You are an Expert Web Developer.
    
    TECHNICAL SPECIFICATION:
    ${technicalSpec}
    
    Task: Write a SINGLE, COMPLETE HTML file containing all CSS (Tailwind via CDN) and JS inline.
    
    Requirements:
    - Include <!DOCTYPE html> and proper HTML5 structure
    - Use <script src="https://cdn.tailwindcss.com"></script>
    - Include <meta name="viewport" content="width=device-width, initial-scale=1.0">
    - Ensure mobile responsiveness
    - Make the design visually stunning and modern
    - Include all necessary sections as specified
    
    CRITICAL: Return ONLY the raw HTML code. No markdown formatting, no code fences, no explanations.
  `;

  const result = await model.generateContent(prompt);
  const rawOutput = result.response.text();

  // Clean any markdown artifacts the LLM might add
  return cleanLLMOutput(rawOutput);
}