/**
 * Shared TypeScript types for the Website Pipeline API
 */

/**
 * Input schema for the /generate endpoint
 * Contains all business information needed to generate a website
 */
export interface BusinessInput {
  /** Business name to display on the website */
  business_name: string;
  
  /** Street address */
  address: string;
  
  /** City name */
  city: string;
  
  /** State/Province */
  state: string;
  
  /** Business owner's name */
  owner_name: string;
  
  /** Business category for industry-specific design patterns */
  business_category: BusinessCategory;
  
  /** Business description and unique selling points */
  description: string;
  
  /** Array of image URLs or base64 encoded images */
  photos: string[];
  
  /** Optional: Contact phone number */
  phone?: string;
  
  /** Optional: Contact email */
  email?: string;
  
  /** Optional: WhatsApp number for floating CTA */
  whatsapp?: string;
  
  /** Optional: Operating hours */
  hours?: string;
  
  /** Optional: User ID for tracking */
  userId?: string;
}

/**
 * Supported business categories with industry-specific design patterns
 */
export type BusinessCategory =
  | "optical_retail"
  | "restaurant"
  | "salon_spa"
  | "medical_clinic"
  | "fitness_gym"
  | "real_estate"
  | "legal_services"
  | "automotive"
  | "education"
  | "retail_general"
  | "professional_services"
  | "hospitality"
  | "other";

/**
 * Response from the /generate endpoint
 */
export interface GenerateResponse {
  status: "processing" | "completed" | "error";
  message: string;
  runId: string;
  taskFilePath?: string;
}

/**
 * Industry-specific design configurations
 */
export interface DesignConfig {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontHeading: string;
  fontBody: string;
  sections: string[];
  designPhilosophy: string;
}

/**
 * Mapping of business categories to their design configurations
 */
export const CATEGORY_DESIGNS: Record<BusinessCategory, DesignConfig> = {
  optical_retail: {
    primaryColor: "#1E3A5F",
    secondaryColor: "#D4AF37",
    accentColor: "#4A90A4",
    fontHeading: "Playfair Display",
    fontBody: "Inter",
    sections: ["hero", "services", "products", "brands", "about", "testimonials", "contact"],
    designPhilosophy: "Quiet luxury with premium feel, emphasizing trust and precision"
  },
  restaurant: {
    primaryColor: "#2D2D2D",
    secondaryColor: "#C9A227",
    accentColor: "#8B4513",
    fontHeading: "Cormorant Garamond",
    fontBody: "Lato",
    sections: ["hero", "menu", "specialties", "ambiance", "chef", "reservations", "location"],
    designPhilosophy: "Warm and inviting, food-focused with appetite appeal"
  },
  salon_spa: {
    primaryColor: "#4A4A4A",
    secondaryColor: "#E8D5B7",
    accentColor: "#9B7B5C",
    fontHeading: "Cormorant",
    fontBody: "Raleway",
    sections: ["hero", "services", "treatments", "gallery", "team", "pricing", "booking"],
    designPhilosophy: "Serene elegance, calming colors emphasizing relaxation"
  },
  medical_clinic: {
    primaryColor: "#1A5F7A",
    secondaryColor: "#57C5B6",
    accentColor: "#159895",
    fontHeading: "Poppins",
    fontBody: "Open Sans",
    sections: ["hero", "services", "doctors", "facilities", "testimonials", "insurance", "appointment"],
    designPhilosophy: "Clean and professional, trust-building with clinical precision"
  },
  fitness_gym: {
    primaryColor: "#1A1A2E",
    secondaryColor: "#E94560",
    accentColor: "#FF6B35",
    fontHeading: "Bebas Neue",
    fontBody: "Roboto",
    sections: ["hero", "programs", "trainers", "facilities", "membership", "transformation", "join"],
    designPhilosophy: "Bold and energetic, motivational with dynamic visuals"
  },
  real_estate: {
    primaryColor: "#1B2838",
    secondaryColor: "#C9A227",
    accentColor: "#4A6FA5",
    fontHeading: "Playfair Display",
    fontBody: "Source Sans Pro",
    sections: ["hero", "featured", "properties", "services", "agent", "testimonials", "contact"],
    designPhilosophy: "Sophisticated luxury, property-focused with aspirational imagery"
  },
  legal_services: {
    primaryColor: "#1C3144",
    secondaryColor: "#9B7B5C",
    accentColor: "#3D5A73",
    fontHeading: "Libre Baskerville",
    fontBody: "Source Sans Pro",
    sections: ["hero", "practice-areas", "attorneys", "case-results", "testimonials", "consultation"],
    designPhilosophy: "Authoritative and trustworthy, traditional with modern touches"
  },
  automotive: {
    primaryColor: "#0D0D0D",
    secondaryColor: "#E31837",
    accentColor: "#C0C0C0",
    fontHeading: "Oswald",
    fontBody: "Roboto",
    sections: ["hero", "services", "inventory", "specials", "about", "reviews", "contact"],
    designPhilosophy: "Bold and powerful, automotive excellence with dynamic energy"
  },
  education: {
    primaryColor: "#1D3557",
    secondaryColor: "#457B9D",
    accentColor: "#E63946",
    fontHeading: "Merriweather",
    fontBody: "Open Sans",
    sections: ["hero", "programs", "faculty", "campus", "admissions", "achievements", "apply"],
    designPhilosophy: "Academic excellence, inspiring with knowledge-focused design"
  },
  retail_general: {
    primaryColor: "#2C3E50",
    secondaryColor: "#E74C3C",
    accentColor: "#3498DB",
    fontHeading: "Montserrat",
    fontBody: "Open Sans",
    sections: ["hero", "featured", "categories", "bestsellers", "about", "reviews", "contact"],
    designPhilosophy: "Modern commerce, product-focused with clear navigation"
  },
  professional_services: {
    primaryColor: "#2C3E50",
    secondaryColor: "#16A085",
    accentColor: "#2980B9",
    fontHeading: "Lato",
    fontBody: "Source Sans Pro",
    sections: ["hero", "services", "process", "portfolio", "team", "testimonials", "contact"],
    designPhilosophy: "Professional credibility, expertise-focused with case studies"
  },
  hospitality: {
    primaryColor: "#1A1A2E",
    secondaryColor: "#D4A373",
    accentColor: "#CCD5AE",
    fontHeading: "Cormorant Garamond",
    fontBody: "Nunito",
    sections: ["hero", "rooms", "amenities", "dining", "experiences", "gallery", "booking"],
    designPhilosophy: "Luxurious escape, immersive imagery emphasizing experience"
  },
  other: {
    primaryColor: "#2D3436",
    secondaryColor: "#00B894",
    accentColor: "#6C5CE7",
    fontHeading: "Poppins",
    fontBody: "Inter",
    sections: ["hero", "services", "about", "gallery", "testimonials", "contact"],
    designPhilosophy: "Modern and versatile, clean design adaptable to any business"
  }
};
