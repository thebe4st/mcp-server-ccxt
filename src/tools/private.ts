/**
 * Private API Tools
 * Tools for accessing private cryptocurrency exchange functionality
 * 
 * 私有API工具
 * 用于访问私有加密货币交易所功能的工具
 */
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getExchangeWithCredentials, MarketType, getCredentialsFromEnv, DEFAULT_USE_SANDBOX } from '../exchange/manager.js';
import { log, LogLevel } from '../utils/logging.js';
import { rateLimiter } from '../utils/rate-limiter.js';

/**
 * Helper function to resolve credentials from params or environment variables
 */
function resolveCredentials(exchange: string, apiKey?: string, secret?: string, passphrase?: string) {
  if (apiKey && secret) {
    return { apiKey, secret, passphrase: passphrase || undefined };
  }
  
  const envCredentials = getCredentialsFromEnv(exchange, DEFAULT_USE_SANDBOX);
  if (envCredentials) {
    return { ...envCredentials, passphrase: passphrase || envCredentials.passphrase };
  }
  
  throw new Error(`No API credentials provided for ${exchange}. Please either provide apiKey/secret parameters or set ${exchange.toUpperCase()}_API_KEY and ${exchange.toUpperCase()}_SECRET environment variables.`);
}

export function registerPrivateTools(server: McpServer) {
  // Account balance and positions
  // 账户余额和持仓
  server.tool("account-balance", "Get your account balance and positions from a crypto exchange", {
    exchange: z.string().describe("Exchange ID (e.g., binance, coinbase)"),
    apiKey: z.string().optional().describe("API key for authentication (uses environment variable if not provided)"),
    secret: z.string().optional().describe("API secret for authentication (uses environment variable if not provided)"),
    passphrase: z.string().optional().describe("Passphrase for authentication (required for some exchanges like KuCoin)"),
    marketType: z.enum(["spot", "future", "swap", "option", "margin"]).optional().describe("Market type (default: spot)")
  }, async ({ exchange, apiKey, secret, passphrase, marketType }) => {
    try {
      const credentials = resolveCredentials(exchange, apiKey, secret, passphrase);
      
      return await rateLimiter.execute(exchange, async () => {
        // Get exchange with market type
        const ex = getExchangeWithCredentials(exchange, credentials.apiKey, credentials.secret, marketType, credentials.passphrase);
        
        // Fetch balance
        log(LogLevel.INFO, `Fetching account balance for ${exchange}`);
        const balance = await ex.fetchBalance();
        
        // Fetch positions if supported
        let positions = [];
        if (ex.has.fetchPositions) {
          try {
            log(LogLevel.INFO, `Fetching positions for ${exchange}`);
            positions = await ex.fetchPositions();
          } catch (posError) {
            log(LogLevel.WARNING, `Failed to fetch positions for ${exchange}: ${posError instanceof Error ? posError.message : String(posError)}`);
            positions = [];
          }
        }
        
        // Format the balance for better readability
        const result = {
          balance: {
            total: balance.total,
            free: balance.free,
            used: balance.used,
            timestamp: new Date(balance.timestamp || Date.now()).toISOString()
          },
          positions: positions.map(pos => ({
            symbol: pos.symbol,
            side: pos.side,
            size: pos.contracts || pos.amount,
            entryPrice: pos.entryPrice,
            markPrice: pos.markPrice,
            liquidationPrice: pos.liquidationPrice,
            leverage: pos.leverage,
            margin: pos.margin,
            unrealizedPnl: pos.unrealizedPnl,
            type: pos.type
          })),
          positionsCount: positions.length,
          marketType: marketType || 'spot'
        };
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      });
    } catch (error) {
      log(LogLevel.ERROR, `Error fetching account balance: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: [{
          type: "text",
          text: `Error fetching account balance: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  });

  // Place market order
  // 下市价单
  server.tool("place-market-order", "Place a market order on an exchange", {
    exchange: z.string().describe("Exchange ID (e.g., binance, coinbase)"),
    symbol: z.string().describe("Trading pair symbol (e.g., BTC/USDT)"),
    side: z.enum(['buy', 'sell']).describe("Order side: buy or sell"),
    amount: z.number().positive().describe("Amount to buy/sell"),
    apiKey: z.string().optional().describe("API key for authentication (uses environment variable if not provided)"),
    secret: z.string().optional().describe("API secret for authentication (uses environment variable if not provided)"),
    passphrase: z.string().optional().describe("Passphrase for authentication (required for some exchanges like KuCoin)"),
    marketType: z.enum(["spot", "future", "swap", "option", "margin"]).optional().describe("Market type (default: spot)")
  }, async ({ exchange, symbol, side, amount, apiKey, secret, passphrase, marketType }) => {
    try {
      const credentials = resolveCredentials(exchange, apiKey, secret, passphrase);
      
      return await rateLimiter.execute(exchange, async () => {
        // Get exchange with market type
        const ex = getExchangeWithCredentials(exchange, credentials.apiKey, credentials.secret, marketType, credentials.passphrase);
        
        // Place market order
        log(LogLevel.INFO, `Placing ${side} market order for ${symbol} on ${exchange}, amount: ${amount}`);
        const order = await ex.createOrder(symbol, 'market', side, amount);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(order, null, 2)
          }]
        };
      });
    } catch (error) {
      log(LogLevel.ERROR, `Error placing market order: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: [{
          type: "text",
          text: `Error placing market order: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  });

  // Set leverage
  // 设置杠杆
  server.tool("set-leverage", "Set leverage for futures trading", {
    exchange: z.string().describe("Exchange ID (e.g., binance, bybit)"),
    symbol: z.string().describe("Trading pair symbol (e.g., BTC/USDT)"),
    leverage: z.number().positive().describe("Leverage value"),
    apiKey: z.string().optional().describe("API key for authentication (uses environment variable if not provided)"),
    secret: z.string().optional().describe("API secret for authentication (uses environment variable if not provided)"),
    passphrase: z.string().optional().describe("Passphrase for authentication (required for some exchanges like KuCoin)"),
    marketType: z.enum(["future", "swap"]).default("future").describe("Market type (default: future)")
  }, async ({ exchange, symbol, leverage, apiKey, secret, passphrase, marketType }) => {
    try {
      const credentials = resolveCredentials(exchange, apiKey, secret, passphrase);
      
      return await rateLimiter.execute(exchange, async () => {
        // Get futures exchange
        const ex = getExchangeWithCredentials(exchange, credentials.apiKey, credentials.secret, marketType, credentials.passphrase);
        
        // Set leverage
        log(LogLevel.INFO, `Setting leverage to ${leverage}x for ${symbol} on ${exchange} (${marketType})`);
        const result = await ex.setLeverage(leverage, symbol);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      });
    } catch (error) {
      log(LogLevel.ERROR, `Error setting leverage: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: [{
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  });
  
  // Set margin mode
  // 设置保证金模式
  server.tool("set-margin-mode", "Set margin mode for futures trading", {
    exchange: z.string().describe("Exchange ID (e.g., binance, bybit)"),
    symbol: z.string().describe("Trading pair symbol (e.g., BTC/USDT)"),
    marginMode: z.enum(["cross", "isolated"]).describe("Margin mode: cross or isolated"),
    apiKey: z.string().optional().describe("API key for authentication (uses environment variable if not provided)"),
    secret: z.string().optional().describe("API secret for authentication (uses environment variable if not provided)"),
    passphrase: z.string().optional().describe("Passphrase for authentication (required for some exchanges like KuCoin)"),
    marketType: z.enum(["future", "swap"]).default("future").describe("Market type (default: future)")
  }, async ({ exchange, symbol, marginMode, apiKey, secret, passphrase, marketType }) => {
    try {
      const credentials = resolveCredentials(exchange, apiKey, secret, passphrase);
      
      return await rateLimiter.execute(exchange, async () => {
        // Get futures exchange
        const ex = getExchangeWithCredentials(exchange, credentials.apiKey, credentials.secret, marketType, credentials.passphrase);
        
        // Set margin mode
        log(LogLevel.INFO, `Setting margin mode to ${marginMode} for ${symbol} on ${exchange} (${marketType})`);
        const result = await ex.setMarginMode(marginMode, symbol);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      });
    } catch (error) {
      log(LogLevel.ERROR, `Error setting margin mode: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: [{
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  });
  
  // Place futures market order
  // 下期货市价单
  server.tool("place-futures-market-order", "Place a futures market order", {
    exchange: z.string().describe("Exchange ID (e.g., binance, bybit)"),
    symbol: z.string().describe("Trading pair symbol (e.g., BTC/USDT)"),
    side: z.enum(['buy', 'sell']).describe("Order side: buy or sell"),
    amount: z.number().positive().describe("Amount to buy/sell"),
    params: z.record(z.any()).optional().describe("Additional order parameters"),
    apiKey: z.string().optional().describe("API key for authentication (uses environment variable if not provided)"),
    secret: z.string().optional().describe("API secret for authentication (uses environment variable if not provided)"),
    passphrase: z.string().optional().describe("Passphrase for authentication (required for some exchanges like KuCoin)"),
    marketType: z.enum(["future", "swap"]).default("future").describe("Market type (default: future)")
  }, async ({ exchange, symbol, side, amount, params, apiKey, secret, passphrase, marketType }) => {
    try {
      const credentials = resolveCredentials(exchange, apiKey, secret, passphrase);
      
      return await rateLimiter.execute(exchange, async () => {
        // Get futures exchange
        const ex = getExchangeWithCredentials(exchange, credentials.apiKey, credentials.secret, marketType, credentials.passphrase);
        
        // Place futures market order
        log(LogLevel.INFO, `Placing futures ${side} market order for ${symbol} on ${exchange} (${marketType}), amount: ${amount}`);
        const order = await ex.createOrder(symbol, 'market', side, amount, undefined, params || {});
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(order, null, 2)
          }]
        };
      });
    } catch (error) {
      log(LogLevel.ERROR, `Error placing futures market order: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: [{
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  });
  
  // Removed duplicate log message
}