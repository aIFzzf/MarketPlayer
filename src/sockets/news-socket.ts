/**
 * news-socket.ts - 新闻实时推送 WebSocket 服务
 * 
 * 用途：从新闻源获取新新闻后推送给前端
 * 技术：WebSocket (ws 库) + SSE (Server-Sent Events)
 */

import { Server } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { logger } from '../utils/logger';

let io: Server | null = null;

/**
 * 初始化 WebSocket 服务
 */
export function initNewsSocket(httpServer: HTTPServer): Server | null {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    path: '/news-socket',
  });

  io.on('connection', (socket) => {
    logger.info(`[NewsSocket] Client connected: ${socket.id}`);

    // 客户端订阅特定类型的新闻
    socket.on('subscribe', (data: { market?: string; categories?: string[] }) => {
      const { market, categories } = data || {};
      
      if (market) socket.join(`market:${market}`);
      if (categories) {
        categories.forEach(cat => socket.join(`category:${cat}`));
      }
      
      logger.info(`[NewsSocket] ${socket.id} subscribed: market=${market}, categories=${categories?.join(',')}`);
    });

    // 客户端请求历史新闻
    socket.on('request_history', (data: { limit?: number }) => {
      socket.emit('history_response', { 
        message: 'Use REST API for history: GET /api/news' 
      });
    });

    socket.on('disconnect', (reason) => {
      logger.info(`[NewsSocket] Client disconnected: ${socket.id}, reason: ${reason}`);
    });
  });

  logger.info('[NewsSocket] WebSocket server initialized');
  return io;
}

/**
 * 推送新新闻给所有订阅者
 */
export function emitNews(news: {
  id: string;
  title: string;
  source: string;
  publishedAt: string;
  category?: string;
  alertLevel?: number;
  symbols?: string[];
  sentiment?: string;
  market?: string;
}): void {
  if (!io) {
    logger.warn('[NewsSocket] IO not initialized, skipping emit');
    return;
  }

  const payload = {
    type: 'news_update',
    data: news,
    timestamp: new Date().toISOString(),
  };

  // 广播给所有客户端
  io.emit('news', payload);

  // 按市场广播
  if (news.market) {
    io.to(`market:${news.market}`).emit('news', payload);
  }

  // 按分类广播
  if (news.category) {
    io.to(`category:${news.category}`).emit('news', payload);
  }

  logger.info(`[NewsSocket] Emitted news: ${news.title.substring(0, 30)}...`);
}

/**
 * 批量推送新闻
 */
export function emitNewsBatch(newsList: Array<{
  id: string;
  title: string;
  source: string;
  publishedAt: string;
  category?: string;
}>): void {
  if (!io) return;

  io.emit('news_batch', {
    type: 'news_batch',
    data: newsList,
    timestamp: new Date().toISOString(),
    count: newsList.length,
  });

  logger.info(`[NewsSocket] Emitted batch: ${newsList.length} items`);
}

/**
 * 推送市场状态变化
 */
export function emitMarketStatus(status: {
  market: string;
  status: 'risk_on' | 'caution' | 'risk_off';
  spyPrice?: number;
  ma50?: number;
}): void {
  if (!io) return;

  io.emit('market_status', {
    type: 'market_status',
    data: status,
    timestamp: new Date().toISOString(),
  });
}

/**
 * 获取连接客户端数量
 */
export function getConnectedClients(): number {
  return io?.sockets.sockets.size || 0;
}

export default {
  initNewsSocket,
  emitNews,
  emitNewsBatch,
  emitMarketStatus,
  getConnectedClients,
};