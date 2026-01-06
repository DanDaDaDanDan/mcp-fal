/**
 * fal.ai Model Pricing and Cost Calculation
 *
 * Pricing sources:
 * - https://fal.ai/pricing
 * - Estimates based on Nano Banana model costs
 * Last updated: January 2026
 */

// ============================================================================
// Types
// ============================================================================

export interface ImagePricing {
  perImage: number; // USD per image
}

export interface CostInfo {
  imageCost?: number;
  totalCost: number;
  currency: "USD";
  estimated: boolean;
}

// ============================================================================
// Image Model Pricing (USD per image) - Estimates
// ============================================================================

export const FAL_IMAGE_PRICING: Record<string, ImagePricing> = {
  "nano-banana": {
    perImage: 0.039,
  },
  "nano-banana-pro": {
    perImage: 0.15, // Base 1K resolution
  },
};

// Resolution multipliers for nano-banana-pro
export const RESOLUTION_MULTIPLIERS: Record<string, number> = {
  "1K": 1.0,
  "2K": 1.33,
  "4K": 2.0,
};

// ============================================================================
// Cost Calculation Functions
// ============================================================================

/**
 * Calculate cost for image generation
 */
export function calculateImageCost(
  model: string,
  resolution: string = "1K",
  numImages: number = 1
): CostInfo {
  const pricing = FAL_IMAGE_PRICING[model];
  const estimated = !pricing;

  if (!pricing) {
    return {
      imageCost: 0,
      totalCost: 0,
      currency: "USD",
      estimated: true,
    };
  }

  const multiplier =
    model === "nano-banana-pro" ? RESOLUTION_MULTIPLIERS[resolution] || 1.0 : 1.0;

  const imageCost = pricing.perImage * multiplier * numImages;

  return {
    imageCost: roundToMicro(imageCost),
    totalCost: roundToMicro(imageCost),
    currency: "USD",
    estimated,
  };
}

/**
 * Round to 6 decimal places (micro-dollar precision)
 */
function roundToMicro(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Get image pricing for a specific model
 */
export function getImagePricing(model: string): ImagePricing & { estimated: boolean } {
  const pricing = FAL_IMAGE_PRICING[model];
  return {
    ...(pricing || { perImage: 0 }),
    estimated: !pricing,
  };
}
