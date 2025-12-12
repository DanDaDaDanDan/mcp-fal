# mcp-fal

MCP server for Claude Code providing access to fal.ai's Nano Banana image generation models:

- **Nano Banana** - Fast image generation (Gemini 2.5 Flash Image)
- **Nano Banana Pro** - High-fidelity image generation (Gemini 3 Pro Image)

## Setup

### 1. Get API Key

Get your API key from [fal.ai Dashboard](https://fal.ai/dashboard/keys).

### 2. Install Dependencies & Build

```bash
cd mcp-fal
npm install && npm run build
```

### 3. Add to Claude Code

```bash
claude mcp add --transport stdio fal \
  --env FAL_KEY=your-api-key-here \
  -- node /path/to/mcp-fal/dist/index.js
```

Or manually add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "fal": {
      "command": "node",
      "args": ["/path/to/mcp-fal/dist/index.js"],
      "env": {
        "FAL_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Tools

### generate_image

Generate images using Nano Banana or Nano Banana Pro. Supports text-to-image generation and image editing with reference images.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | ✓ | Image description or editing instruction |
| `output_path` | string | ✓ | Where to save the image |
| `model` | `"nano-banana"` \| `"nano-banana-pro"` | | Model (default: `"nano-banana"`) |
| `reference_images` | string[] | | URLs of images for editing/composition |
| `aspect_ratio` | string | | e.g., `"16:9"`, `"1:1"`, `"auto"` |

**Max reference images:** 3 for nano-banana, 14 for nano-banana-pro

**Supported aspect ratios:** 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9, auto (edit only)

**Example:**
```
Use generate_image to create a sunset over mountains, save to /tmp/sunset.png
```

**Editing example:**
```
Use generate_image with reference_images=["https://example.com/photo.jpg"] to make the person wear a hat
```

### list_models

List available models and their capabilities.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FAL_KEY` | ✓ | - | fal.ai API key (also accepts `FAL_API_KEY`) |
| `MCP_DEBUG` | | `true` | Debug logging; set to `"false"` to disable |
| `MCP_LOG_DIR` | | `./logs` | Log directory; set to `"none"` to disable |

## Model Details

| Model | API ID | Description | Price |
|-------|--------|-------------|-------|
| nano-banana | `fal-ai/nano-banana` | Fast image generation | ~$0.039/image |
| nano-banana-pro | `fal-ai/nano-banana-pro` | High-fidelity images, 4K support | ~$0.15/image |

**Note:** When reference images are provided, the server automatically routes to the `/edit` endpoint variant.

## Development

```bash
npm run dev    # Watch mode
npm run build  # Build
npm start      # Run
```

## License

MIT
