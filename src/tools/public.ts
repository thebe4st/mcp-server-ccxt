/**
 * Public API Tools
 * Tools for accessing public cryptocurrency exchange data
 * 
 * 公共API工具
 * 用于访问公共加密货币交易所数据的工具
 */
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getExchange, getExchangeWithMarketType, validateSymbol, SUPPORTED_EXCHANGES, MarketType } from '../exchange/manager.js';
import { getCachedData } from '../utils/cache.js';
import { rateLimiter } from '../utils/rate-limiter.js';
import { log, LogLevel } from '../utils/logging.js';

export function registerPublicTools(server: McpServer) {
  // Get ticker information
  // 获取行情信息
  server.tool("get-ticker", "Get current ticker information for a trading pair", {
    exchange: z.string().describe("Exchange ID (e.g., binance, coinbase)"),
    symbol: z.string().describe("Trading pair symbol (e.g., BTC/USDT for spot market, BTC/USDT:USDT for swap market)")
  }, async ({ exchange, symbol }) => {
    try { 
      return await rateLimiter.execute(exchange, async () => {
        const ex = getExchange(exchange);
        const cacheKey = `ticker:${exchange}:${symbol}`;
        
        const ticker = await getCachedData(cacheKey, async () => {
          log(LogLevel.INFO, `Fetching ticker for ${symbol} on ${exchange}`);
          return await ex.fetchTicker(symbol);
        });
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(ticker, null, 2)
          }]
        };
      });
    } catch (error) {
      log(LogLevel.ERROR, `Error fetching ticker: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: [{
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  });

  // Batch get tickers
  // 批量获取行情
  server.tool("batch-get-tickers", "Get ticker information for multiple trading pairs at once", {
    exchange: z.string().describe("Exchange ID (e.g., binance, coinbase)"),
    symbols: z.array(z.string()).describe("List of trading pair symbols (e.g., ['BTC/USDT for spot market, BTC/USDT:USDT for swap market', 'ETH/USDT:USDT for swap market'])"),
  }, async ({ exchange, symbols }) => {
    try {
      return await rateLimiter.execute(exchange, async () => {
        const ex = getExchange(exchange);
        const cacheKey = `tickers:${exchange}:${symbols.join(',')}`;
        
        const tickers = await getCachedData(cacheKey, async () => {
          log(LogLevel.INFO, `Batch fetching tickers for ${symbols.length} symbols on ${exchange}`);
          return await ex.fetchTickers(symbols);
        });
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(tickers, null, 2)
          }]
        };
      });
    } catch (error) {
      log(LogLevel.ERROR, `Error batch fetching tickers: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: [{
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  });

  // Get order book
  // 获取订单簿
  server.tool("get-orderbook", "Get market order book for a trading pair", {
    exchange: z.string().describe("Exchange ID (e.g., binance, coinbase)"),
    symbol: z.string().describe("Trading pair symbol (e.g., BTC/USDT for spot market, BTC/USDT:USDT for swap market)"),
    limit: z.number().optional().default(20).describe("Depth of the orderbook")
  }, async ({ exchange, symbol, limit }) => {
    try {
      return await rateLimiter.execute(exchange, async () => {
        const ex = getExchange(exchange);
        const cacheKey = `orderbook:${exchange}:${symbol}:${limit}`;
        
        const orderbook = await getCachedData(cacheKey, async () => {
          log(LogLevel.INFO, `Fetching orderbook for ${symbol} on ${exchange}, depth: ${limit}`);
          return await ex.fetchOrderBook(symbol, limit);
        });
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(orderbook, null, 2)
          }]
        };
      });
    } catch (error) {
      log(LogLevel.ERROR, `Error fetching orderbook: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: [{
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  });

  // Get OHLCV data
  // 获取K线数据
  server.tool("get-ohlcv", "Get OHLCV candlestick data for a trading pair", {
    exchange: z.string().describe("Exchange ID (e.g., binance, coinbase)"),
    symbol: z.string().describe("Trading pair symbol (e.g., BTC/USDT for spot market, BTC/USDT:USDT for swap market)"),
    timeframe: z.string().optional().default("1d").describe("Timeframe (e.g., 1m, 5m, 1h, 1d)"),
    limit: z.number().optional().default(100).describe("Number of candles to fetch (max 1000)")
  }, async ({ exchange, symbol, timeframe, limit }) => {
    try {
      return await rateLimiter.execute(exchange, async () => {
        const ex = getExchange(exchange);
        const cacheKey = `ohlcv:${exchange}:${symbol}:${timeframe}:${limit}`;
        
        const ohlcv = await getCachedData(cacheKey, async () => {
          log(LogLevel.INFO, `Fetching OHLCV for ${symbol} on ${exchange}, timeframe: ${timeframe}, limit: ${limit}`);
          return await ex.fetchOHLCV(symbol, timeframe, undefined, limit);
        });
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(ohlcv, null, 2)
          }]
        };
      });
    } catch (error) {
      log(LogLevel.ERROR, `Error fetching OHLCV data: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: [{
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  });

  // Get recent trades
  // 获取最近交易
  server.tool("get-trades", "Get recent trades for a trading pair", {
    exchange: z.string().describe("Exchange ID (e.g., binance, coinbase)"),
    symbol: z.string().describe("Trading pair symbol (e.g., BTC/USDT for spot market, BTC/USDT:USDT for swap market)"),
    limit: z.number().optional().default(50).describe("Number of trades to fetch")
  }, async ({ exchange, symbol, limit }) => {
    try {
      return await rateLimiter.execute(exchange, async () => {
        const ex = getExchange(exchange);
        const cacheKey = `trades:${exchange}:${symbol}:${limit}`;
        
        const trades = await getCachedData(cacheKey, async () => {
          log(LogLevel.INFO, `Fetching trades for ${symbol} on ${exchange}, limit: ${limit}`);
          return await ex.fetchTrades(symbol, undefined, limit);
        });
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(trades, null, 2)
          }]
        };
      });
    } catch (error) {
      log(LogLevel.ERROR, `Error fetching trades: ${error instanceof Error ? error.message : String(error)}`);
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