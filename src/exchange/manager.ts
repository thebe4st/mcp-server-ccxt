/**
 * Exchange Manager
 * Manages cryptocurrency exchange instances and provides utility functions
 * 
 * 交易所管理器
 * 管理加密货币交易所实例并提供实用函数
 */
import * as ccxt from 'ccxt';
import { log, LogLevel } from '../utils/logging.js';

// List of supported exchanges
// 支持的交易所列表
export const SUPPORTED_EXCHANGES = [
  // 原有交易所
  'binance', 'coinbase', 'kraken', 'kucoin', 'okx', 
  'gate', 'bybit', 'mexc', 'huobi',
  // 新增主流交易所
  'bitget', 'coinex', 'cryptocom', 'hashkey', 'hyperliquid',
  // 延伸现有交易所的衍生品市场
  'binanceusdm', 'binancecoinm', 'kucoinfutures', 'bitfinex', 'bitmex',
  'gateio', 'woo', 'deribit', 'phemex', 'bingx'
];

// Exchange instance cache
// 交易所实例缓存
const exchanges: Record<string, ccxt.Exchange> = {};

/**
 * Clear exchange instance cache
 * This is useful when proxy or other configurations change
 */
export function clearExchangeCache(): void {
  Object.keys(exchanges).forEach(key => {
    delete exchanges[key];
  });
  log(LogLevel.INFO, 'Exchange cache cleared');
}

// Default exchange and market type
// 默认交易所和市场类型
export const DEFAULT_EXCHANGE = process.env.DEFAULT_EXCHANGE || 'binance';
export const DEFAULT_MARKET_TYPE = process.env.DEFAULT_MARKET_TYPE || 'spot';
export const DEFAULT_USE_SANDBOX = process.env.USE_SANDBOX === 'true';

// Market types enum
// 市场类型枚举
export enum MarketType {
  SPOT = 'spot',
  FUTURE = 'future',
  SWAP = 'swap',
  OPTION = 'option',
  MARGIN = 'margin'
}

/**
 * Get exchange instance
 * @param exchangeId Exchange ID
 * @returns Exchange instance
 * 
 * 获取交易所实例
 * @param exchangeId 交易所ID
 * @returns 交易所实例
 */
/**
 * Get proxy configuration from environment
 * @returns Proxy configuration or null if proxy is disabled
 */
export function getProxyConfig(): { url: string; username?: string; password?: string } | null {
  const useProxy = process.env.USE_PROXY === 'true';
  if (!useProxy) return null;
  
  const url = process.env.PROXY_URL;
  if (!url) {
    log(LogLevel.WARNING, 'USE_PROXY is true but PROXY_URL is not set');
    return null;
  }
  
  try {
    new URL(url);
  } catch {
    log(LogLevel.WARNING, `Invalid proxy URL: ${url}`);
    return null;
  }
  
  const username = process.env.PROXY_USERNAME || undefined;
  const password = process.env.PROXY_PASSWORD || undefined;
  
  return { url, username, password };
}

/**
 * Format proxy URL with authentication if provided
 * @param config Proxy configuration
 * @returns Formatted proxy URL
 */
function formatProxyUrl(config: { url: string; username?: string; password?: string }): string {
  if (!config.username || !config.password) return config.url;
  
  // Extract protocol and host from URL
  const match = config.url.match(/^(https?|socks[45]):\/\/([^\/]+)/);
  if (!match) return config.url;
  
  const protocol = match[1];
  const host = match[2];
  return `${protocol}://${config.username}:${config.password}@${host}`;
}

/**
 * Get exchange instance with the default market type
 * @param exchangeId Exchange ID
 * @param useSandbox Whether to use sandbox mode
 * @returns Exchange instance
 */
export function getExchange(exchangeId?: string, useSandbox: boolean = DEFAULT_USE_SANDBOX): ccxt.Exchange {
  return getExchangeWithMarketType(exchangeId, DEFAULT_MARKET_TYPE as MarketType, useSandbox);
}

/**
 * Get exchange instance with specific market type
 * @param exchangeId Exchange ID
 * @param marketType Market type (spot, future, etc.)
 * @returns Exchange instance
 */
export function getExchangeWithMarketType(exchangeId?: string, marketType: MarketType | string = MarketType.SPOT, useSandbox: boolean = DEFAULT_USE_SANDBOX): ccxt.Exchange {
  const id = (exchangeId || DEFAULT_EXCHANGE).toLowerCase();
  const type = marketType || DEFAULT_MARKET_TYPE;
  
  // Create a cache key that includes exchange ID, market type and sandbox status
  const cacheKey = `${id}:${type}:${useSandbox ? 'sandbox' : 'live'}`;
  
  if (!exchanges[cacheKey]) {
    if (!SUPPORTED_EXCHANGES.includes(id)) {
      throw new Error(`Exchange '${id}' not supported`);
    }
    
    const apiKey = useSandbox ? process.env[`${id.toUpperCase()}_SANDBOX_API_KEY`] : process.env[`${id.toUpperCase()}_API_KEY`];
    const secret = useSandbox ? process.env[`${id.toUpperCase()}_SANDBOX_SECRET`] : process.env[`${id.toUpperCase()}_SECRET`];
    const passphrase = useSandbox ? process.env[`${id.toUpperCase()}_SANDBOX_PASSPHRASE`] : process.env[`${id.toUpperCase()}_PASSPHRASE`];
    
    try {
      log(LogLevel.INFO, `Initializing exchange: ${id} (${type})${useSandbox ? ' [sandbox]' : ''}`);
      // Use indexed access to create exchange instance
      const ExchangeClass = ccxt[id as keyof typeof ccxt];
      
      // Configure options with possible proxy
      const options: any = {
        apiKey,
        secret,
        enableRateLimit: true,
        options: {}
      };
      
      // Add passphrase if provided (required for exchanges like KuCoin)
      if (passphrase) {
        options.password = passphrase;
      }
      
      // Configure market type specifics
      if (type !== MarketType.SPOT) {
        options.options.defaultType = type;
      }
      
      // Enable sandbox mode if requested
      if (useSandbox) {
        options.options.sandbox = true;
      }
      
      // Add proxy configuration if enabled
      const proxyConfig = getProxyConfig();
      if (proxyConfig) {
        const proxyUrl = formatProxyUrl(proxyConfig);
        if (proxyUrl.startsWith('https://')) {
          options.httpsProxy = proxyUrl;
        } else {
          options.httpProxy = proxyUrl;
        }
        log(LogLevel.INFO, `Using proxy for ${id}: ${proxyUrl}`);
      }
      
      exchanges[cacheKey] = new (ExchangeClass as any)(options);
      
      // Enable sandbox mode after initialization if supported
      if (useSandbox && exchanges[cacheKey].has.sandbox) {
        exchanges[cacheKey].setSandboxMode(true);
      }
    } catch (error) {
      log(LogLevel.ERROR, `Failed to initialize exchange ${id} (${type})${useSandbox ? ' [sandbox]' : ''}: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to initialize exchange ${id} (${type}): ${error.message}`);
    }
  }
  
  return exchanges[cacheKey];
}

/**
 * Get exchange instance with specific credentials
 * @param exchangeId Exchange ID
 * @param apiKey API key
 * @param secret API secret
 * @param marketType Market type (spot, future, etc.)
 * @param passphrase Passphrase for authentication (required for some exchanges like KuCoin)
 * @returns Exchange instance
 * 
 * 使用特定凭据获取交易所实例
 * @param exchangeId 交易所ID
 * @param apiKey API密钥
 * @param secret API密钥秘密
 * @param marketType 市场类型（现货、期货等）
 * @param passphrase 认证密码（某些交易所如KuCoin需要）
 * @returns 交易所实例
 */
export function getExchangeWithCredentials(
  exchangeId: string,
  apiKey: string,
  secret: string,
  marketType: MarketType | string = MarketType.SPOT,
  passphrase?: string,
  useSandbox: boolean = DEFAULT_USE_SANDBOX
): ccxt.Exchange {
  try {
    if (!SUPPORTED_EXCHANGES.includes(exchangeId)) {
      throw new Error(`Exchange '${exchangeId}' not supported`);
    }
    
    const type = marketType || DEFAULT_MARKET_TYPE;
    
    // Configure options with possible proxy
    const options: any = {
      apiKey,
      secret,
      enableRateLimit: true,
      options: {}
    };
    
    // Add passphrase if provided (required for exchanges like KuCoin)
    if (passphrase) {
      options.password = passphrase;
    }
    
    // Configure market type specifics
    if (type !== MarketType.SPOT) {
      options.options.defaultType = type;
    }
    
    // Enable sandbox mode if requested
    if (useSandbox) {
      options.options.sandbox = true;
    }
    
    // Add proxy configuration if enabled
    const proxyConfig = getProxyConfig();
    if (proxyConfig) {
      const proxyUrl = formatProxyUrl(proxyConfig);
      if (proxyUrl.startsWith('https://')) {
        options.httpsProxy = proxyUrl;
      } else {
        options.httpProxy = proxyUrl;
      }
      log(LogLevel.INFO, `Using proxy for ${exchangeId} (${type}) with custom credentials${useSandbox ? ' [sandbox]' : ''}: ${proxyUrl}`);
    }
    
    // Use indexed access to create exchange instance
    const ExchangeClass = ccxt[exchangeId as keyof typeof ccxt];
    const exchange = new (ExchangeClass as any)(options);
    
    // Enable sandbox mode after initialization if supported
    if (useSandbox && exchange.has.sandbox) {
      exchange.setSandboxMode(true);
    }
    
    return exchange;
  } catch (error) {
    log(LogLevel.ERROR, `Failed to initialize exchange ${exchangeId} with credentials${useSandbox ? ' [sandbox]' : ''}: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error(`Failed to initialize exchange ${exchangeId}: ${error.message}`);
  }
}

/**
 * Validate and format trading pair symbol
 * @param symbol Trading pair symbol
 * @returns Formatted trading pair symbol
 * 
 * 验证和格式化交易对符号
 * @param symbol 交易对符号
 * @returns 格式化的交易对符号
 */
export function validateSymbol(symbol: string): string {
  // Simple validation to ensure symbol includes slash
  // 简单验证，确保符号包含斜杠
  if (!symbol.includes('/')) {
    throw new Error(`Invalid symbol: ${symbol}, should be in format like BTC/USDT`);
  }
  return symbol.toUpperCase();
}