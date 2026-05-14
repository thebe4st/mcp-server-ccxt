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
import * as ccxt from 'ccxt';

export class OkxAlgoOrder {
  algoId: string;
  instId: string;
  instType: string;
  ordType: string;
  side: string;
  posSide: string;
  tpTriggerPx?: string;
  slTriggerPx?: string;
  status: string;
  createTime: string;

  constructor(data: {
    algoId: string;
    instId: string;
    instType: string;
    ordType: string;
    side: string;
    posSide: string;
    tpTriggerPx?: string;
    slTriggerPx?: string;
    status: string;
    createTime: string;
  }) {
    this.algoId = data.algoId;
    this.instId = data.instId;
    this.instType = data.instType;
    this.ordType = data.ordType;
    this.side = data.side;
    this.posSide = data.posSide;
    this.tpTriggerPx = data.tpTriggerPx;
    this.slTriggerPx = data.slTriggerPx;
    this.status = data.status;
    this.createTime = data.createTime;
  }

  static fromApiResponse(item: any): OkxAlgoOrder {
    return new OkxAlgoOrder({
      algoId: item.algoId,
      instId: item.instId,
      instType: item.instType,
      ordType: item.ordType,
      side: item.side,
      posSide: item.posSide,
      tpTriggerPx: item.tpTriggerPx,
      slTriggerPx: item.slTriggerPx,
      status: item.status,
      createTime: item.createTime,
    });
  }
}

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


export async function getOkxAlgoOrders(okxEx: ccxt.okx) {
  const params = {
    'instType': 'SWAP',
    'ordType': 'oco'
  }
  const algoOrdersResponse = await okxEx.privateGetTradeOrdersAlgoPending(params);
  if (algoOrdersResponse.code != "0") {
    throw new Error(algoOrdersResponse.msg);
  }
  const algoOrders = algoOrdersResponse.data;
  if (algoOrdersResponse && algoOrdersResponse.data && Array.isArray(algoOrdersResponse.data)) {
    return algoOrdersResponse.data.map((item: any) => OkxAlgoOrder.fromApiResponse(item));
  }
  return [];

}

export async function findAlgoOrderByAlgoId(okxEx: ccxt.okx, algoId: string): Promise<OkxAlgoOrder | undefined> {
  const orders = await getOkxAlgoOrders(okxEx);
  return orders.find(order => order.algoId === algoId);
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
  server.tool("okx-fetch-orders", "Fetch all open orders", {
  }, async ({ }) => {
    try {
      const exchange = 'okx';
      const credentials = resolveCredentials(exchange);

      return await rateLimiter.execute(exchange, async () => {
        const ex = getExchangeWithCredentials(exchange, credentials.apiKey, credentials.secret, MarketType.SWAP, credentials.passphrase);

        log(LogLevel.INFO, `Fetching open orders on ${exchange}`);

        // 转换ex为okx实例
        const okxEx = ex as ccxt.okx;
        const algoOrdersToKeep = await getOkxAlgoOrders(okxEx);
        const orders = await ex.fetchOpenOrders(undefined, undefined, undefined);

        const result = {
          "orders": orders,
          "algoOrders": algoOrdersToKeep,
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
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
  server.tool("okx-create-position", "Create a contract order on an exchange,marginMode: isolated, ", {
    symbol: z.string().describe("Trading pair symbol (e.g., BTC/USDT:USDT)"),
    type: z.enum(["limit", "market"]).describe("Order type: limit or market"),
    positionSide: z.enum(["long", "short"]).describe("Position side: long or short"),
    amount: z.number().positive().describe("Order quantity (contracts)，It's not the quantity of virtual currency, but the number of shares on the exchange, which needs to be converted"),
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


        const createOrderResult = await ex.createOrder(symbol, type, side, amount, price, params);
        // 下单完成后 获取algoOrders
        const algoOrdersToKeep = await getOkxAlgoOrders(ex as ccxt.okx);

        const result = {
          "createResult": createOrderResult,
          "algoOrders": algoOrdersToKeep,
        }

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
  server.tool("okx-close-position", "Close a position on OKX exchange, You can control the number of positions closed by specifying sz", {
    symbol: z.string().describe("Trading pair symbol (e.g., BTC/USDT:USDT)"),
    type: z.enum(["limit", "market"]).describe("Order type: limit or market"),
    positionSide: z.enum(["long", "short"]).describe("Position side to close: long or short"),
    sz: z.number().positive().describe("Quantity to close (contracts)，It's not the quantity of virtual currency, but the number of shares on the exchange, which needs to be converted"),
    price: z.number().positive().optional().describe("Limit price (required for limit orders)"),
  }, async ({ symbol, type, positionSide, sz, price }) => {
    try {
      const exchange = "okx";
      const credentials = resolveCredentials(exchange);

      return await rateLimiter.execute(exchange, async () => {
        const ex = getExchangeWithCredentials(exchange, credentials.apiKey, credentials.secret, MarketType.SWAP, credentials.passphrase);

        if (type === "limit" && !price) {
          throw new Error("Price is required for limit orders");
        }

        const side = positionSide === "long" ? "sell" : "buy";

        log(LogLevel.INFO, `Closing ${positionSide} position: ${type} ${side} order for ${sz} ${symbol} on ${exchange}`);
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

        const result = await ex.createOrder(symbol, type, side, sz, price, params);

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

  // Set position stop loss and take profit
  // 设置持仓的止盈止损价格
  server.tool("okx-put-position-sl-tp", "Set stop loss and take profit for a position on OKX ", {
    symbol: z.string().describe("Trading pair symbol (e.g., BTC/USDT:USDT)"),
    posSide: z.enum(["long", "short"]).describe("Position side: long or short"),
    takeProfit: z.number().positive().describe("Take profit price"),
    stopLoss: z.number().positive().describe("Stop loss price"),
    sz: z.number().positive().describe("Quantity to close (contracts)，It's not the quantity of virtual currency, but the number of shares on the exchange, which needs to be converted"),
  }, async ({ symbol, posSide, takeProfit, stopLoss, sz }) => {
    try {
      const exchange = "okx";
      const credentials = resolveCredentials(exchange);

      return await rateLimiter.execute(exchange, async () => {
        const ex = getExchangeWithCredentials(exchange, credentials.apiKey, credentials.secret, MarketType.SWAP, credentials.passphrase);

        if (!takeProfit && !stopLoss && !sz) {
          throw new Error("At least one of takeProfit, stopLoss, or sz must be provided");
        }

        log(LogLevel.INFO, `Setting SL/TP for ${posSide} position on ${symbol}`);
        if (takeProfit) {
          log(LogLevel.INFO, `Take profit: ${takeProfit}`);
        }
        if (stopLoss) {
          log(LogLevel.INFO, `Stop loss: ${stopLoss}`);
        }
        if (sz) {
          log(LogLevel.INFO, `Quantity: ${sz}`);
        }

        const side = posSide === "long" ? "sell" : "buy";

        const params: any = {
          instId: symbol.replace("/", "-").replace(":USDT", "-SWAP"),
          tdMode: "isolated",
          side: side,
          posSide: posSide,
          ordType: 'oco',
          sz: String(sz),
          cxlOnClosePos: true,
          reduceOnly: true,
        };

        if (takeProfit) {
          params.tpTriggerPx = String(takeProfit);
          params.tpOrdPx = -1;
        }
        if (stopLoss) {
          params.slTriggerPx = String(stopLoss);
          params.slOrdPx = -1;
        }

        const result = await (ex as ccxt.okx  ).privatePostTradeOrderAlgo(params);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      });
    } catch (error) {
      log(LogLevel.ERROR, `Error setting SL/TP: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: [{
          type: "text",
          text: `Error setting SL/TP: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  });

  // Cancel position stop loss and take profit
  // 取消持仓的止盈止损订单
  // server.tool("okx-cancel-position-sl-tp", "Cancel stop loss and take profit orders for a position on OKX", {
  //   algoId: z.string().describe("Algorithm order ID to cancel"),
  // }, async ({ algoId }) => {
  //   try {
  //     const exchange = "okx";
  //     const credentials = resolveCredentials(exchange);

  //     return await rateLimiter.execute(exchange, async () => {
  //       const ex = getExchangeWithCredentials(exchange, credentials.apiKey, credentials.secret, MarketType.SWAP, credentials.passphrase);

  //       log(LogLevel.INFO, `Finding algo order ${algoId}`);
  //       const algoOrder = await findAlgoOrderByAlgoId(ex as ccxt.okx, algoId);

  //       if (!algoOrder) {
  //         throw new Error(`Algo order with ID ${algoId} not found`);
  //       }

  //       const instId = algoOrder.instId;

  //       log(LogLevel.INFO, `Canceling algo order ${algoId} on ${instId}`);

  //       const params: any = {
  //         instId: instId,
  //         algoId: algoId,
  //       };

  //       const result = await (ex as ccxt.okx).privatePostTradeCancelAlgos(params);

  //       return {
  //         content: [{
  //           type: "text",
  //           text: JSON.stringify(result, null, 2)
  //         }]
  //       };
  //     });
  //   } catch (error) {
  //     log(LogLevel.ERROR, `Error canceling SL/TP: ${error instanceof Error ? error.message : String(error)}`);
  //     return {
  //       content: [{
  //         type: "text",
  //         text: `Error canceling SL/TP: ${error instanceof Error ? error.message : String(error)}`
  //       }],
  //       isError: true
  //     };
  //   }
  // });

  // Modify position stop loss and take profit
  // 修改持仓的止盈止损价格
  server.tool("okx-modify-position-sl-tp", "Modify stop loss and take profit prices for a position on OKX (使用 privatePostTradeAmendAlgos)", {
    algoId: z.string().describe("Algorithm order ID, from okx-fetch-open-orders"),
    newTakeProfit: z.number().positive().optional().describe("New take profit price"),
    newStopLoss: z.number().positive().optional().describe("New stop loss price"),
    newSz: z.number().positive().optional().describe("New order size/quantity"),
  }, async ({ algoId, newTakeProfit, newStopLoss, newSz }) => {
    try {
      const exchange = "okx";
      const credentials = resolveCredentials(exchange);

      return await rateLimiter.execute(exchange, async () => {
        const ex = getExchangeWithCredentials(exchange, credentials.apiKey, credentials.secret, MarketType.SWAP, credentials.passphrase);

        if (!newTakeProfit && !newStopLoss && !newSz) {
          throw new Error("At least one of newTakeProfit, newStopLoss, or newSz must be provided");
        }

        log(LogLevel.INFO, `Finding algo order ${algoId}`);
        const algoOrder = await findAlgoOrderByAlgoId(ex as ccxt.okx, algoId);

        if (!algoOrder) {
          throw new Error(`Algo order with ID ${algoId} not found`);
        }

        const instId = algoOrder.instId;

        log(LogLevel.INFO, `Modifying SL/TP for algo order ${algoId} on ${instId}`);
        if (newTakeProfit) {
          log(LogLevel.INFO, `New take profit: ${newTakeProfit}`);
        }
        if (newStopLoss) {
          log(LogLevel.INFO, `New stop loss: ${newStopLoss}`);
        }
        if (newSz) {
          log(LogLevel.INFO, `New size: ${newSz}`);
        }

        const params: any = {
          instId: instId,
          algoId: algoId,
        };

        if (newTakeProfit) {
          params.newTpTriggerPx = String(newTakeProfit);
        }
        if (newStopLoss) {
          params.newSlTriggerPx = String(newStopLoss);
        }
        if (newSz) {
          params.newSz = String(newSz);
        }

        const result = await (ex as any).privatePostTradeAmendAlgos(params);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      });
    } catch (error) {
      log(LogLevel.ERROR, `Error modifying SL/TP: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: [{
          type: "text",
          text: `Error modifying SL/TP: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  });
}