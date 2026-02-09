import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

// --- TYPES ---
export interface BusinessInput {
  businessName: string;
  address: string;
  city: string;
  state: string;
  ownerName: string;
  category: string;
  description: string;
  photos: string[];
}

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
// Takes structured business input and generates a detailed technical specification
export async function runArchitect(input: BusinessInput): Promise<string> {
  const prompt = `
    You are an Expert Website Architect specializing in high-conversion business websites.
    
    BUSINESS INFORMATION:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    • Business Name: ${input.businessName}
    • Owner: ${input.ownerName}
    • Category: ${input.category}
    • Location: ${input.address}, ${input.city}, ${input.state}
    • Description: ${input.description}
    • Available Photos: ${input.photos.length > 0 ? input.photos.join(", ") : "Use professional placeholder images"}
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    YOUR TASK: Create an extremely detailed technical specification for a STUNNING, HIGH-CONVERSION website.
    
    The specification MUST include:
    
    1. **COLOR PALETTE** (Hex codes)
       - Primary, secondary, accent colors matching the business category
       - Gradient recommendations for modern appeal
    
    2. **TYPOGRAPHY**
       - Font pairing recommendations (heading + body)
       - Size hierarchy
    
    3. **HERO SECTION**
       - Compelling headline that captures attention
       - Subheadline with value proposition
       - Call-to-action button text
       - Background style (gradient, image, or pattern)
    
    4. **ABOUT SECTION**
       - Featuring ${input.ownerName}
       - Trust signals (years in business, expertise)
       - Emotional connection elements
    
    5. **SERVICES/PRODUCTS SECTION**
       - Based on ${input.category} category
       - Card layout with icons/images
       - Pricing display if applicable
    
    6. **PHOTO GALLERY**
       - Layout style (grid, masonry, carousel)
       - Lightbox functionality
    
    7. **CONTACT SECTION**
       - Address display with map suggestion
       - Contact form fields
       - Call-to-action
    
    8. **FOOTER**
       - Business info, hours, social links
    
    9. **ANIMATION REQUIREMENTS**
       - Entrance animations for each section
       - Hover effects for buttons and cards
       - Scroll-triggered reveals
       - Micro-interactions for engagement
    
    10. **MOBILE RESPONSIVENESS**
        - Breakpoint considerations
        - Touch-friendly elements
    
    Be EXTREMELY detailed. A developer will use this spec to build the exact website.
  `;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

// --- BUILDER AGENT ---
// Takes technical spec and generates a stunning, animated HTML website
export async function runBuilder(technicalSpec: string): Promise<string> {
  const prompt = `
    You are a WORLD-CLASS Web Developer known for creating BREATHTAKING websites that WIN awards.
    
    TECHNICAL SPECIFICATION:
    ${technicalSpec}
    
    YOUR MISSION: Create an ABSOLUTELY STUNNING website that will make the business owner say "WOW!"
    
    ═══════════════════════════════════════════════════════════════════════
    MANDATORY REQUIREMENTS:
    ═══════════════════════════════════════════════════════════════════════
    
    1. **STRUCTURE**
       - Single, complete index.html file
       - All CSS and JS inline (no external files except CDNs)
       - Use: <script src="https://cdn.tailwindcss.com"></script>
       - Add: <link href="https://unpkg.com/aos@2.3.1/dist/aos.css" rel="stylesheet">
       - Add: <script src="https://unpkg.com/aos@2.3.1/dist/aos.js"></script>
    
    2. **VISUAL DESIGN** (Make it LUXURIOUS)
       - Rich, vibrant color gradients
       - Glassmorphism effects where appropriate
       - Smooth shadows and depth
       - Professional typography with Google Fonts
       - High-quality placeholder images from Unsplash
    
    3. **ANIMATIONS** (Make it ALIVE)
       - AOS (Animate On Scroll) for section reveals
       - CSS transitions on ALL interactive elements
       - Hover effects: scale, glow, color shifts
       - Button animations: pulse, ripple effects
       - Image hover: zoom, overlay reveals
       - Smooth scrolling behavior
       - Loading animations for visual polish
    
    4. **PROFESSIONAL TOUCHES**
       - Floating action buttons
       - Sticky navigation with blur backdrop
       - Gradient text for headlines
       - Icon integration (use emoji or Heroicons via CDN)
       - Card hover lift effects
       - Testimonial carousel/slider
       - Animated counters for statistics
    
    5. **MOBILE EXPERIENCE**
       - Hamburger menu with smooth animation
       - Touch-optimized tap targets
       - Responsive images and text
       - No horizontal scroll
    
    6. **FOOTER**
       - Professional business info layout
       - Social media icons with hover effects
       - Animated "Back to Top" button
    
    ═══════════════════════════════════════════════════════════════════════
    CRITICAL INSTRUCTIONS:
    ═══════════════════════════════════════════════════════════════════════
    
    - Output ONLY raw HTML code
    - NO markdown, NO code fences, NO explanations
    - Include AOS.init() call at the bottom
    - Make EVERY section visually impressive
    - The business owner should feel PROUD showing this website
    
    BEGIN GENERATING THE WEBSITE NOW:
  `;

  const result = await model.generateContent(prompt);
  const rawOutput = result.response.text();

  // Clean any markdown artifacts the LLM might add
  return cleanLLMOutput(rawOutput);
}