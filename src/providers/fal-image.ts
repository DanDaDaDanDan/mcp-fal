/**
 * fal.ai image generation provider (Nano Banana / Nano Banana Pro)
 *
 * Provides a unified interface for image generation. Internally routes to:
 * - Text-to-image endpoint when no reference images provided
 * - Edit endpoint when reference images are provided
 *
 * This abstraction hides fal.ai's API quirk of splitting these into separate endpoints.
 *
 * Reference images can be:
 * - URLs (https://...) - used directly
 * - Local file paths - automatically uploaded to fal.ai storage
 * - Data URLs (data:image/...) - converted to buffer and uploaded
 */

import { fal } from "@fal-ai/client";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { dirname, basename, extname } from "path";
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

// Timeout for uploading a single reference image (30 seconds)
const UPLOAD_TIMEOUT_MS = 30000;

/**
 * Determine the type of a reference image input
 */
function getImageInputType(input: string): "url" | "data_url" | "local_file" {
  if (input.startsWith("data:")) {
    return "data_url";
  }
  if (input.startsWith("http://") || input.startsWith("https://")) {
    return "url";
  }
  return "local_file";
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
  };
  return mimeTypes[ext] || "image/png";
}

/**
 * Convert a data URL to a Buffer and content type
 */
function parseDataUrl(dataUrl: string): { buffer: Buffer; contentType: string } {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) {
    throw new Error("Invalid data URL format. Expected: data:<mime>;base64,<data>");
  }
  return {
    contentType: matches[1],
    buffer: Buffer.from(matches[2], "base64"),
  };
}

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
   * Process reference images - upload local files/data URLs to fal.ai storage
   * Returns an array of URLs that fal.ai can access
   */
  private async processReferenceImages(referenceImages: string[]): Promise<string[]> {
    if (referenceImages.length === 0) {
      return [];
    }

    logger.debugLog("Processing reference images", {
      count: referenceImages.length,
      types: referenceImages.map((img, i) => ({
        index: i,
        type: getImageInputType(img),
        preview: img.substring(0, 100) + (img.length > 100 ? "..." : ""),
      })),
    });

    const processedUrls: string[] = [];

    for (let i = 0; i < referenceImages.length; i++) {
      const image = referenceImages[i];
      const inputType = getImageInputType(image);

      logger.debugLog(`Processing reference image ${i + 1}/${referenceImages.length}`, {
        inputType,
        inputLength: image.length,
      });

      try {
        if (inputType === "url") {
          // URL - use directly, but validate it's accessible
          logger.debugLog(`Reference image ${i + 1}: Using URL directly`, { url: image });
          processedUrls.push(image);
        } else if (inputType === "data_url") {
          // Data URL - parse and upload to fal.ai storage
          logger.debugLog(`Reference image ${i + 1}: Parsing data URL and uploading`, {
            dataUrlLength: image.length,
          });

          const { buffer, contentType } = parseDataUrl(image);
          logger.debugLog(`Reference image ${i + 1}: Parsed data URL`, {
            contentType,
            bufferSize: buffer.length,
          });

          const uploadStart = Date.now();
          const blob = new Blob([buffer], { type: contentType });
          const uploadedUrl = await withTimeout(
            async () => fal.storage.upload(blob),
            UPLOAD_TIMEOUT_MS
          );
          const uploadDuration = Date.now() - uploadStart;

          logger.debugLog(`Reference image ${i + 1}: Uploaded data URL to fal.ai storage`, {
            uploadedUrl,
            uploadDurationMs: uploadDuration,
          });
          processedUrls.push(uploadedUrl);
        } else {
          // Local file - read and upload to fal.ai storage
          logger.debugLog(`Reference image ${i + 1}: Reading local file`, { path: image });

          if (!existsSync(image)) {
            throw new Error(`Reference image file not found: ${image}`);
          }

          const fileBuffer = readFileSync(image);
          const mimeType = getMimeType(image);
          const fileName = basename(image);

          logger.debugLog(`Reference image ${i + 1}: Read local file`, {
            path: image,
            fileName,
            mimeType,
            fileSize: fileBuffer.length,
          });

          const uploadStart = Date.now();
          const blob = new Blob([fileBuffer], { type: mimeType });
          const uploadedUrl = await withTimeout(
            async () => fal.storage.upload(blob),
            UPLOAD_TIMEOUT_MS
          );
          const uploadDuration = Date.now() - uploadStart;

          logger.debugLog(`Reference image ${i + 1}: Uploaded local file to fal.ai storage`, {
            originalPath: image,
            uploadedUrl,
            uploadDurationMs: uploadDuration,
          });
          processedUrls.push(uploadedUrl);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to process reference image ${i + 1}`, {
          inputType,
          error: errorMessage,
          inputPreview: image.substring(0, 100),
        });
        throw new Error(`Failed to process reference image ${i + 1}: ${errorMessage}`);
      }
    }

    logger.debugLog("All reference images processed successfully", {
      inputCount: referenceImages.length,
      outputCount: processedUrls.length,
      urls: processedUrls,
    });

    return processedUrls;
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
    logger.debugLog("Fetching image from URL", { url: imageUrl });

    const response = await fetch(imageUrl);
    if (!response.ok) {
      logger.error("Failed to download image", {
        url: imageUrl,
        status: response.status,
        statusText: response.statusText,
      });
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    logger.debugLog("Image fetched successfully", {
      url: imageUrl,
      sizeBytes: buffer.length,
      contentType: response.headers.get("content-type"),
    });

    // Ensure output directory exists
    const outputDir = dirname(outputPath);
    if (outputDir && !existsSync(outputDir)) {
      logger.debugLog("Creating output directory", { outputDir });
      mkdirSync(outputDir, { recursive: true });
    }

    writeFileSync(outputPath, buffer);
    logger.debugLog("Image saved to disk", {
      path: outputPath,
      sizeBytes: buffer.length,
    });
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

    logger.info("=== Image Generation Request ===", {
      prompt: prompt.substring(0, 200) + (prompt.length > 200 ? "..." : ""),
      promptLength: prompt.length,
      model,
      outputPath,
      hasReferenceImages,
      referenceImageCount: referenceImages.length,
      aspectRatio: aspectRatio || "(default)",
      outputFormat,
      resolution,
      numImages,
      enableWebSearch,
    });

    // Validate aspect ratio if provided
    if (aspectRatio) {
      logger.debugLog("Validating aspect ratio", { aspectRatio, hasReferenceImages });
      // "auto" is only valid when using reference images (edit endpoint)
      if (aspectRatio === "auto" && !hasReferenceImages) {
        const error = `Aspect ratio "auto" is only valid when using reference_images. For text-to-image, use: ${ASPECT_RATIOS.join(", ")}`;
        logger.error("Aspect ratio validation failed", { aspectRatio, error });
        throw new Error(error);
      }
      // Validate against full list (including "auto" for edit)
      if (!ASPECT_RATIOS_WITH_AUTO.includes(aspectRatio)) {
        const error = `Invalid aspect ratio "${aspectRatio}". Valid options: ${ASPECT_RATIOS_WITH_AUTO.join(", ")}`;
        logger.error("Aspect ratio validation failed", { aspectRatio, error });
        throw new Error(error);
      }
      logger.debugLog("Aspect ratio validation passed", { aspectRatio });
    }

    // Validate reference images count
    const maxImages = MAX_REFERENCE_IMAGES[model];
    if (referenceImages.length > maxImages) {
      const error = `Maximum ${maxImages} reference images allowed for ${model}`;
      logger.error("Reference image count validation failed", {
        provided: referenceImages.length,
        maximum: maxImages,
        model,
      });
      throw new Error(error);
    }

    // Validate resolution (only Pro supports 2K/4K)
    if (!isPro && resolution !== "1K") {
      const error = "Only nano-banana-pro supports 2K and 4K resolution";
      logger.error("Resolution validation failed", { resolution, model, error });
      throw new Error(error);
    }

    // Get the appropriate endpoint
    const modelId = this.getModelId(model, hasReferenceImages);

    logger.debugLog("Model endpoint selected", {
      model,
      modelId,
      isEditEndpoint: hasReferenceImages,
    });

    try {
      // Process reference images (upload local files/data URLs to fal.ai storage)
      let processedImageUrls: string[] = [];
      if (hasReferenceImages) {
        logger.info("Processing reference images for upload", {
          count: referenceImages.length,
          types: referenceImages.map((img) => getImageInputType(img)),
        });
        const uploadStart = Date.now();
        processedImageUrls = await this.processReferenceImages(referenceImages);
        const uploadDuration = Date.now() - uploadStart;
        logger.info("Reference images processed", {
          count: processedImageUrls.length,
          totalUploadTimeMs: uploadDuration,
          urls: processedImageUrls,
        });
      }

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

      // Add processed reference images if any (for edit endpoint)
      if (processedImageUrls.length > 0) {
        input.image_urls = processedImageUrls;
      }

      // Add Pro-only options
      if (isPro) {
        input.resolution = resolution;
        if (enableWebSearch) {
          input.enable_web_search = true;
        }
      }

      logger.debugLog("API request prepared", {
        modelId,
        input: {
          ...input,
          prompt: (input.prompt as string).substring(0, 100) + "...",
        },
      });

      // Use retry wrapper for transient errors and timeout protection
      logger.info("Calling fal.ai API", { modelId, timeoutMs: DEFAULT_TIMEOUT_MS });
      const apiStart = Date.now();

      const response = await withRetry(
        () =>
          withTimeout(
            async () => {
              logger.debugLog("Sending request to fal.ai", { modelId });
              const result = await fal.subscribe(modelId, {
                input,
                logs: false,
              });
              logger.debugLog("Received response from fal.ai", {
                hasImages: !!result.data?.images,
                imageCount: result.data?.images?.length || 0,
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

      const apiDuration = Date.now() - apiStart;
      logger.info("fal.ai API call completed", {
        durationMs: apiDuration,
        imageCount: response.images?.length || 0,
      });

      // Validate response
      if (!response.images || response.images.length === 0) {
        logger.error("No images in API response", { response });
        throw new Error("No image data found in response");
      }

      // Log response details
      logger.debugLog("API response details", {
        imageCount: response.images.length,
        images: response.images.map((img, i) => ({
          index: i,
          url: img.url,
          width: img.width,
          height: img.height,
          contentType: img.content_type,
          fileSize: img.file_size,
        })),
        description: response.description,
      });

      // Download and save the first image
      logger.info("Downloading generated image", {
        url: response.images[0].url,
        outputPath,
      });
      const downloadStart = Date.now();
      await this.downloadAndSave(response.images[0].url, outputPath);
      const downloadDuration = Date.now() - downloadStart;
      logger.info("Image downloaded and saved", {
        outputPath,
        downloadDurationMs: downloadDuration,
      });

      // If multiple images requested, save with numbered suffixes
      if (numImages > 1 && response.images.length > 1) {
        logger.debugLog("Downloading additional images", {
          additionalCount: response.images.length - 1,
        });
        for (let i = 1; i < response.images.length; i++) {
          const numberedPath = outputPath.replace(/(\.[^.]+)$/, `_${i + 1}$1`);
          logger.debugLog(`Downloading image ${i + 1}`, {
            url: response.images[i].url,
            outputPath: numberedPath,
          });
          await this.downloadAndSave(response.images[i].url, numberedPath);
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info("=== Image Generation Complete ===", {
        model,
        totalDurationMs: durationMs,
        apiDurationMs: apiDuration,
        outputPath,
        wasEdit: hasReferenceImages,
      });

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
      const errorStack = error instanceof Error ? error.stack : undefined;
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
      } else if (errorMessage.includes("Unprocessable Entity") || errorMessage.includes("422")) {
        errorType = "INVALID_REQUEST";
      }

      logger.error("=== Image Generation Failed ===", {
        errorType,
        errorMessage,
        errorStack,
        model,
        modelId,
        durationMs,
        prompt: prompt.substring(0, 100) + "...",
        hasReferenceImages,
        referenceImageCount: referenceImages.length,
        aspectRatio,
      });

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
