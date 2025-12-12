/**
 * fal.ai image generation provider (Nano Banana / Nano Banana Pro)
 *
 * Provides a unified interface for image generation. Internally routes to:
 * - Text-to-image endpoint when no reference images provided
 * - Edit endpoint when reference images are provided
 *
 * This abstraction hides fal.ai's API quirk of splitting these into separate endpoints.
 */

import { fal } from "@fal-ai/client";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { logger } from "../logger.js";
import { withRetry, withTimeout } from "../retry.js";
import {
  ImageProvider,
  ImageGenerateOptions,
  GenerateResult,
  ModelInfo,
  SupportedImageModel,
  FAL_MODEL_IDS,
  ASPECT_RATIOS,
  ASPECT_RATIOS_WITH_AUTO,
  MAX_REFERENCE_IMAGES,
} from "../types.js";

// Default timeout for image generation (3 minutes)
const DEFAULT_TIMEOUT_MS = 180000;

// fal.ai API response types
interface FalImage {
  url: string;
  content_type?: string;
  file_name?: string;
  file_size?: number;
  width?: number;
  height?: number;
}

interface FalGenerateResponse {
  images: FalImage[];
  description?: string;
}

export class FalImageProvider implements ImageProvider {
  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("fal.ai API key is required");
    }
    fal.config({
      credentials: apiKey,
    });
    logger.info("fal.ai image provider initialized", {
      models: ["nano-banana", "nano-banana-pro"],
    });
  }

  /**
   * Get the appropriate fal.ai model ID based on model name and whether we have reference images
   */
  private getModelId(model: SupportedImageModel, hasReferenceImages: boolean): string {
    if (hasReferenceImages) {
      // Use edit endpoint when reference images are provided
      return model === "nano-banana-pro"
        ? FAL_MODEL_IDS.NANO_BANANA_PRO_EDIT
        : FAL_MODEL_IDS.NANO_BANANA_EDIT;
    }
    // Use text-to-image endpoint for pure generation
    return model === "nano-banana-pro"
      ? FAL_MODEL_IDS.NANO_BANANA_PRO
      : FAL_MODEL_IDS.NANO_BANANA;
  }

  /**
   * Download an image from URL and save to disk
   */
  private async downloadAndSave(imageUrl: string, outputPath: string): Promise<void> {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    // Ensure output directory exists
    const outputDir = dirname(outputPath);
    if (outputDir && !existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    writeFileSync(outputPath, buffer);
  }

  async generate(options: ImageGenerateOptions): Promise<GenerateResult> {
    const {
      prompt,
      outputPath,
      model = "nano-banana",
      referenceImages = [],
      aspectRatio,
      outputFormat = "png",
      resolution = "1K",
      numImages = 1,
      enableWebSearch = false,
    } = options;

    const startTime = Date.now();
    const isPro = model === "nano-banana-pro";
    const hasReferenceImages = referenceImages.length > 0;

    // Validate aspect ratio if provided
    if (aspectRatio) {
      // "auto" is only valid when using reference images (edit endpoint)
      if (aspectRatio === "auto" && !hasReferenceImages) {
        throw new Error(
          `Aspect ratio "auto" is only valid when using reference_images. ` +
          `For text-to-image, use: ${ASPECT_RATIOS.join(", ")}`
        );
      }
      // Validate against full list (including "auto" for edit)
      if (!ASPECT_RATIOS_WITH_AUTO.includes(aspectRatio)) {
        throw new Error(
          `Invalid aspect ratio "${aspectRatio}". Valid options: ${ASPECT_RATIOS_WITH_AUTO.join(", ")}`
        );
      }
    }

    // Validate reference images count
    const maxImages = MAX_REFERENCE_IMAGES[model];
    if (referenceImages.length > maxImages) {
      throw new Error(
        `Maximum ${maxImages} reference images allowed for ${model}`
      );
    }

    // Validate resolution (only Pro supports 2K/4K)
    if (!isPro && resolution !== "1K") {
      throw new Error("Only nano-banana-pro supports 2K and 4K resolution");
    }

    // Get the appropriate endpoint
    const modelId = this.getModelId(model, hasReferenceImages);

    logger.debugLog("Starting image generation", {
      promptLength: prompt.length,
      model,
      modelId,
      referenceImageCount: referenceImages.length,
      aspectRatio,
      outputPath,
    });

    try {
      // Build input parameters
      const input: Record<string, unknown> = {
        prompt,
        output_format: outputFormat,
        num_images: numImages,
      };

      // Add aspect ratio if provided
      if (aspectRatio) {
        input.aspect_ratio = aspectRatio;
      }

      // Add reference images if provided (for edit endpoint)
      if (hasReferenceImages) {
        input.image_urls = referenceImages;
      }

      // Add Pro-only options
      if (isPro) {
        input.resolution = resolution;
        if (enableWebSearch) {
          input.enable_web_search = true;
        }
      }

      // Use retry wrapper for transient errors and timeout protection
      const response = await withRetry(
        () =>
          withTimeout(
            async () => {
              const result = await fal.subscribe(modelId, {
                input,
                logs: false,
              });
              return result.data as FalGenerateResponse;
            },
            DEFAULT_TIMEOUT_MS
          ),
        {
          maxRetries: 2,
          retryableErrors: ["RATE_LIMIT", "429", "503", "502", "ECONNRESET", "ETIMEDOUT"],
        }
      );

      // Validate response
      if (!response.images || response.images.length === 0) {
        throw new Error("No image data found in response");
      }

      // Download and save the first image
      // (fal returns URLs, we need to download and save locally)
      const image = response.images[0];
      await this.downloadAndSave(image.url, outputPath);

      // If multiple images requested, save with numbered suffixes
      if (numImages > 1 && response.images.length > 1) {
        for (let i = 1; i < response.images.length; i++) {
          const numberedPath = outputPath.replace(/(\.[^.]+)$/, `_${i + 1}$1`);
          await this.downloadAndSave(response.images[i].url, numberedPath);
        }
      }

      const durationMs = Date.now() - startTime;

      // Log usage statistics
      logger.logUsage({
        timestamp: new Date().toISOString(),
        model,
        type: "image",
        durationMs,
        success: true,
      });

      return {
        imagePath: outputPath,
        model,
        usage: { durationMs },
      };
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      let errorType = "GENERATION_ERROR";

      // Categorize errors for better user feedback
      if (
        errorMessage.includes("API key") ||
        errorMessage.includes("unauthorized") ||
        errorMessage.includes("authentication")
      ) {
        errorType = "AUTH_ERROR";
      } else if (
        errorMessage.includes("quota") ||
        errorMessage.includes("rate") ||
        errorMessage.includes("429") ||
        errorMessage.includes("too many requests")
      ) {
        errorType = "RATE_LIMIT";
      } else if (
        errorMessage.includes("safety") ||
        errorMessage.includes("blocked") ||
        errorMessage.includes("content policy")
      ) {
        errorType = "CONTENT_BLOCKED";
      } else if (errorMessage.includes("TIMEOUT")) {
        errorType = "TIMEOUT";
      }

      // Log failed usage
      logger.logUsage({
        timestamp: new Date().toISOString(),
        model,
        type: "image",
        durationMs,
        success: false,
        error: `${errorType}: ${errorMessage}`,
      });

      throw new Error(`${errorType}: ${errorMessage}`);
    }
  }

  getModelInfo(model: SupportedImageModel = "nano-banana"): ModelInfo {
    const modelInfos: Record<SupportedImageModel, ModelInfo> = {
      "nano-banana": {
        id: "nano-banana",
        name: "Nano Banana (Gemini 2.5 Flash Image)",
        provider: "fal.ai",
        type: "image",
        description:
          "Fast image generation model. Good for quick iterations. Supports up to 3 reference images for editing/composition.",
      },
      "nano-banana-pro": {
        id: "nano-banana-pro",
        name: "Nano Banana Pro (Gemini 3 Pro Image)",
        provider: "fal.ai",
        type: "image",
        description:
          "High-fidelity image generation model. Excellent for detailed, production-quality images with accurate text rendering. Supports up to 14 reference images, 4K resolution, and web search.",
      },
    };

    return modelInfos[model];
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
