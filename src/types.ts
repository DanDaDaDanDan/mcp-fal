/**
 * Shared types and constants for the mcp-fal server
 */

// ============================================================================
// Model Constants
// ============================================================================

// Model identifiers as used in the fal.ai API
export const FAL_MODEL_IDS = {
  NANO_BANANA: "fal-ai/nano-banana",
  NANO_BANANA_PRO: "fal-ai/nano-banana-pro",
  NANO_BANANA_EDIT: "fal-ai/nano-banana/edit",
  NANO_BANANA_PRO_EDIT: "fal-ai/nano-banana-pro/edit",
} as const;

// Friendly model names for the MCP interface
export const SUPPORTED_IMAGE_MODELS = ["nano-banana", "nano-banana-pro"] as const;
export type SupportedImageModel = (typeof SUPPORTED_IMAGE_MODELS)[number];

export function isSupportedImageModel(model: string): model is SupportedImageModel {
  return SUPPORTED_IMAGE_MODELS.includes(model as SupportedImageModel);
}

// Supported aspect ratios
// Note: "auto" is only valid when using reference images (edit endpoint)
// It preserves the original image's aspect ratio
export const ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

// Extended aspect ratios including "auto" for edit operations
export const ASPECT_RATIOS_WITH_AUTO = ["auto", ...ASPECT_RATIOS] as const;
export type AspectRatioWithAuto = (typeof ASPECT_RATIOS_WITH_AUTO)[number];

// Supported output formats
export const OUTPUT_FORMATS = ["png", "jpeg", "webp"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

// Supported resolutions (Pro only)
export const RESOLUTIONS = ["1K", "2K", "4K"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

// Maximum reference images per model
export const MAX_REFERENCE_IMAGES: Record<SupportedImageModel, number> = {
  "nano-banana": 3,
  "nano-banana-pro": 14,
};

// ============================================================================
// Provider Interfaces
// ============================================================================

// Model information for list_models tool
export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  type: "image";
  description: string;
}

// ============================================================================
// Input Types (Tool Parameters)
// ============================================================================

// Image generation options (unified - handles both text-to-image and image editing)
export interface ImageGenerateOptions {
  prompt: string;
  outputPath: string;
  model?: SupportedImageModel;
  referenceImages?: string[]; // URLs for reference/editing
  aspectRatio?: AspectRatioWithAuto; // "auto" only valid with reference images
  outputFormat?: OutputFormat;
  resolution?: Resolution;
  numImages?: number;
  enableWebSearch?: boolean;
}

// ============================================================================
// Result Types
// ============================================================================

// Generation result
export interface GenerateResult {
  imagePath: string;
  model: SupportedImageModel;
  usage?: {
    durationMs: number;
  };
}

// Provider interface
export interface ImageProvider {
  generate(options: ImageGenerateOptions): Promise<GenerateResult>;
  getModelInfo(model?: SupportedImageModel): ModelInfo;
  isAvailable(): Promise<boolean>;
}

// ============================================================================
// Error Types
// ============================================================================

export type MCPProvider = "xai" | "gemini" | "fal";

export type ErrorCategory =
  | "AUTH_ERROR"
  | "RATE_LIMIT"
  | "CONTENT_BLOCKED"
  | "SAFETY_BLOCK"
  | "TIMEOUT"
  | "API_ERROR"
  | "VALIDATION_ERROR";

export class MCPError extends Error {
  constructor(
    public category: ErrorCategory,
    message: string,
    public provider: MCPProvider,
    public statusCode?: number
  ) {
    super(`${category}: ${message}`);
    this.name = "MCPError";
  }
}

/**
 * Categorize an error from the fal.ai API
 */
export function categorizeError(error: unknown, provider: MCPProvider = "fal"): MCPError {
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as any)?.status || (error as any)?.statusCode;

  if (status === 401 || message.includes("API key") || message.includes("unauthorized")) {
    return new MCPError("AUTH_ERROR", "Invalid or missing fal.ai API key", provider, status);
  }

  if (status === 429 || message.includes("quota") || message.includes("rate")) {
    return new MCPError("RATE_LIMIT", "fal.ai API rate limit or quota exceeded", provider, status);
  }

  if (message.includes("safety") || message.includes("blocked")) {
    return new MCPError("SAFETY_BLOCK", "Content blocked by safety filter", provider, status);
  }

  if (status === 422 || message.includes("422") || message.includes("invalid")) {
    return new MCPError("VALIDATION_ERROR", message, provider, status);
  }

  if (message.includes("TIMEOUT") || message.includes("timed out")) {
    return new MCPError("TIMEOUT", message, provider);
  }

  return new MCPError("API_ERROR", message, provider, status);
}
