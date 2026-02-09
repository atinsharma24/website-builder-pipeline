import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";
import { CATEGORY_DESIGNS } from "./types.js";
import type { BusinessInput, DesignConfig } from "./types.js";

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

// --- Helper: Get Design Config ---
function getDesignConfig(category: string): DesignConfig {
  return CATEGORY_DESIGNS[category as keyof typeof CATEGORY_DESIGNS] || CATEGORY_DESIGNS.other;
}

// --- Helper: Format Photos for Prompt ---
function formatPhotos(photos: string[]): string {
  if (!photos || photos.length === 0) {
    return "No photos provided - use high-quality placeholder images from Unsplash or similar.";
  }
  return photos.map((url, i) => `  ${i + 1}. ${url}`).join("\n");
}

// --- ARCHITECT AGENT (Enhanced) ---
// Takes structured business input and generates a comprehensive technical specification
export async function runArchitect(businessData: BusinessInput): Promise<string> {
  const design = getDesignConfig(businessData.business_category);

  const prompt = `
You are an Elite Website Architect specializing in creating conversion-optimized, visually stunning business websites.

# CLIENT BRIEF

## Business Information
- **Business Name:** ${businessData.business_name}
- **Owner:** ${businessData.owner_name}
- **Category:** ${businessData.business_category.replace(/_/g, " ").toUpperCase()}
- **Location:** ${businessData.address}, ${businessData.city}, ${businessData.state}
${businessData.phone ? `- **Phone:** ${businessData.phone}` : ""}
${businessData.email ? `- **Email:** ${businessData.email}` : ""}
${businessData.whatsapp ? `- **WhatsApp:** ${businessData.whatsapp}` : ""}
${businessData.hours ? `- **Hours:** ${businessData.hours}` : ""}

## Business Description
${businessData.description}

## Available Photos
${formatPhotos(businessData.photos)}

---

# YOUR TASK

Generate a **COMPREHENSIVE WEBSITE SPECIFICATION** that a developer will use to build a single-page, production-ready HTML website.

## Design System (Based on Industry: ${businessData.business_category})

### Color Palette
- **Primary:** ${design.primaryColor} (main brand color)
- **Secondary:** ${design.secondaryColor} (accents, CTAs)
- **Accent:** ${design.accentColor} (highlights, hover states)
- **Background:** Use gradients, dark/light modes as appropriate
- **Text:** Ensure WCAG AA contrast ratios

### Typography
- **Headings:** ${design.fontHeading} (Google Fonts)
- **Body:** ${design.fontBody} (Google Fonts)
- Use responsive font sizing (clamp or viewport units)

### Design Philosophy
${design.designPhilosophy}

---

## Required Sections (In Order)

${design.sections.map((section, i) => `
### ${i + 1}. ${section.toUpperCase()} Section
Provide specific requirements for this section including:
- Layout structure (grid, flex, positioning)
- Content recommendations
- Visual elements (icons, images, gradients)
- Interactive elements (hover effects, animations)
- Mobile adaptations
`).join("")}

---

## Technical Requirements

### Must Include
1. **Mobile-First Responsive Design** - Breakpoints at 640px, 768px, 1024px
2. **Smooth Scroll Animations** - Use CSS transitions or lightweight JS
3. **Lazy Loading** for images
4. **Floating WhatsApp CTA** (if WhatsApp provided) or Contact button
5. **Google Fonts Integration**
6. **SEO Meta Tags** (title, description, OpenGraph)
7. **Microdata/Schema.org** for local business

### Performance
- Use efficient CSS (avoid bloat)
- Optimize for Core Web Vitals
- Inline critical CSS

### Accessibility
- ARIA labels where needed
- Keyboard navigation support
- Color contrast compliance

---

## Content Guidelines

### Headlines
Write compelling, benefit-focused headlines for each section. Be specific to ${businessData.business_name}.

### Call-to-Actions
- Primary CTA: "Book Now" / "Contact Us" / "Get Quote" (industry appropriate)
- Secondary CTAs throughout the page
- Urgency/scarcity elements where appropriate

### Trust Signals
- Years in business
- Customer count
- Certifications/awards
- Testimonials (generate realistic examples if not provided)

---

## Output Format

Structure your specification as:

1. **DESIGN OVERVIEW** - Summary of visual approach
2. **SECTION-BY-SECTION BREAKDOWN** - Detailed specs for each section
3. **COMPONENT SPECIFICATIONS** - Buttons, cards, navigation, footer
4. **RESPONSIVE BEHAVIOR** - Mobile adaptations
5. **ANIMATION SPECIFICATIONS** - Entry animations, hover states
6. **SEO & METADATA** - Complete meta tag requirements

Be extremely detailed. The developer should be able to build the entire website from your specification without asking questions.
`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

// --- BUILDER AGENT ---
// Takes a technical spec/prompt and generates a complete HTML website
// NOTE: In the hybrid pipeline, the Antigravity Agent replaces this function
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

// --- Legacy function for backward compatibility ---
export async function runArchitectLegacy(userRequest: string): Promise<string> {
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