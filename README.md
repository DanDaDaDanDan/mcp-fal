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
claude mcp add -s user -t stdio mcp-fal \
  -e FAL_KEY=your-api-key-here \
  -- node /path/to/mcp-fal/dist/index.js
```

Or manually add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "mcp-fal": {
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
| `reference_images` | string[] | | Reference images for editing/composition (see formats below) |
| `aspect_ratio` | string | | e.g., `"16:9"`, `"1:1"`, `"auto"` |

**Max reference images:** 3 for nano-banana, 14 for nano-banana-pro

**Supported aspect ratios:** 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9, auto (edit only)

#### Reference Image Formats

The `reference_images` parameter accepts three formats:

1. **URLs** - Publicly accessible image URLs
   ```json
   ["https://example.com/photo.jpg"]
   ```

2. **Local file paths** - Absolute paths to local image files (automatically uploaded to fal.ai storage)
   ```json
   ["D:/images/photo.png", "/home/user/image.jpg"]
   ```

3. **Data URLs** - Base64-encoded images (automatically uploaded to fal.ai storage)
   ```json
   ["data:image/png;base64,iVBORw0KGgo..."]
   ```

**Supported image formats:** PNG, JPEG, GIF, WebP, BMP

#### Examples

**Text-to-image generation:**
```
Use generate_image to create a sunset over mountains, save to /tmp/sunset.png
```

**Image editing with URL:**
```
Use generate_image with reference_images=["https://example.com/photo.jpg"] to add a hat to the person
```

**Image editing with local file:**
```
Use generate_image with reference_images=["D:/photos/portrait.png"] to change the background to a beach
```

**Style transfer with multiple references:**
```
Use generate_image with reference_images=["style.png", "content.jpg"] to apply the style to the content image
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
