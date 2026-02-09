import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ArchitectOutput } from "../schemas/architect-output.js";
import "dotenv/config";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);
const model = genAI.getGenerativeModel({
  model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
});

/**
 * Clean LLM output by removing markdown code fences
 */
function cleanLLMOutput(text: string): string {
  return text
    .replace(/```html/gi, "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

/**
 * Builder Agent
 * Takes an ArchitectOutput and generates a complete, stunning HTML website
 */
export async function runBuilder(spec: ArchitectOutput): Promise<string> {
  const styleGuidelines = spec.site_style_guidelines
    ? `
## Style Guidelines
- Primary Color: ${spec.site_style_guidelines.primary_color || "#2563eb"}
- Secondary Color: ${spec.site_style_guidelines.secondary_color || "#f8fafc"}
- Accent Color: ${spec.site_style_guidelines.accent_color || "#f59e0b"}
- Heading Font: ${spec.site_style_guidelines.font_heading || "Playfair Display"}
- Body Font: ${spec.site_style_guidelines.font_body || "Inter"}
- Tone: ${spec.site_style_guidelines.tone || "professional"}
- Layout: ${spec.site_style_guidelines.layout || "single-page"}
`
    : "";

  const sectionsGuide = spec.page_sections
    ? `
## Required Sections
${spec.page_sections.map((s) => `- **${s.section_name}** (${s.section_id}): ${s.copy_hints || "Standard content"}`).join("\n")}
`
    : "";

  const prompt = `You are an ELITE Web Developer known for creating visually STUNNING, JAW-DROPPING websites that make business owners say "WOW!"

## WEBSITE SPECIFICATION
${spec.website_generation_prompt}
${styleGuidelines}
${sectionsGuide}

## YOUR MISSION
Create a SINGLE, COMPLETE HTML file that is:

### 1. VISUALLY BREATHTAKING
- Use modern design trends: gradients, glassmorphism, soft shadows, rounded corners
- Rich, harmonious color palette based on the style guidelines
- Strategic use of whitespace for premium feel
- High-quality typography with Google Fonts
- Visual hierarchy that guides the eye
- Decorative elements that add charm without clutter

### 2. PROFESSIONALLY ANIMATED
Include these animations (CSS-only where possible):

**On Page Load:**
- Hero text: Graceful fade-in with slide-up (0.6s ease-out)
- Hero image/background: Subtle zoom or Ken Burns effect
- Navigation: Gentle slide-down

**On Scroll (use Intersection Observer):**
- Sections: Fade-in with translateY(30px) to translateY(0)
- Cards: Staggered entrance (each card delays 0.1s after previous)
- Stats/numbers: Count-up animation if applicable

**On Hover:**
- Buttons: Scale(1.05), shadow increase, subtle glow
- Cards: Lift effect (translateY(-8px)), enhanced shadow
- Images: Gentle zoom (scale 1.05), slight brightness increase
- Links: Smooth color transition, underline animation

**Micro-interactions:**
- Smooth scroll between sections
- Active nav link highlighting on scroll
- Back-to-top button appears after scrolling

### 3. TECHNICALLY EXCELLENT
- \`<!DOCTYPE html>\` with proper HTML5 structure
- \`<meta charset="UTF-8">\` and \`<meta name="viewport" content="width=device-width, initial-scale=1.0">\`
- SEO tags: title, description, Open Graph tags
- Tailwind CSS via CDN: \`<script src="https://cdn.tailwindcss.com"></script>\`
- Google Fonts via link tag
- All CSS in a \`<style>\` block in \`<head>\`
- All JavaScript in a \`<script>\` block before \`</body>\`
- Mobile-first responsive design (works perfectly on all devices)
- Semantic HTML (header, nav, main, section, article, footer)
- Accessibility: alt text, ARIA labels, focus states, proper contrast

### 4. CONVERSION-OPTIMIZED
- Clear, compelling CTAs in hero and throughout
- Trust signals prominently displayed
- Easy-to-find contact information
- Simple, inviting contact form
- Phone number clickable on mobile

## ANIMATION CSS TEMPLATE
\`\`\`css
/* Animation Keyframes */
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(30px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-20px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 20px rgba(var(--accent-rgb), 0.4); }
  50% { box-shadow: 0 0 40px rgba(var(--accent-rgb), 0.6); }
}

/* Animation Classes */
.animate-fade-in-up {
  animation: fadeInUp 0.6s ease-out forwards;
}

.animate-on-scroll {
  opacity: 0;
  transform: translateY(30px);
  transition: all 0.6s ease-out;
}

.animate-on-scroll.visible {
  opacity: 1;
  transform: translateY(0);
}

/* Hover Effects */
.hover-lift {
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.hover-lift:hover {
  transform: translateY(-8px);
  box-shadow: 0 20px 40px rgba(0,0,0,0.1);
}

.btn-glow:hover {
  animation: pulse-glow 2s infinite;
}
\`\`\`

## INTERSECTION OBSERVER TEMPLATE
\`\`\`javascript
// Scroll Animations
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.animate-on-scroll').forEach((el) => observer.observe(el));

// Smooth scroll for navigation
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    document.querySelector(this.getAttribute('href')).scrollIntoView({ behavior: 'smooth' });
  });
});
\`\`\`

## CRITICAL RULES
1. Return ONLY the raw HTML code - no markdown, no code fences, no explanations
2. The HTML must be complete and self-contained
3. All images should use placeholder services (picsum.photos, placehold.co, or ui-avatars.com for testimonial photos)
4. Include at least 3 testimonials with Indian names (e.g., Priya Sharma, Raj Patel, Ananya Gupta)
5. Make the design feel PREMIUM and EXPENSIVE
6. The business owner should be IMPRESSED and feel proud of their website

NOW CREATE THE WEBSITE. OUTPUT ONLY THE HTML CODE.`;

  const result = await model.generateContent(prompt);
  const rawOutput = result.response.text();

  return cleanLLMOutput(rawOutput);
}

/**
 * Mock Builder Agent (for testing without LLM)
 * Returns a minimal but styled HTML template
 */
export function mockBuilder(spec: ArchitectOutput): string {
  const colors = spec.site_style_guidelines || {
    primary_color: "#2563eb",
    secondary_color: "#f8fafc",
    accent_color: "#f59e0b",
    font_heading: "Playfair Display",
    font_body: "Inter",
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mock Generated Website</title>
    <meta name="description" content="A professionally generated business website">
    <meta property="og:title" content="Mock Generated Website">
    <meta property="og:description" content="A professionally generated business website">
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=${(colors.font_heading || "Playfair+Display").replace(/ /g, "+")}:wght@400;700&family=${(colors.font_body || "Inter").replace(/ /g, "+")}:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: ${colors.primary_color || "#2563eb"};
            --secondary: ${colors.secondary_color || "#f8fafc"};
            --accent: ${colors.accent_color || "#f59e0b"};
        }
        body { font-family: '${colors.font_body || "Inter"}', sans-serif; }
        h1, h2, h3 { font-family: '${colors.font_heading || "Playfair Display"}', serif; }
        @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(30px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in-up { animation: fadeInUp 0.8s ease-out forwards; }
        .hover-lift { transition: transform 0.3s, box-shadow 0.3s; }
        .hover-lift:hover { transform: translateY(-8px); box-shadow: 0 20px 40px rgba(0,0,0,0.1); }
    </style>
</head>
<body class="bg-white">
    <!-- MOCK WEBSITE - Generated for Testing -->
    <header class="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-600 to-purple-700 text-white">
        <div class="text-center animate-fade-in-up">
            <h1 class="text-5xl md:text-7xl font-bold mb-4">Mock Website</h1>
            <p class="text-xl md:text-2xl mb-8 opacity-90">This is a test-generated website</p>
            <a href="#contact" class="inline-block bg-amber-500 text-white px-8 py-4 rounded-full font-semibold hover-lift">
                Get Started
            </a>
        </div>
    </header>
    
    <main class="container mx-auto px-4 py-16">
        <section id="about" class="py-16">
            <h2 class="text-4xl font-bold text-center mb-8">About Us</h2>
            <p class="text-lg text-gray-600 text-center max-w-2xl mx-auto">
                This is a mock website generated for testing the pipeline. 
                In production, this would contain real business information.
            </p>
        </section>
        
        <section id="contact" class="py-16 bg-gray-50 rounded-2xl p-8">
            <h2 class="text-4xl font-bold text-center mb-8">Contact Us</h2>
            <form class="max-w-md mx-auto space-y-4">
                <input type="text" placeholder="Your Name" class="w-full px-4 py-3 rounded-lg border focus:ring-2 focus:ring-blue-500">
                <input type="email" placeholder="Your Email" class="w-full px-4 py-3 rounded-lg border focus:ring-2 focus:ring-blue-500">
                <textarea placeholder="Your Message" rows="4" class="w-full px-4 py-3 rounded-lg border focus:ring-2 focus:ring-blue-500"></textarea>
                <button type="submit" class="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors">
                    Send Message
                </button>
            </form>
        </section>
    </main>
    
    <footer class="bg-gray-900 text-white py-8 text-center">
        <p>&copy; ${new Date().getFullYear()} Mock Business. All rights reserved.</p>
        <p class="text-sm text-gray-400 mt-2">Generated by Website Pipeline</p>
    </footer>
</body>
</html>`;
}
