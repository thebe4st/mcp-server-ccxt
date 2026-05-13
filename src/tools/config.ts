/**
 * Configuration Tools
 * Tools for configuring the MCP server
 * 
 * 配置工具
 * 用于配置MCP服务器的工具
 */
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { log, LogLevel } from '../utils/logging.js';
import { getProxyConfig, clearExchangeCache } from '../exchange/manager.js';

/**
 * Register configuration tools with the MCP server
 * @param server MCP server instance
 */
export function registerConfigTools(server: McpServer) {

  // Set proxy configuration
  // 设置代理配置
  server.tool("set-proxy-config", "Configure proxy settings for all exchanges and clear exchange cache", {
    enabled: z.boolean().describe("Enable or disable proxy"),
    clearCache: z.boolean().default(true).describe("Clear exchange cache to apply changes immediately")
  }, async ({ enabled, clearCache }) => {
    try {
      // For security and simplicity, we'll use environment variables
      // In a production app, you might want to use a more persistent storage method
      process.env.USE_PROXY = enabled.toString();
      
      log(LogLevel.INFO, `Proxy configuration updated. Enabled: ${enabled}`);
      
      // Clear exchange cache if requested
      if (clearCache) {
        clearExchangeCache();
        log(LogLevel.INFO, "Exchange cache cleared to apply new proxy settings");
      }
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            message: "Proxy configuration updated successfully",
            cacheCleared: clearCache,
            note: clearCache 
              ? "Exchange cache was cleared. New proxy settings will be applied immediately."
              : "Changes will only affect newly created exchange instances. Use clear-exchange-cache tool for immediate effect."
          }, null, 2)
        }]
      };
    } catch (error) {
      log(LogLevel.ERROR, `Error updating proxy configuration: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: [{
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  });
}
