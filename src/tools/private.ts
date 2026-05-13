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
  }, async ({ exchange }) => {
    try {
      const credentials = resolveCredentials(exchange);
      
      return await rateLimiter.execute(exchange, async () => {
        // Get exchange with market type
        const ex = getExchangeWithCredentials(exchange, credentials.apiKey, credentials.secret, MarketType.SWAP, credentials.passphrase);
        
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
          positionsCount: positions.length
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
  
  // Set margin mode
  // 设置保证金模式 - 使用 ccxt.setMarginMode
  server.tool("set-position-mode", "Set position mode for swap trading, both cross and isolated, leverage value", {
    exchange: z.string().describe("Exchange ID (e.g., binance, bybit)"),
    symbol: z.string().describe("Trading pair symbol (e.g., BTC/USDT:USDT)"),
    marginMode: z.enum(["cross", "isolated"]).describe("Margin mode: cross or isolated"),
    leverage: z.number().positive().min(1).max(5).describe("Leverage value (default: 3x)").default(3),
    positionSide: z.enum(["long", "short"]).describe("Position side: long or short")
  }, async ({ exchange, symbol, marginMode, leverage, positionSide }) => {
    try {
      const credentials = resolveCredentials(exchange);
      
      return await rateLimiter.execute(exchange, async () => {
        const ex = getExchangeWithCredentials(exchange, credentials.apiKey, credentials.secret, MarketType.SWAP, credentials.passphrase);
        
        // Set margin mode
        log(LogLevel.INFO, `Setting margin mode to ${marginMode} for ${symbol} on ${exchange}`);
        const params = {
          "lever": leverage || 3,
          "posSide": positionSide,
          "mgnMode": marginMode
        };
        const result = await ex.setMarginMode(marginMode, symbol, params);
        
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

  // Cancel order
  // 取消订单 - 使用 ccxt.cancelOrder
  server.tool("cancel-order", "Cancel an open order on an exchange (use ccxt.cancelOrder)", {
    exchange: z.string().describe("Exchange ID (e.g., binance, coinbase)"),
    symbol: z.string().describe("Trading pair symbol (e.g., BTC/USDT:USDT)"),
    orderId: z.string().describe("Order ID to cancel"),
  }, async ({ exchange, symbol, orderId }) => {
    try {
      const credentials = resolveCredentials(exchange);
      
      return await rateLimiter.execute(exchange, async () => {
        const ex = getExchangeWithCredentials(exchange, credentials.apiKey, credentials.secret, MarketType.SWAP, credentials.passphrase);
        
        log(LogLevel.INFO, `Cancelling order ${orderId} on ${exchange}`);
        const result = await ex.cancelOrder(orderId, symbol || undefined);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      });
    } catch (error) {
      log(LogLevel.ERROR, `Error cancelling order: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: [{
          type: "text",
          text: `Error cancelling order: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  });

  // Fetch open orders
  // 获取开放订单列表 - 使用 ccxt.fetchOpenOrders
  server.tool("fetch-open-orders", "Fetch all open orders (use ccxt.fetchOpenOrders)", {
    exchange: z.string().describe("Exchange ID (e.g., binance, coinbase)"),
    symbol: z.string().optional().describe("Trading pair symbol (e.g., BTC/USDT). If not provided, fetches all open orders"),
  }, async ({ exchange, symbol }) => {
    try {
      const credentials = resolveCredentials(exchange);
      
      return await rateLimiter.execute(exchange, async () => {
        const ex = getExchangeWithCredentials(exchange, credentials.apiKey, credentials.secret, MarketType.SWAP, credentials.passphrase);
        
        log(LogLevel.INFO, `Fetching open orders for ${symbol || 'all symbols'} on ${exchange}`);
        const orders = await ex.fetchOpenOrders(symbol || undefined);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(orders, null, 2)
          }]
        };
      });
    } catch (error) {
      log(LogLevel.ERROR, `Error fetching open orders: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: [{
          type: "text",
          text: `Error fetching open orders: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  });

  // Create contract order
  // 创建合约订单 - 使用 ccxt.createOrder
  server.tool("create-okx-position", "Create a contract order on an exchange,marginMode: isolated, ", {
    symbol: z.string().describe("Trading pair symbol (e.g., BTC/USDT:USDT)"),
    type: z.enum(["limit", "market"]).describe("Order type: limit or market"),
    positionSide: z.enum(["long", "short"]).describe("Position side: long or short"),
    amount: z.number().positive().describe("Order quantity (contracts)"),
    price: z.number().positive().optional().describe("Limit price (required for limit orders)"),
    takeProfit: z.number().positive().describe("Take profit price"),
    stopLoss: z.number().positive().describe("Stop loss price"),
    leverage: z.number().positive().min(1).max(5).optional().describe("Leverage value (default: 1x)").default(1),
  }, async ({ symbol, type, positionSide, amount, price, takeProfit, stopLoss, leverage }) => {
    try {
      const exchange = "okx";
      const credentials = resolveCredentials(exchange);
      
      return await rateLimiter.execute(exchange, async () => {
        const ex = getExchangeWithCredentials(exchange, credentials.apiKey, credentials.secret, MarketType.SWAP, credentials.passphrase);
        
        if (type === "limit" && !price) {
          throw new Error("Price is required for limit orders");
        }
        const side = positionSide === "long" ? "buy" : "sell";
        
        log(LogLevel.INFO, `Creating ${type} ${side} order for ${amount} ${symbol} on ${exchange}`);
        if (price) {
          log(LogLevel.INFO, `Limit price: ${price}`);
        }
        if (takeProfit) {
          log(LogLevel.INFO, `Take profit: ${takeProfit}`);
        }
        if (stopLoss) {
          log(LogLevel.INFO, `Stop loss: ${stopLoss}`);
        }

        const marginModeParam: any = {
          lever: leverage,
          mgnMode: "isolated",
          posSide: positionSide
        }
        await ex.setMarginMode("isolated", symbol, marginModeParam);
       
        const params: any = {
          tdMode: "isolated",
          posSide: positionSide,
          ordType: type,
          px: price,
          side: side,
          attachAlgoOrds: [
            {
              tpTriggerPx: takeProfit,
              tpOrdPx: -1,
              slTriggerPx: stopLoss,
              slOrdPx: -1,
            }
          ]
        };
        
        
        const result = await ex.createOrder(symbol, type, side, amount, price, params);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      });
    } catch (error) {
      log(LogLevel.ERROR, `Error creating order: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: [{
          type: "text",
          text: `Error creating order: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  });

  // Close OKX position
  // 平仓 OKX 合约持仓
  server.tool("close-okx-position", "Close a position on OKX exchange (use ccxt.createOrder)", {
    symbol: z.string().describe("Trading pair symbol (e.g., BTC/USDT:USDT)"),
    type: z.enum(["limit", "market"]).describe("Order type: limit or market"),
    positionSide: z.enum(["long", "short"]).describe("Position side to close: long or short"),
    amount: z.number().positive().describe("Quantity to close (contracts)"),
    price: z.number().positive().optional().describe("Limit price (required for limit orders)"),
  }, async ({ symbol, type, positionSide, amount, price }) => {
    try {
      const exchange = "okx";
      const credentials = resolveCredentials(exchange);
      
      return await rateLimiter.execute(exchange, async () => {
        const ex = getExchangeWithCredentials(exchange, credentials.apiKey, credentials.secret, MarketType.SWAP, credentials.passphrase);
        
        if (type === "limit" && !price) {
          throw new Error("Price is required for limit orders");
        }
        
        const side = positionSide === "long" ? "sell" : "buy";
        
        log(LogLevel.INFO, `Closing ${positionSide} position: ${type} ${side} order for ${amount} ${symbol} on ${exchange}`);
        if (price) {
          log(LogLevel.INFO, `Limit price: ${price}`);
        }
        
        const params: any = {
          tdMode: "isolated",
          posSide: positionSide,
          ordType: type,
          px: price,
          side: side,
        };
        
        const result = await ex.createOrder(symbol, type, side, amount, price, params);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      });
    } catch (error) {
      log(LogLevel.ERROR, `Error closing position: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: [{
          type: "text",
          text: `Error closing position: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  });
}