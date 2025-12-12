/**
 * Shared types and constants for the mcp-fal server
 */

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

// Model information for list_models tool
export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  type: "image";
  description: string;
}

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
}
