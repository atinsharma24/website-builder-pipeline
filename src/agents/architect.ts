import { GoogleGenerativeAI } from "@google/generative-ai";
import type { BusinessInput } from "../schemas/business-input.js";
import type { ArchitectOutput } from "../schemas/architect-output.js";
import "dotenv/config";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);
const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || "gemini-3-flash-preview",
});

/**
 * Architect Agent
 * Takes structured business input and generates a comprehensive website generation prompt
 */
export async function runArchitect(
    input: BusinessInput
): Promise<ArchitectOutput> {
    const photosSection =
        input.photos.length > 0
            ? `\n## Provided Photos:\n${input.photos.map((p, i) => `${i + 1}. ${p.url}${p.alt ? ` (${p.alt})` : ""}`).join("\n")}`
            : "\n## Photos: None provided - use professional placeholder images from picsum.photos or similar.";

    const hoursSection = input.hours
        ? `\n## Business Hours:\n${Object.entries(input.hours)
            .map(([day, time]) => `- ${day}: ${time}`)
            .join("\n")}`
        : "";

    const prompt = `You are an expert Website Architect specializing in creating stunning, conversion-optimized business websites.

## Business Information
- **Name**: ${input.business_name}
- **Category**: ${input.business_category}
- **Owner**: ${input.owner_name}
- **Location**: ${input.address}, ${input.city}, ${input.state}
${input.phone ? `- **Phone**: ${input.phone}` : ""}
${input.email ? `- **Email**: ${input.email}` : ""}
${input.website ? `- **Website**: ${input.website}` : ""}

## Business Description
${input.description}
${photosSection}
${hoursSection}

## Your Task
Create a detailed, production-ready website specification that will guide a web developer to create an absolutely STUNNING, CHARMING, and LUCRATIVE website for this business. The design must be so impressive that the business owner is WOWED at first sight.

## Output Format (JSON)
Return a JSON object with this exact structure:
{
  "website_generation_prompt": "A comprehensive prompt (500+ words) with detailed instructions for building the website",
  "site_style_guidelines": {
    "primary_color": "#hex",
    "secondary_color": "#hex",
    "accent_color": "#hex",
    "font_heading": "Font Name",
    "font_body": "Font Name",
    "tone": "professional|friendly|luxury|minimal|playful",
    "layout": "single-page|multi-section|split-hero"
  },
  "page_sections": [
    { "section_id": "hero", "section_name": "Hero Section", "copy_hints": "specific copy guidance", "required": true }
  ]
}

## Design Requirements to Include in Your Prompt
1. **Visual Impact**: The design must be jaw-dropping. Use bold colors, gradients, glassmorphism, or modern design trends appropriate for the business category.
2. **Professional Animations**: Include scroll-triggered animations, hover effects, subtle micro-interactions, and smooth transitions that feel premium.
3. **Charming Elements**: Add personality through custom icons, decorative elements, or unique typography treatments.
4. **Trust Signals**: Include testimonials, certifications, years of experience, or social proof strategically placed.
5. **Strong CTAs**: Every section should guide the user toward contacting or visiting the business.
6. **Mobile-First**: Design must be flawless on mobile devices.
7. **Performance**: Use efficient CSS animations, lazy loading hints for images.

Return ONLY the JSON object, no additional text.`;

    const result = await model.generateContent(prompt);
    const rawOutput = result.response.text();

    // Clean and parse JSON
    const cleanedOutput = rawOutput
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

    try {
        const parsed = JSON.parse(cleanedOutput) as ArchitectOutput;
        return parsed;
    } catch {
        // If JSON parsing fails, wrap the output as a prompt
        return {
            website_generation_prompt: cleanedOutput,
        };
    }
}

/**
 * Mock Architect Agent (for testing without LLM)
 */
export function mockArchitect(input: BusinessInput): ArchitectOutput {
    return {
        website_generation_prompt: `
Create a breathtaking, conversion-focused website for "${input.business_name}" - a ${input.business_category} business in ${input.city}, ${input.state}.

## Business Profile
- **Name**: ${input.business_name}
- **Owner**: ${input.owner_name}
- **Specialty**: ${input.business_category}
- **Story**: ${input.description}
- **Location**: ${input.address}, ${input.city}, ${input.state}
${input.phone ? `- **Phone**: ${input.phone}` : ""}
${input.email ? `- **Email**: ${input.email}` : ""}

## Design Vision
Create an ABSOLUTELY STUNNING, modern website that makes the business owner say "WOW!" The design should feel premium, trustworthy, and conversion-optimized.

## Required Sections

### 1. HERO SECTION
- Full-viewport height with striking visual impact
- Large, bold business name with animated text reveal
- Compelling tagline that communicates value
- Prominent CTA button with hover animation (glow effect)
- Background: Either a stunning gradient, subtle pattern, or hero image with overlay
- Floating decorative elements or animated shapes for visual interest

### 2. ABOUT / OUR STORY
- Split layout: Image on one side, content on other
- Owner's name and photo placeholder
- Years of experience / establishment highlighted
- Trust badges or certifications
- Fade-in animation on scroll

### 3. SERVICES / WHAT WE OFFER
- Card-based layout with hover lift effects
- Icons for each service (use emoji or SVG icons)
- Brief descriptions optimized for scanning
- Staggered animation on scroll

### 4. GALLERY / SHOWCASE
- ${input.photos.length > 0 ? `Use provided ${input.photos.length} photos` : "Use 6 placeholder images from picsum.photos"}
- Masonry or grid layout
- Lightbox-style hover effect
- Smooth image transitions

### 5. TESTIMONIALS
- 3 customer testimonials with Indian names
- Star ratings
- Profile photo placeholders
- Carousel or stacked cards with animations

### 6. CONTACT SECTION
- Business address prominently displayed
- Phone number (click-to-call on mobile)
- Simple contact form (name, email, message)
- Operating hours if provided
- Embedded map placeholder

### 7. FOOTER
- Business name and copyright
- Quick links to sections
- Social media icon placeholders
- Back-to-top button with smooth scroll

## Animation Requirements
- Hero text: Fade-in and slide-up on load
- Sections: Fade-in with translateY on scroll
- Cards: Hover scale + shadow increase
- Buttons: Subtle pulse or glow on hover
- Images: Ken Burns effect on hero, zoom on gallery hover
- Use CSS animations and minimal JavaScript

## Technical Requirements
- Single HTML file with inline CSS
- Tailwind CSS via CDN
- Mobile-first responsive design
- Semantic HTML5 structure
- SEO meta tags (title, description, OG tags)
- Smooth scrolling navigation
- Accessibility: alt text, proper contrast, focus states
`,
        site_style_guidelines: {
            primary_color: "#2563eb",
            secondary_color: "#f8fafc",
            accent_color: "#f59e0b",
            font_heading: "Playfair Display",
            font_body: "Inter",
            tone: "professional",
            layout: "single-page",
        },
        page_sections: [
            {
                section_id: "hero",
                section_name: "Hero Banner",
                copy_hints: "Business name, tagline, primary CTA",
                required: true,
            },
            {
                section_id: "about",
                section_name: "Our Story",
                copy_hints: "Owner intro, business history, values",
                required: true,
            },
            {
                section_id: "services",
                section_name: "Services",
                copy_hints: "3-6 service cards with icons",
                required: true,
            },
            {
                section_id: "gallery",
                section_name: "Gallery",
                copy_hints: "Photo grid with hover effects",
                required: true,
            },
            {
                section_id: "testimonials",
                section_name: "Testimonials",
                copy_hints: "3 reviews with ratings",
                required: true,
            },
            {
                section_id: "contact",
                section_name: "Contact Us",
                copy_hints: "Address, form, hours",
                required: true,
            },
            {
                section_id: "footer",
                section_name: "Footer",
                copy_hints: "Links, social, copyright",
                required: true,
            },
        ],
    };
}
