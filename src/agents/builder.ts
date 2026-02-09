import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ArchitectOutput } from "../schemas/architect-output.js";
import "dotenv/config";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);
const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || "gemini-3-flash-preview",
});

/**
 * Clean LLM Output
 */
function cleanLLMOutput(text: string): string {
    return text
        .replace(/```html/gi, "")
        .replace(/```/g, "")
        .trim();
}

// ---------------------------------------------------------------------------
// 1. THE MASTER TEMPLATE (temp1.html)
// We embed this directly so the AI can modify it.
// ---------------------------------------------------------------------------
const MASTER_TEMPLATE = `<!doctype html>
<html lang="en" data-theme="light">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Verve West — Fashion Retail Portfolio (HTML Only)</title>
    <meta name="description" content="Verve West is a modern fashion retail portfolio template." />
    <meta name="theme-color" content="#fffaf5" />
    <style>
        /* ===============================
           Design System
        =============================== */
        :root {
            --bg: #fffaf5;
            --bg-elev: #ffffff;
            --bg-soft: #fff2ea;
            --text: #241a16;
            --muted: #6b5c55;
            --primary: #d3543c;
            --primary-2: #b94632;
            --border: #f2e7de;
            --shadow: 0 16px 40px rgba(33, 24, 20, 0.10);
            --radius-lg: 16px;
            --radius-md: 12px;
            --radius-sm: 10px;
            --max: 1160px;
            --s1: 8px; --s2: 12px; --s3: 16px; --s4: 24px; 
            --s5: 32px; --s6: 48px; --s7: 72px;
            --focus: 0 0 0 4px rgba(211, 84, 60, 0.25);
        }
        /* Dark mode */
        html[data-theme="dark"] {
            --bg: #0f0c0b;
            --bg-elev: #151110;
            --bg-soft: #1a1412;
            --text: #f6eee9;
            --muted: #cbbcb4;
            --primary: #ff7a61;
            --primary-2: #ff5a3e;
            --border: rgba(255, 255, 255, 0.10);
            --shadow: 0 18px 46px rgba(0, 0, 0, 0.45);
            --focus: 0 0 0 4px rgba(255, 122, 97, 0.25);
        }
        /* Base */
        * { box-sizing: border-box; }
        html { scroll-behavior: smooth; }
        body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
        img { max-width: 100%; display: block; }
        a { color: inherit; text-decoration: none; }
        button, input, textarea { font: inherit; color: inherit; }
        .container { width: 100%; max-width: var(--max); margin: 0 auto; padding: 0 var(--s4); }
        .section { padding: var(--s7) 0; }
        .section.alt { background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.01)), var(--bg-elev); }
        html[data-theme="dark"] .section.alt { background: linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.03)), var(--bg-elev); }
        h1, h2, h3 { line-height: 1.15; margin: 0 0 var(--s3) 0; }
        h1 { font-size: clamp(2.2rem, 4vw, 3.25rem); letter-spacing: -0.02em; }
        h2 { font-size: clamp(1.6rem, 2.6vw, 2.1rem); letter-spacing: -0.01em; }
        h3 { font-size: clamp(1.15rem, 1.7vw, 1.35rem); }
        p { margin: 0 0 var(--s3) 0; color: var(--muted); }
        .grid { display: grid; gap: var(--s4); }
        .grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .grid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        @media (max-width: 980px) { .grid.three { grid-template-columns: repeat(2, minmax(0, 1fr)); } .grid.four { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 640px) { .grid.two, .grid.three, .grid.four { grid-template-columns: 1fr; } }
        .card { background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow); padding: var(--s4); overflow: hidden; }
        .chip-row { display: flex; flex-wrap: wrap; gap: var(--s2); }
        .chip { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 999px; border: 1px solid var(--border); background: color-mix(in srgb, var(--bg-elev), transparent 0%); color: var(--muted); font-size: 0.95rem; white-space: nowrap; }
        .btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; padding: 12px 16px; border-radius: var(--radius-md); border: 1px solid transparent; font-weight: 700; cursor: pointer; transition: transform .16s ease, background .16s ease, border-color .16s ease, color .16s ease, box-shadow .16s ease; white-space: nowrap; }
        .btn:focus { outline: none; box-shadow: var(--focus); }
        .btn:active { transform: translateY(1px); }
        .btn.primary { background: var(--primary); color: #fff; box-shadow: 0 14px 28px rgba(211, 84, 60, 0.22); }
        .btn.primary:hover { background: var(--primary-2); }
        .btn.ghost { background: transparent; border-color: var(--border); color: var(--text); }
        .btn.ghost:hover { border-color: color-mix(in srgb, var(--primary), var(--border) 55%); color: var(--primary); }
        .btn.icon { padding: 10px 12px; border-radius: 12px; }
        .icon-svg { width: 18px; height: 18px; fill: currentColor; }
        .muted { color: var(--muted); }
        .sr-only { position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); border: 0; }
        /* Header */
        .skip-link { position: absolute; left: -999px; top: 10px; background: var(--bg-elev); border: 1px solid var(--border); padding: 10px 12px; border-radius: 12px; z-index: 9999; }
        .skip-link:focus { left: 12px; box-shadow: var(--focus); }
        header { position: sticky; top: 0; z-index: 100; background: color-mix(in srgb, var(--bg), transparent 10%); backdrop-filter: blur(10px); border-bottom: 1px solid var(--border); }
        .header-inner { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); padding: 12px 0; }
        .brand { display: flex; align-items: center; gap: 10px; min-width: 190px; }
        .brand-mark { width: 38px; height: 38px; border-radius: 12px; background: linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary), #fff 30%)); box-shadow: 0 12px 22px rgba(211, 84, 60, 0.25); }
        .brand-name { font-weight: 900; letter-spacing: 0.4px; line-height: 1.1; }
        .brand-tag { font-size: 0.9rem; color: var(--muted); margin-top: 2px; line-height: 1.1; }
        .nav-desktop { display: none; }
        .nav-desktop ul { list-style: none; display: flex; gap: 8px; margin: 0; padding: 0; }
        .nav-desktop a { display: inline-flex; padding: 10px 12px; border-radius: 12px; color: var(--text); border: 1px solid transparent; transition: background .16s ease; }
        .nav-desktop a:hover { background: color-mix(in srgb, var(--bg-elev), var(--primary) 6%); border-color: color-mix(in srgb, var(--border), var(--primary) 25%); color: var(--primary); }
        .header-actions { display: flex; align-items: center; gap: 10px; }
        .nav-toggle { display: inline-flex; }
        .nav-toggle svg { width: 20px; height: 20px; }
        @media (min-width: 900px) { .nav-desktop { display: block; } .nav-toggle { display: none; } .header-inner { padding: 14px 0; } }
        /* Drawer */
        body.nav-open { overflow: hidden; }
        .drawer-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); opacity: 0; pointer-events: none; transition: opacity .18s ease; z-index: 200; }
        .drawer { position: fixed; top: 0; right: 0; width: min(380px, 92vw); height: 100%; background: var(--bg-elev); border-left: 1px solid var(--border); box-shadow: var(--shadow); transform: translateX(110%); transition: transform .22s ease; z-index: 220; display: flex; flex-direction: column; }
        body.nav-open .drawer-overlay { opacity: 1; pointer-events: auto; }
        body.nav-open .drawer { transform: translateX(0); }
        .drawer-header { display: flex; align-items: center; justify-content: space-between; padding: 16px; border-bottom: 1px solid var(--border); gap: 10px; }
        .drawer-body { padding: 14px 16px 18px; overflow: auto; }
        .drawer-nav ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
        .drawer-nav a { display: flex; align-items: center; justify-content: space-between; padding: 12px 12px; border-radius: 14px; border: 1px solid var(--border); background: color-mix(in srgb, var(--bg-elev), var(--bg) 12%); }
        .drawer-nav a:hover { border-color: color-mix(in srgb, var(--border), var(--primary) 35%); color: var(--primary); }
        .drawer-cta { display: grid; gap: 10px; margin-top: 14px; }
        /* Hero */
        .hero { padding: var(--s7) 0 var(--s6); background: radial-gradient(900px 520px at 10% 10%, color-mix(in srgb, var(--primary), transparent 85%), transparent 60%), radial-gradient(820px 420px at 95% 0%, color-mix(in srgb, var(--primary), transparent 90%), transparent 55%), linear-gradient(180deg, color-mix(in srgb, var(--bg), #fff 12%), var(--bg)); }
        html[data-theme="dark"] .hero { background: radial-gradient(900px 520px at 10% 10%, rgba(255, 122, 97, 0.16), transparent 60%), radial-gradient(820px 420px at 95% 0%, rgba(255, 122, 97, 0.10), transparent 55%), linear-gradient(180deg, #0f0c0b, #0f0c0b); }
        .hero-wrap { display: grid; gap: var(--s5); align-items: center; grid-template-columns: 1.1fr 0.9fr; }
        @media (max-width: 980px) { .hero-wrap { grid-template-columns: 1fr; } }
        .hero-lede { font-size: 1.1rem; max-width: 60ch; }
        .cta-row { display: flex; flex-wrap: wrap; gap: 12px; margin-top: var(--s3); }
        .hero-media { display: grid; gap: 12px; }
        .hero-shot { border-radius: var(--radius-lg); border: 1px solid var(--border); background: var(--bg-elev); overflow: hidden; box-shadow: var(--shadow); }
        .hero-shot.big { aspect-ratio: 4 / 3; }
        .hero-shot.small { aspect-ratio: 16 / 9; }
        .hero-shot img { width: 100%; height: 100%; object-fit: cover; }
        .thumb { aspect-ratio: 4 / 3; border-radius: 14px; overflow: hidden; border: 1px solid var(--border); background: var(--bg-soft); margin-bottom: 12px; }
        .thumb.tall { aspect-ratio: 3 / 4; }
        .thumb.wide { aspect-ratio: 16 / 9; }
        .thumb img { width: 100%; height: 100%; object-fit: cover; }
        .meta-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
        .tag-row { display: flex; flex-wrap: wrap; gap: 8px; }
        .tag { font-size: 0.85rem; padding: 6px 10px; border-radius: 999px; border: 1px solid var(--border); background: color-mix(in srgb, var(--bg-elev), var(--bg) 14%); color: var(--muted); }
        .feature { display: flex; gap: 12px; align-items: flex-start; }
        .feature .dot { width: 42px; height: 42px; border-radius: 999px; background: color-mix(in srgb, var(--primary), transparent 84%); border: 1px solid color-mix(in srgb, var(--border), var(--primary) 25%); flex-shrink: 0; }
        .brands { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
        @media (max-width: 980px) { .brands { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        @media (max-width: 520px) { .brands { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        .brand-pill { display: flex; align-items: center; justify-content: center; height: 46px; border-radius: 14px; border: 1px solid var(--border); background: color-mix(in srgb, var(--bg-elev), var(--bg) 10%); color: var(--muted); font-weight: 800; letter-spacing: 0.4px; text-transform: uppercase; font-size: 0.8rem; }
        ul.clean { margin: 0; padding-left: 18px; color: var(--muted); }
        ul.clean li { margin: 8px 0; }
        details { background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-md); box-shadow: var(--shadow); padding: 14px 14px; overflow: hidden; }
        details+details { margin-top: 12px; }
        summary { cursor: pointer; font-weight: 800; color: var(--text); outline: none; }
        details p { margin-top: 10px; }
        .form { display: grid; gap: 12px; }
        input, textarea { width: 100%; padding: 12px 12px; border-radius: 12px; border: 1px solid var(--border); background: color-mix(in srgb, var(--bg-elev), var(--bg) 8%); outline: none; }
        input:focus, textarea:focus { box-shadow: var(--focus); border-color: color-mix(in srgb, var(--primary), var(--border) 50%); }
        textarea { min-height: 120px; resize: vertical; }
        footer { background: var(--bg-elev); border-top: 1px solid var(--border); padding: var(--s6) 0; }
        .footer-grid { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: var(--s5); }
        @media (max-width: 900px) { .footer-grid { grid-template-columns: 1fr; gap: var(--s4); } }
        .footer-grid a:hover { color: var(--primary); }
        .toast { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%) translateY(20px); background: var(--bg-elev); border: 1px solid var(--border); box-shadow: var(--shadow); border-radius: 14px; padding: 12px 14px; opacity: 0; pointer-events: none; transition: opacity .2s ease, transform .2s ease; z-index: 300; width: min(520px, calc(100% - 24px)); }
        .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
        .toast strong { display: block; margin-bottom: 4px; }
        [data-reveal] { opacity: 0; transform: translateY(10px); transition: opacity .5s ease, transform .5s ease; }
        [data-reveal].reveal-in { opacity: 1; transform: translateY(0); }
        @media (prefers-reduced-motion: reduce) { [data-reveal] { opacity: 1; transform: none; transition: none; } }
        .mobile-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 90; background: color-mix(in srgb, var(--bg-elev), var(--bg) 10%); border-top: 1px solid var(--border); padding: 10px 10px; display: flex; gap: 10px; justify-content: space-between; backdrop-filter: blur(10px); }
        .mobile-bar .btn { flex: 1; padding: 12px 10px; }
        @media (min-width: 900px) { .mobile-bar { display: none; } }
        @media (max-width: 899px) { body { padding-bottom: 74px; } .desktop-only { display: none !important; } }
    </style>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        "name": "Verve West",
        "url": "https://example.com"
      }
    </script>
</head>
<body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header>
        <div class="container header-inner">
            <a class="brand" href="#hero" aria-label="Home">
                <span class="brand-mark" aria-hidden="true"></span>
                <span>
                    <div class="brand-name">Verve West</div>
                    <div class="brand-tag">Tagline Here</div>
                </span>
            </a>
            <nav class="nav-desktop" aria-label="Primary">
                <ul>
                    <li><a href="#services">Services</a></li>
                    <li><a href="#featured">Featured</a></li>
                    <li><a href="#about">About</a></li>
                    <li><a href="#testimonials">Reviews</a></li>
                    <li><a href="#contact">Contact</a></li>
                </ul>
            </nav>
            <div class="header-actions">
                <button id="themeToggle" class="btn ghost icon" type="button" aria-pressed="false" aria-label="Toggle dark mode">
                    <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" id="themeIcon"><path d="M21 14.5A7.5 7.5 0 0 1 9.5 3a6.5 6.5 0 1 0 11.5 11.5Z" /></svg>
                    <span class="sr-only" id="themeLabel">Toggle theme</span>
                </button>
                <a class="btn ghost desktop-only" href="tel:9999999999" aria-label="Call">Call</a>
                <a class="btn primary desktop-only" href="#contact" aria-label="Contact">Get Started</a>
                <button id="navToggle" class="btn ghost icon nav-toggle" type="button" aria-controls="mobileDrawer" aria-expanded="false" aria-label="Open menu">
                    <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z" /></svg>
                </button>
            </div>
        </div>
    </header>
    <div class="drawer-overlay" id="navOverlay" aria-hidden="true"></div>
    <aside class="drawer" id="mobileDrawer" aria-label="Mobile menu">
        <div class="drawer-header"><strong>Menu</strong><button class="btn ghost icon" type="button" id="navClose" aria-label="Close menu">X</button></div>
        <div class="drawer-body">
            <nav class="drawer-nav" aria-label="Mobile primary">
                <ul>
                    <li><a href="#hero">Home</a></li>
                    <li><a href="#services">Services</a></li>
                    <li><a href="#about">About</a></li>
                    <li><a href="#contact">Contact</a></li>
                </ul>
            </nav>
            <div class="drawer-cta"><a class="btn primary" href="#contact">Contact Us</a></div>
        </div>
    </aside>
    <main id="main">
        <section id="hero" class="hero">
            <div class="container hero-wrap">
                <div data-reveal>
                    <h1>Hero Headline Goes Here</h1>
                    <p class="hero-lede">Subheadline text goes here. Explain what the business does.</p>
                    <div class="cta-row"><a class="btn primary" href="#contact">Action</a></div>
                </div>
                <div class="hero-media" data-reveal>
                    <div class="hero-shot big"><img src="https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=1200" alt="Hero" /></div>
                </div>
            </div>
        </section>
        <section id="services" class="section">
            <div class="container">
                <h2 data-reveal>Our Services</h2>
                <div class="grid three" style="margin-top:16px;">
                    <article class="card" data-reveal><h3>Service 1</h3><p>Description.</p></article>
                    <article class="card" data-reveal><h3>Service 2</h3><p>Description.</p></article>
                    <article class="card" data-reveal><h3>Service 3</h3><p>Description.</p></article>
                </div>
            </div>
        </section>
        <section id="about" class="section alt">
            <div class="container grid two" style="align-items:center;">
                <div data-reveal>
                   <h2>About Us</h2>
                   <p>Business description text.</p>
                </div>
                <div class="card" data-reveal>
                    <h3>Why Choose Us?</h3>
                    <ul class="clean"><li>Reason 1</li><li>Reason 2</li></ul>
                </div>
            </div>
        </section>
        <section id="contact" class="section">
            <div class="container">
                <h2 data-reveal>Contact Us</h2>
                <div class="grid two" style="align-items:start; margin-top:16px;">
                    <div class="card" data-reveal>
                        <h3>Get in Touch</h3>
                        <p><strong>Address:</strong> Location</p>
                        <p><strong>Phone:</strong> 555-0123</p>
                    </div>
                    <div class="card" data-reveal>
                        <h3>Send a Message</h3>
                        <form id="contactForm" class="form" action="#" method="post">
                            <input id="name" name="name" type="text" placeholder="Your name" required />
                            <input id="phone" name="phone" type="tel" placeholder="Your phone" required />
                            <textarea id="message" name="message" placeholder="How can we help?" required></textarea>
                            <button class="btn primary" type="submit">Send Message</button>
                        </form>
                    </div>
                </div>
            </div>
        </section>
        <footer>
            <div class="container" style="text-align:center;">
                <p>&copy; <span id="year"></span> <span id="footerBrand">Business Name</span>. All rights reserved.</p>
            </div>
        </footer>
        <div class="toast" id="toast" role="status"></div>
    </main>
    <script>
        // ========= Image fallback
        function fallbackImg(imgEl) { imgEl.onerror = null; imgEl.src = "data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%22300%22%20height%3D%22200%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20width%3D%22300%22%20height%3D%22200%22%20fill%3D%22%23eee%22%2F%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20fill%3D%22%23aaa%22%3EImage%3C%2Ftext%3E%3C%2Fsvg%3E"; }
        // ========= Mobile drawer menu
        const navToggle = document.getElementById('navToggle'); const navClose = document.getElementById('navClose'); const navOverlay = document.getElementById('navOverlay'); const drawer = document.getElementById('mobileDrawer');
        function openNav() { document.body.classList.add('nav-open'); navToggle?.setAttribute('aria-expanded', 'true'); }
        function closeNav() { document.body.classList.remove('nav-open'); navToggle?.setAttribute('aria-expanded', 'false'); }
        navToggle?.addEventListener('click', () => { document.body.classList.contains('nav-open') ? closeNav() : openNav(); });
        navClose?.addEventListener('click', closeNav); navOverlay?.addEventListener('click', closeNav);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNav(); });
        drawer.querySelectorAll('a').forEach(a => a.addEventListener('click', closeNav));
        // ========= Theme toggle
        const root = document.documentElement; const themeToggle = document.getElementById('themeToggle'); const themeIcon = document.getElementById('themeIcon');
        function setTheme(next) { root.setAttribute('data-theme', next); localStorage.setItem('theme', next); const isDark = next === 'dark'; themeToggle?.setAttribute('aria-pressed', isDark ? 'true' : 'false'); if (themeIcon) { themeIcon.innerHTML = isDark ? '<path d="M6.76 4.84 5.35 3.43 3.93 4.85l1.41 1.41 1.42-1.42ZM1 13h3v-2H1v2Zm10 10h2v-3h-2v3Zm9.07-18.15-1.41-1.41-1.42 1.41 1.42 1.42 1.41-1.42ZM20 11v2h3v-2h-3ZM11 1h2v3h-2V1Zm7.66 18.16 1.41 1.41 1.42-1.41-1.42-1.42-1.41 1.42ZM4.93 19.57l1.42 1.41 1.41-1.41-1.41-1.42-1.42 1.42ZM12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z"/>' : '<path d="M21 14.5A7.5 7.5 0 0 1 9.5 3a6.5 6.5 0 1 0 11.5 11.5Z"/>'; } const themeMeta = document.querySelector('meta[name="theme-color"]'); if (themeMeta) themeMeta.setAttribute('content', isDark ? '#0f0c0b' : '#fffaf5'); }
        const saved = localStorage.getItem('theme'); if (saved === 'dark' || saved === 'light') setTheme(saved);
        themeToggle?.addEventListener('click', () => { const current = root.getAttribute('data-theme') || 'light'; setTheme(current === 'dark' ? 'light' : 'dark'); });
        // ========= Reveal on scroll
        const revealEls = Array.from(document.querySelectorAll('[data-reveal]')); const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!reduceMotion && 'IntersectionObserver' in window) { const io = new IntersectionObserver((entries) => { entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('reveal-in'); io.unobserve(entry.target); } }); }, { threshold: 0.12 }); revealEls.forEach(el => io.observe(el)); } else { revealEls.forEach(el => el.classList.add('reveal-in')); }
        // ========= Contact form
        const form = document.getElementById('contactForm'); const toast = document.getElementById('toast');
        function showToast(title, msg) { if (!toast) return; toast.innerHTML = '<strong>' + title + '</strong><div class="muted">' + msg + '</div>'; toast.classList.add('show'); window.clearTimeout(showToast._t); showToast._t = window.setTimeout(() => toast.classList.remove('show'), 3200); }
        form?.addEventListener('submit', (e) => { e.preventDefault(); const fd = new FormData(form); const name = (fd.get('name') || '').toString().trim() || 'there'; showToast('Enquiry saved (demo)', 'Thanks, ' + name + '! Connect this form to your backend when ready.'); form.reset(); });
        document.getElementById('year').textContent = new Date().getFullYear();
    </script>
</body>
</html>`;

/**
 * Builder Agent
 * Takes an ArchitectOutput and adapts the Master Template to match the specs
 */
export async function runBuilder(spec: ArchitectOutput): Promise<string> {

    const prompt = `
    You are an Expert Web Developer specializing in RESKINNING templates.
    
    You have a **MASTER TEMPLATE** (mobile-responsive HTML/CSS).
    You have a **SPECIFICATION** (describing a new business).

    YOUR TASK:
    Rewrite the MASTER TEMPLATE to suit the new business.
    
    CRITICAL RULES (DO NOT BREAK):
    1. **PRESERVE STRUCTURE**: 
       - Do NOT change the HTML structure, class names, or layout logic.
       - Do NOT add Tailwind, Bootstrap, or any external CSS framework.
       - Use the existing CSS variables in the <style> tag.
    
    2. **RESKIN THEME**: 
       - Update the :root CSS variables (colors, fonts) to match the specification.
       - Ensure --primary and --secondary colors match the brand.
    
    3. **UPDATE CONTENT**:
       - Replace "Verve West" with the new Business Name.
       - Rewrite the Hero Headline and Description.
       - Populate the "Services" or "Products" section with 3-4 items relevant to the new business.
       - Update the "About" text.
       - Update the Footer text.
       - Update the <title> and <meta> description.

    4. **UPDATE IMAGES**:
       - Replace ALL <img> src attributes with relevant Unsplash URLs.
       - Format: https://images.unsplash.com/photo-[ID]?auto=format&fit=crop&w=1200
       - Choose images that strictly match the business type (e.g., if it's a bakery, show bread/cakes).

    5. **OUTPUT**:
       - Return ONLY the valid, complete HTML code.
       - Do not wrap in markdown.

    INPUT SPECIFICATION:
    ${JSON.stringify(spec, null, 2)}

    MASTER TEMPLATE:
    ${MASTER_TEMPLATE}
  `;

    const result = await model.generateContent(prompt);
    const rawOutput = result.response.text();

    return cleanLLMOutput(rawOutput);
}

/**
 * Mock Builder (for testing)
 */
export function mockBuilder(spec: ArchitectOutput): string {
    // Simple replace for testing purposes
    let html = MASTER_TEMPLATE;
    html = html.replace("Verve West", "Mock Business " + Date.now());
    return html;
}