#!/usr/bin/env node

/**
 * MCP Server: mcp-fal
 *
 * Provides image generation capabilities using fal.ai's Nano Banana models.
 *
 * Models:
 *   - nano-banana: Gemini 2.5 Flash Image - fast image generation
 *   - nano-banana-pro: Gemini 3 Pro Image - high-fidelity image generation
 *
 * Tools:
 *   - generate_image: Generate images using Nano Banana or Nano Banana Pro
 *   - list_models: List available models and their capabilities
 *
 * Environment Variables:
 *   - FAL_KEY: Required for all model access (also accepts FAL_API_KEY)
 *   - MCP_DEBUG: Set to "true" for verbose logging
 *   - MCP_LOG_DIR: Directory for log files (optional)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { FalImageProvider } from "./providers/fal-image.js";
import {
  isSupportedImageModel,
  SUPPORTED_IMAGE_MODELS,
  ASPECT_RATIOS_WITH_AUTO,
} from "./types.js";
import { logger } from "./logger.js";

// Configuration from environment - fail fast if missing
const FAL_KEY = process.env.FAL_KEY || process.env.FAL_API_KEY;
if (!FAL_KEY) {
  console.error(
    "FATAL: FAL_KEY environment variable is required. " +
      "Get your API key from https://fal.ai/dashboard/keys"
  );
  process.exit(1);
}

// Initialize provider eagerly at startup - fail fast
const imageProvider = new FalImageProvider(FAL_KEY);

// Create MCP server
const server = new Server(
  {
    name: "mcp-fal",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool definitions
const TOOLS = [
  {
    name: "generate_image",
    description:
      "Generate images using Nano Banana (fast) or Nano Banana Pro (high-quality). Use this for creating images from text descriptions, or editing images with reference inputs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: {
          type: "string",
          description: "Description of the image to generate",
        },
        output_path: {
          type: "string",
          description: "File path where the generated image will be saved (e.g., '/tmp/image.png')",
        },
        model: {
          type: "string",
          enum: [...SUPPORTED_IMAGE_MODELS],
          description:
            "Image model: 'nano-banana' for fast generation (default), 'nano-banana-pro' for high-fidelity output",
          default: "nano-banana",
        },
        reference_images: {
          type: "array",
          items: { type: "string" },
          description:
            "URLs of reference images for editing, composition, or style transfer. Max 3 for nano-banana, max 14 for nano-banana-pro.",
        },
        aspect_ratio: {
          type: "string",
          enum: [...ASPECT_RATIOS_WITH_AUTO],
          description:
            "Aspect ratio for the generated image. Use 'auto' with reference_images to preserve original aspect ratio. Default: 1:1 for generation, auto for editing.",
        },
      },
      required: ["prompt", "output_path"],
    },
  },
  {
    name: "list_models",
    description: "List all available fal.ai image models and their capabilities",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  const { name, arguments: args } = request.params;

  // List models tool
  if (name === "list_models") {
    const models = [];

    models.push({
      ...imageProvider.getModelInfo("nano-banana"),
      available: true,
    });
    models.push({
      ...imageProvider.getModelInfo("nano-banana-pro"),
      available: true,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ models }, null, 2),
        },
      ],
    };
  }

  // Generate image tool
  if (name === "generate_image") {
    const {
      prompt,
      output_path: outputPath,
      model,
      reference_images: referenceImages,
      aspect_ratio: aspectRatio,
    } = args as {
      prompt: string;
      output_path: string;
      model?: "nano-banana" | "nano-banana-pro";
      reference_images?: string[];
      aspect_ratio?: string;
    };

    // Validate prompt
    if (!prompt || prompt.trim().length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "Error: Prompt cannot be empty",
          },
        ],
        isError: true,
      };
    }

    // Validate output path
    if (!outputPath || outputPath.trim().length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "Error: output_path is required",
          },
        ],
        isError: true,
      };
    }

    // Validate model if provided
    if (model && !isSupportedImageModel(model)) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Unknown image model "${model}". Supported models: ${SUPPORTED_IMAGE_MODELS.join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await imageProvider.generate({
        prompt,
        outputPath,
        model,
        referenceImages,
        aspectRatio: aspectRatio as any,
      });

      // Return successful result
      return {
        content: [
          {
            type: "text",
            text: `Image saved to: ${result.imagePath}`,
          },
        ],
        // Include metadata about the generation
        _meta: {
          model: result.model,
          imagePath: result.imagePath,
          usage: result.usage,
        },
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Image generation failed", { error: errorMessage });

      return {
        content: [
          {
            type: "text",
            text: `Error: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Unknown tool
  return {
    content: [
      {
        type: "text",
        text: `Error: Unknown tool "${name}"`,
      },
    ],
    isError: true,
  };
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();

  // Log startup
  logger.info("Starting MCP server", {
    version: "1.0.0",
    falConfigured: !!FAL_KEY,
    debugMode: process.env.MCP_DEBUG === "true",
    logDir: process.env.MCP_LOG_DIR || "none",
  });

  await server.connect(transport);

  logger.info("Server running and ready for connections");
}

main().catch((error) => {
  logger.error("Fatal error", { error: error.message });
  process.exit(1);
});
