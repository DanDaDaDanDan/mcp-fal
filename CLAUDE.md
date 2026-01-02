# mcp-fal

MCP server providing Claude Code access to fal.ai image generation (Nano Banana models).

## Philosophy

1. **Fail fast** - Surface errors immediately with clear messages. Don't silently swallow failures or return partial results.
2. **Don't guess, research** - When API behavior is unclear, check the docs. Model IDs and parameters change; verify against https://fal.ai/docs
3. **Eager initialization** - Create provider instances at startup. Fail at init, not use-time.
4. **Structured errors** - Categorize errors (AUTH_ERROR, RATE_LIMIT, CONTENT_BLOCKED, TIMEOUT) for actionable feedback.
5. **Unified interface** - Hide API complexity (separate endpoints for text-to-image vs editing) behind a single intuitive tool.

## SDK

Uses `@fal-ai/client` for fal.ai API access.

**Required version:**
- `@fal-ai/client`: ^1.3.0

## Models

| Friendly Name | API Model ID | Type | Max Refs | Resolution |
|---------------|--------------|------|----------|------------|
| nano-banana | `fal-ai/nano-banana` | Image (fast) | 3 | 1K |
| nano-banana-pro | `fal-ai/nano-banana-pro` | Image (high-quality) | 14 | 1K/2K/4K |

**Default model:** `nano-banana` - Fast and cost-effective.

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

3. **Automatic reference image handling**: Reference images can be URLs, local file paths, or data URLs. Local files and data URLs are automatically uploaded to fal.ai storage before being used.

4. **Fail fast**: Provider is created at startup; fails fast if FAL_KEY is missing.

5. **Structured errors**: Errors are categorized (AUTH_ERROR, RATE_LIMIT, INVALID_REQUEST, etc.) for actionable feedback.

6. **Local file saving**: fal.ai returns image URLs; we download and save to the specified output path.

7. **Comprehensive logging**: All operations are logged with detailed context for debugging.

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

## Reference Image Processing

When `reference_images` is provided, the server detects the input type and processes accordingly:

| Input Type | Detection | Processing |
|------------|-----------|------------|
| URL | Starts with `http://` or `https://` | Used directly |
| Local file | Any other path | Read file → Upload to fal.ai storage |
| Data URL | Starts with `data:` | Parse base64 → Upload to fal.ai storage |

**Supported image formats:** PNG, JPEG, GIF, WebP, BMP

### Processing Flow

1. Each reference image input is analyzed to determine its type
2. URLs are passed through directly to fal.ai
3. Local files are read, validated, and uploaded to fal.ai storage via `fal.storage.upload()`
4. Data URLs are parsed, converted to buffers, and uploaded to fal.ai storage
5. All resulting URLs are passed to the edit endpoint as `image_urls`

### Common Errors

- `Reference image file not found: <path>` - Local file doesn't exist
- `Invalid data URL format` - Data URL is malformed
- `TIMEOUT: Operation timed out after 30000ms` - Upload took too long (30s per image)

## Error Categories

| Category | HTTP Status | Meaning |
|----------|-------------|---------|
| AUTH_ERROR | 401 | Invalid or missing fal.ai API key |
| RATE_LIMIT | 429 | API quota exceeded |
| SAFETY_BLOCK | 400 | Blocked by safety filter |
| CONTENT_BLOCKED | 400 | Content policy violation |
| TIMEOUT | - | Request exceeded timeout |
| VALIDATION_ERROR | 422 | Invalid input parameters (e.g., bad image format) |
| API_ERROR | 4xx/5xx | Other API errors |

## Retry Logic

- Max 3 retries with exponential backoff
- Initial delay: 1s, max delay: 30s
- Retryable: rate limits, 429/502/503, connection errors
- Generation timeout: 3 minutes
- Upload timeout: 30 seconds per reference image

## Logging

Comprehensive logging is enabled by default. Key log events:

- `=== Image Generation Request ===` - Start of generation with all parameters
- `Processing reference images` - Reference image processing begins
- `Reference image X: Uploading local file` - Local file being uploaded
- `Calling fal.ai API` - API call starting
- `fal.ai API call completed` - API call finished
- `=== Image Generation Complete ===` - Successful completion with timing
- `=== Image Generation Failed ===` - Error with full context
