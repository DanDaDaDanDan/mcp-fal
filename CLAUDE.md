# mcp-fal Developer Documentation

MCP server for fal.ai image generation using Nano Banana models.

## Architecture

```
src/
├── index.ts              # MCP server entry point, tool definitions
├── types.ts              # Shared types, constants, interfaces
├── logger.ts             # Logging to stderr + optional file logging
├── retry.ts              # Retry with exponential backoff + timeout
└── providers/
    └── fal-image.ts      # fal.ai image generation provider
```

## Key Design Decisions

1. **Unified generate_image tool**: Single tool handles both text-to-image and image editing. Internally routes to the appropriate fal.ai endpoint based on whether reference images are provided.

2. **Transparent endpoint routing**: fal.ai exposes separate endpoints for text-to-image (`fal-ai/nano-banana`) and editing (`fal-ai/nano-banana/edit`), but the underlying model is the same. This MCP abstracts that away - users just use `generate_image` with optional `reference_images`.

3. **Fail fast**: Provider is created at startup; fails fast if FAL_KEY is missing.

4. **Structured errors**: Errors are categorized (AUTH_ERROR, RATE_LIMIT, etc.) for actionable feedback.

5. **Local file saving**: fal.ai returns image URLs; we download and save to the specified output path.

## fal.ai API Endpoint Routing

| User Request | fal.ai Endpoint |
|--------------|-----------------|
| `generate_image` (no reference_images) | `fal-ai/nano-banana` or `fal-ai/nano-banana-pro` |
| `generate_image` (with reference_images) | `fal-ai/nano-banana/edit` or `fal-ai/nano-banana-pro/edit` |

This is purely an implementation detail - users don't need to know about separate endpoints.

## Model Capabilities

### Nano Banana (Gemini 2.5 Flash Image)
- Fast, cost-effective (~$0.039/image)
- Max 3 reference images
- 1K resolution only

### Nano Banana Pro (Gemini 3 Pro Image)
- Higher quality (~$0.15/image, 4K = $0.30)
- Max 14 reference images
- 1K/2K/4K resolution
- Web search capability

## Tools Exposed

1. **generate_image**: Unified image generation with optional reference images
2. **list_models**: List available models and capabilities

## Environment Variables

| Variable    | Required | Default  | Description                              |
|-------------|----------|----------|------------------------------------------|
| FAL_KEY     | Yes      | -        | fal.ai API key (or FAL_API_KEY)          |
| MCP_DEBUG   | No       | true     | Debug logging; set to "false" to disable |
| MCP_LOG_DIR | No       | ./logs   | Log directory; set to "none" to disable  |

## Error Handling

Errors are categorized and returned with actionable messages:
- `AUTH_ERROR`: Invalid/missing API key
- `RATE_LIMIT`: Too many requests
- `CONTENT_BLOCKED`: Safety filter triggered
- `TIMEOUT`: Operation took too long
- `GENERATION_ERROR`: Generic failure

## Retry Logic

- Max 3 retries with exponential backoff
- Initial delay: 1s, max delay: 30s
- Retryable: rate limits, 429/502/503, connection errors
- Generation timeout: 3 minutes
