/**
 * Logger utility for mcp-fal
 * Logs to stderr (stdout is reserved for MCP protocol) and optionally to files
 */

import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";

type LogLevel = "debug" | "info" | "warn" | "error";

interface UsageLogEntry {
  timestamp: string;
  model: string;
  type: "image";
  durationMs: number;
  success: boolean;
  error?: string;
}

class Logger {
  private debugEnabled: boolean;
  private logDir: string | null;

  constructor() {
    this.debugEnabled = process.env.MCP_DEBUG === "true";
    const logDirEnv = process.env.MCP_LOG_DIR;
    this.logDir = logDirEnv === "none" ? null : logDirEnv || null;

    if (this.logDir && !existsSync(this.logDir)) {
      try {
        mkdirSync(this.logDir, { recursive: true });
      } catch {
        // Fail silently - file logging is optional
        this.logDir = null;
      }
    }
  }

  private formatMessage(level: LogLevel, message: string, data?: object): string {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : "";
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}`;
  }

  private writeToFile(filename: string, content: string): void {
    if (!this.logDir) return;
    try {
      appendFileSync(join(this.logDir, filename), content + "\n");
    } catch {
      // Fail silently
    }
  }

  debugLog(message: string, data?: object): void {
    if (!this.debugEnabled) return;
    const formatted = this.formatMessage("debug", message, data);
    console.error(formatted);
    this.writeToFile("mcp-fal.log", formatted);
  }

  info(message: string, data?: object): void {
    const formatted = this.formatMessage("info", message, data);
    console.error(formatted);
    this.writeToFile("mcp-fal.log", formatted);
  }

  warn(message: string, data?: object): void {
    const formatted = this.formatMessage("warn", message, data);
    console.error(formatted);
    this.writeToFile("mcp-fal.log", formatted);
  }

  error(message: string, data?: object): void {
    const formatted = this.formatMessage("error", message, data);
    console.error(formatted);
    this.writeToFile("mcp-fal.log", formatted);
  }

  logUsage(entry: UsageLogEntry): void {
    this.writeToFile("usage.jsonl", JSON.stringify(entry));
  }
}

// Singleton instance
export const logger = new Logger();
