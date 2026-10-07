import { z } from "zod";

/**
 * BusinessInput Schema
 * Validates user input for website generation pipeline
 */
export const PhotoSchema = z.object({
  url: z.string().url("Invalid photo URL"),
  alt: z.string().max(200).optional(),
  caption: z.string().max(300).optional(),
});

export const BusinessHoursSchema = z.record(z.string(), z.string());

/**
 * A real customer testimonial supplied by the business.
 * The pipeline only ever shows testimonials that arrive here. It never asks
 * a model to invent one.
 */
export const TestimonialSchema = z.object({
  author: z.string().min(2).max(100),
  quote: z.string().min(10).max(600),
});

export const BusinessInputSchema = z.object({
  business_name: z
    .string()
    .min(2, "Business name must be at least 2 characters")
    .max(100, "Business name must be at most 100 characters"),
  address: z
    .string()
    .min(5, "Address must be at least 5 characters")
    .max(200, "Address must be at most 200 characters"),
  city: z
    .string()
    .min(2, "City must be at least 2 characters")
    .max(50, "City must be at most 50 characters"),
  state: z
    .string()
    .min(2, "State must be at least 2 characters")
    .max(50, "State must be at most 50 characters"),
  owner_name: z
    .string()
    .min(2, "Owner name must be at least 2 characters")
    .max(100, "Owner name must be at most 100 characters")
    .optional(),
  business_category: z
    .string()
    .min(2, "Business category must be at least 2 characters")
    .max(50, "Business category must be at most 50 characters")
    .optional(),
  description: z
    .string()
    .min(20, "Description must be at least 20 characters")
    .max(2000, "Description must be at most 2000 characters"),
  photos: z.array(PhotoSchema).default([]),
  phone: z
    .string()
    .regex(/^[+]?[0-9\s\-()]+$/, "Invalid phone number format")
    .optional(),
  email: z.string().email("Invalid email format").optional(),
  website: z.string().url("Invalid website URL").optional(),
  hours: BusinessHoursSchema.optional(),
  testimonials: z.array(TestimonialSchema).max(6).default([]),
});

export type BusinessInput = z.infer<typeof BusinessInputSchema>;
export type Photo = z.infer<typeof PhotoSchema>;
export type Testimonial = z.infer<typeof TestimonialSchema>;
