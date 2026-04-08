import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { query, queryOne } from '../../db/postgres';
import { getUserByDiscordId, createUser, getManualPositions } from '../../db/queries';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { handleFeishuEvent } from '../../services/feishu/handler';
import portfolioRoutes from './portfolio';
import technicalRoutes from './technical';

const router = express.Router();

// 挂载技术指标路由
router.use('/technical', technicalRoutes);
router.use('/portfolio', portfolioRoutes);

// ─── JWT 认证中间件 ────────────────────────────────────────────────────────────

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  logger.debug(`[requireAuth] Authorization header: ${header ? header.substring(0, 30) + '...' : 'MISSING'}`);
  if (!header?.startsWith('Bearer ')) {
    logger.warn('[requireAuth] Missing or invalid Authorization header');
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }
  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, config.JWT_SECRET) as { userId: string; role?: string };
    (req as any).auth = payload;
    logger.debug(`[requireAuth] Token verified for user: ${payload.userId}`);
    next();
  } catch (err) {
    logger.warn(`[requireAuth] Token verification failed: ${err}`);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const auth = (req as any).auth as { userId: string; role?: string } | undefined;
  if (!auth || auth.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

// ─── 公开端点 ──────────────────────────────────────────────────────────────────

// 健康检查
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 飞书事件回调
router.post('/feishu/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    // 验证 token（可选，根据飞书配置）
    if (config.FEISHU_VERIFICATION_TOKEN) {
      const token = req.body?.header?.token;
      if (token !== config.FEISHU_VERIFICATION_TOKEN) {
        res.status(401).json({ error: 'Invalid verification token' });
        return;
      }
    }

    const result = await handleFeishuEvent(req.body);
    res.json(result);
  } catch (error) {
    logger.error('Error handling Feishu webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 注册用户（Discord Bot 内部调用，需 admin token）
router.post('/users', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { discordUserId, discordUsername, riskPreference } = req.body as {
      discordUserId?: string;
      discordUsername?: string;
      riskPreference?: string;
    };

    if (!discordUserId || !discordUsername) {
      res.status(400).json({ error: 'discordUserId and discordUsername are required' });
      return;
    }

    const existing = await getUserByDiscordId(discordUserId);
    if (existing) {
      res.status(409).json({ error: 'User already exists', user: existing });
      return;
    }

    const user = await createUser({ discordUserId, discordUsername, riskPreference });
    res.status(201).json(user);
  } catch (error) {
    logger.error('Error creating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 获取用户信息
router.get('/users/:discordUserId', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await queryOne(`
      SELECT * FROM users WHERE discord_user_id = $1
    `, [req.params.discordUserId]);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(user);
  } catch (error) {
    logger.error('Error fetching user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 获取用户信号历史
router.get('/users/:userId/signals', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50')), 100);
    const signals = await query(`
      SELECT sd.*, s.symbol, s.market, s.direction, s.confidence, s.suggested_position_pct
      FROM signal_deliveries sd
      JOIN signals s ON sd.signal_id = s.id
      WHERE sd.user_id = $1
      ORDER BY sd.sent_at DESC
      LIMIT $2
    `, [req.params.userId, limit]);

    res.json(signals);
  } catch (error) {
    logger.error('Error fetching signals:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 获取用户持仓（手动持仓）
router.get('/users/:userId/positions', async (req: Request, res: Response) => {
  try {
    const positions = await getManualPositions(req.params.userId);
    res.json(positions);
  } catch (error) {
    logger.error('Error fetching positions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 获取用户订单历史
router.get('/users/:userId/orders', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50')), 100);
    const orders = await query(`
      SELECT o.*, sd.adjusted_position_pct
      FROM orders o
      LEFT JOIN signal_deliveries sd ON o.delivery_id = sd.id
      WHERE o.user_id = $1
      ORDER BY o.created_at DESC
      LIMIT $2
    `, [req.params.userId, limit]);

    res.json(orders);
  } catch (error) {
    logger.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── 管理员端点 ────────────────────────────────────────────────────────────────

// 获取AI成本统计
router.get('/admin/costs', requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const today = await queryOne(`
      SELECT
        COUNT(*)::int AS call_count,
        ROUND(SUM(estimated_cost_usd)::numeric, 4) AS total_cost_usd
      FROM ai_cost_logs
      WHERE created_at >= CURRENT_DATE
    `);

    const thisMonth = await queryOne(`
      SELECT
        COUNT(*)::int AS call_count,
        ROUND(SUM(estimated_cost_usd)::numeric, 4) AS total_cost_usd
      FROM ai_cost_logs
      WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
    `);

    const byCallType = await query(`
      SELECT call_type, COUNT(*)::int AS call_count,
             ROUND(SUM(estimated_cost_usd)::numeric, 4) AS total_cost_usd
      FROM ai_cost_logs
      WHERE created_at >= CURRENT_DATE
      GROUP BY call_type
      ORDER BY total_cost_usd DESC
    `);

    res.json({ today, thisMonth, byCallType });
  } catch (error) {
    logger.error('Error fetching costs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 获取所有订单（管理员视图）
router.get('/admin/orders', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '100')), 500);
    const status = req.query.status as string | undefined;

    const conditions = status ? 'WHERE o.status = $2' : '';
    const params = status ? [limit, status] : [limit];

    const orders = await query(`
      SELECT o.*, u.discord_username
      FROM orders o
      JOIN users u ON o.user_id = u.id
      ${conditions}
      ORDER BY o.created_at DESC
      LIMIT $1
    `, params);

    res.json(orders);
  } catch (error) {
    logger.error('Error fetching admin orders:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin Dashboard 端点 ──────────────────────────────────────────────────────

// 聚合统计数据
router.get('/admin/dashboard/stats', requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [news, signals, orders, deliveries] = await Promise.all([
      queryOne(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS today,
          COUNT(*) FILTER (WHERE ai_processed = true)::int AS ai_processed,
          COUNT(*) FILTER (WHERE ai_processed = false)::int AS pending
        FROM news_items
      `),
      queryOne(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS today,
          COALESCE(ROUND(AVG(confidence), 1), 0) AS avg_confidence
        FROM signals
      `),
      queryOne(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS today,
          COUNT(*) FILTER (WHERE status = 'filled')::int AS filled,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
        FROM orders
      `),
      queryOne(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed
        FROM signal_deliveries
      `),
    ]);

    res.json({
      news: {
        total: news?.total ?? 0,
        today: news?.today ?? 0,
        aiProcessed: news?.ai_processed ?? 0,
        pending: news?.pending ?? 0,
      },
      signals: {
        total: signals?.total ?? 0,
        today: signals?.today ?? 0,
        avgConfidence: Number(signals?.avgConfidence) || 0,
      },
      orders: {
        total: orders?.total ?? 0,
        today: orders?.today ?? 0,
        filled: orders?.filled ?? 0,
        failed: orders?.failed ?? 0,
      },
      deliveries: {
        total: deliveries?.total ?? 0,
        pending: deliveries?.pending ?? 0,
        confirmed: deliveries?.confirmed ?? 0,
        completed: deliveries?.completed ?? 0,
      },
    });
  } catch (error) {
    logger.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 资讯列表
router.get('/admin/dashboard/news', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50')), 100);
    const rows = await query(`
      SELECT
        id, title, source, market, symbols,
        ai_summary, ai_processed, ai_processed_at,
        published_at, created_at
      FROM news_items
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    res.json(rows);
  } catch (error) {
    logger.error('Error fetching dashboard news:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 信号列表（含推送统计）
router.get('/admin/dashboard/signals', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50')), 100);
    const rows = await query(`
      SELECT * FROM (
        SELECT DISTINCT ON (s.symbol, s.market)
          s.id, s.symbol, s.market, s.direction,
          s.confidence, s.suggested_position_pct, s.reasoning,
          s.expires_at, s.created_at,
          COUNT(sd.id)::int AS delivery_count,
          COUNT(sd.id) FILTER (WHERE sd.status = 'pending')::int AS pending_count,
          COUNT(sd.id) FILTER (WHERE sd.status = 'completed')::int AS completed_count
        FROM signals s
        LEFT JOIN signal_deliveries sd ON s.id = sd.signal_id
        GROUP BY s.id
        ORDER BY s.symbol, s.market, s.created_at DESC
      ) deduped
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    res.json(rows);
  } catch (error) {
    logger.error('Error fetching dashboard signals:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 推送记录列表（管理员视图）
router.get('/admin/deliveries', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '100')), 500);
    const status = req.query.status as string | undefined;

    const conditions = status ? 'WHERE sd.status = $2' : '';
    const params: (number | string)[] = status ? [limit, status] : [limit];

    const rows = await query(`
      SELECT
        sd.id, sd.sent_at, sd.status,
        sd.adjusted_position_pct, sd.override_risk_warning,
        sd.risk_check_result, sd.confirmed_at, sd.ignored_at,
        u.discord_username,
        s.symbol, s.market, s.direction, s.confidence
      FROM signal_deliveries sd
      JOIN signals s ON sd.signal_id = s.id
      JOIN users u ON sd.user_id = u.id
      ${conditions}
      ORDER BY sd.sent_at DESC
      LIMIT $1
    `, params);

    res.json(rows);
  } catch (error) {
    logger.error('Error fetching admin deliveries:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 用户列表（管理员视图，含信号数和订单数统计）
router.get('/admin/users', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '100')), 500);

    const rows = await query(`
      SELECT
        u.id, u.discord_username, u.risk_preference,
        u.custom_single_position_limit, u.custom_total_position_limit,
        u.daily_signal_limit, u.is_active, u.created_at,
        COUNT(DISTINCT sd.id)::int AS signal_count,
        COUNT(DISTINCT o.id)::int  AS order_count
      FROM users u
      LEFT JOIN signal_deliveries sd ON sd.user_id = u.id
      LEFT JOIN orders o ON o.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $1
    `, [limit]);

    res.json(rows);
  } catch (error) {
    logger.error('Error fetching admin users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 生成管理员 token（仅内部使用，需要在环境变量中配置 ADMIN_DISCORD_USER_ID）
router.post('/admin/token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { discordUserId } = req.body as { discordUserId?: string };
    if (!discordUserId || discordUserId !== config.ADMIN_DISCORD_USER_ID) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    const token = jwt.sign(
      { userId: discordUserId, role: 'admin' },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] }
    );

    res.json({ token, expiresIn: config.JWT_EXPIRES_IN });
  } catch (error) {
    logger.error('Error generating admin token:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── 富途模拟盘 API ──────────────────────────────────────────────────────────────

import { spawn } from 'child_process';

// 获取富途模拟盘实时持仓
router.get('/futu/positions', async (_req: Request, res: Response) => {
  return new Promise((resolve) => {
    const pythonCode = `
from futu import OpenSecTradeContext, TrdEnv, TrdMarket
import json
with OpenSecTradeContext(host='127.0.0.1', port=11111, filter_trdmarket=TrdMarket.US) as ctx:
    ret, data = ctx.position_list_query(trd_env=TrdEnv.SIMULATE, acc_id=9132532)
    if ret == 0 and len(data) > 0:
        cols = ['code', 'stock_name', 'qty', 'cost_price', 'market_val', 'pl_ratio', 'pl_val']
        existing = [c for c in cols if c in data.columns]
        print(data[existing].to_json(orient='records'))
    else:
        print('[]')
`;

    const child = spawn('python3', ['-c', pythonCode], {
      env: { ...process.env, PYTHONPATH: '/Users/zhengzefeng/Library/Python/3.9/lib/python3.9/site-packages' }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      logger.info(`[futu/positions] stdout_len=${stdout.length}, stderr_len=${stderr.length}`);
      if (code === 0) {
        try {
          // 提取 JSON 数组：找到第一个 [ 开头的那行，提取该行及之后的内容
          const lines = stdout.split('\n');
          let jsonLine = '';
          
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
              jsonLine = trimmed;
              break;
            }
          }
          
          if (jsonLine) {
            const data = JSON.parse(jsonLine);
            res.json({ success: true, data });
          } else {
            res.json({ success: true, data: [] });
          }
        } catch (e: unknown) {
          logger.error(`[futu/positions] parse error: ${(e as Error).message}, stdout=${stdout.substring(0, 300)}`);
          res.json({ success: true, data: [] });
        }
      } else {
        res.status(500).json({ success: false, error: stderr || stdout });
      }
    });

    child.on('error', (err) => {
      logger.error(`[futu/positions] error=${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    });
  });
});

// 获取富途模拟盘最近订单
router.get('/futu/orders', async (_req: Request, res: Response) => {
  return new Promise((resolve) => {
    const pythonCode = `
from futu import OpenSecTradeContext, TrdEnv, TrdMarket
import json
with OpenSecTradeContext(host='127.0.0.1', port=11111, filter_trdmarket=TrdMarket.US) as ctx:
    ret, data = ctx.order_list_query(trd_env=TrdEnv.SIMULATE, acc_id=9132532)
    if ret == 0 and len(data) > 0:
        cols = ['order_id', 'code', 'stock_name', 'trd_side', 'qty', 'dealt_qty', 'price', 'order_status', 'create_time']
        existing = [c for c in cols if c in data.columns]
        print(data[existing].tail(20).to_json(orient='records'))
    else:
        print('[]')
`;

    const child = spawn('python3', ['-c', pythonCode], {
      env: { ...process.env, PYTHONPATH: '/Users/zhengzefeng/Library/Python/3.9/lib/python3.9/site-packages' }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      logger.info(`[futu/orders] stdout_len=${stdout.length}, stderr_len=${stderr.length}`);
      if (code === 0) {
        try {
          // 提取 JSON 数组：找到第一个 [ 开头的那行
          const lines = stdout.split('\n');
          let jsonLine = '';
          
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
              jsonLine = trimmed;
              break;
            }
          }
          
          if (jsonLine) {
            const data = JSON.parse(jsonLine);
            res.json({ success: true, data });
          } else {
            res.json({ success: true, data: [] });
          }
        } catch (e: unknown) {
          logger.error(`[futu/orders] parse error: ${(e as Error).message}, stdout=${stdout.substring(0, 300)}`);
          res.json({ success: true, data: [] });
        }
      } else {
        res.status(500).json({ success: false, error: stderr || stdout });
      }
    });

    child.on('error', (err) => {
      logger.error(`[futu/orders] error=${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    });
  });
});

// ─── Dashboard 只读路由（无需认证）───────────────────────────────────────────

// 获取信号列表
router.get('/dashboard/signals', async (_req: Request, res: Response) => {
  try {
    const signals = await query(`
      SELECT s.id, s.symbol, s.market, s.direction, s.confidence, 
             s.status, s.created_at
      FROM signals s
      ORDER BY s.created_at DESC
      LIMIT 20
    `);
    res.json({ success: true, data: signals });
  } catch (error) {
    logger.error('Error fetching signals:', error);
    res.json({ success: false, error: 'Database error' });
  }
});

// 获取新闻列表
router.get('/dashboard/news', async (_req: Request, res: Response) => {
  try {
    // 直接从 news_items 表读取（新闻监控系统写入此表）
    const news = await query(`
      SELECT
        id,
        title,
        source,
        symbols as related_symbols,
        published_at,
        ai_processed,
        ai_summary,
        sentiment,
        market
      FROM news_items
      ORDER BY published_at DESC
      LIMIT 100
    `);

    res.json({ success: true, data: news });
  } catch (error) {
    logger.error('Error fetching news:', error);
    res.json({ success: false, error: 'Database error' });
  }
});

// 获取情绪信号
router.get('/sentiment/signals', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const symbol = req.query.symbol as string;

    let queryStr = `
      SELECT
        id,
        symbol,
        action,
        type,
        reason,
        sentiment_score,
        momentum,
        confidence,
        priority,
        created_at
      FROM sentiment_signals
    `;

    const params: any[] = [];

    if (symbol) {
      queryStr += ` WHERE symbol = $1`;
      params.push(symbol);
      queryStr += ` ORDER BY created_at DESC LIMIT $2`;
      params.push(limit);
    } else {
      queryStr += ` ORDER BY created_at DESC LIMIT $1`;
      params.push(limit);
    }

    const signals = await query(queryStr, params);

    res.json({ success: true, data: signals });
  } catch (error) {
    logger.error('Error fetching sentiment signals:', error);
    res.json({ success: false, error: 'Database error' });
  }
});

// ─── 情绪建议审批API ────────────────────────────────────────────────────────

// 获取待审批建议
router.get('/sentiment/suggestions', async (req: Request, res: Response) => {
  try {
    const status = (req.query.status as string) || 'pending';
    const limit = parseInt(req.query.limit as string) || 50;

    const suggestions = await query(`
      SELECT
        id,
        symbol,
        event_type,
        sentiment_score,
        sentiment_change,
        momentum,
        agent_analysis,
        suggested_action,
        confidence,
        reason,
        risk_level,
        entry_price,
        stop_loss,
        take_profit,
        status,
        created_at,
        reviewed_at,
        reviewed_by,
        review_note
      FROM sentiment_suggestions
      WHERE status = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [status, limit]);

    res.json({ success: true, data: suggestions });
  } catch (error) {
    logger.error('Error fetching suggestions:', error);
    res.json({ success: false, error: 'Database error' });
  }
});

// 批准建议
router.post('/sentiment/suggestions/:id/approve', async (req: Request, res: Response) => {
  try {
    const suggestionId = parseInt(req.params.id);
    const { review_note } = req.body;
    const reviewed_by = (req as any).auth?.userId || 'system';

    // 获取建议详情
    const suggestion = await queryOne(`
      SELECT * FROM sentiment_suggestions WHERE id = $1
    `, [suggestionId]);

    if (!suggestion) {
      res.status(404).json({ success: false, error: 'Suggestion not found' });
      return;
    }

    if (suggestion.status !== 'pending') {
      res.status(400).json({ success: false, error: 'Suggestion already reviewed' });
      return;
    }

    // 更新建议状态
    await query(`
      UPDATE sentiment_suggestions
      SET status = 'approved',
          reviewed_at = NOW(),
          reviewed_by = $1,
          review_note = $2
      WHERE id = $3
    `, [reviewed_by, review_note || null, suggestionId]);

    // 生成交易信号
    const signalResult = await query(`
      INSERT INTO sentiment_signals (
        symbol, action, type, reason,
        sentiment_score, momentum, confidence, priority,
        created_at
      ) VALUES ($1, $2, 'sentiment', $3, $4, $5, $6, $7, NOW())
      RETURNING id
    `, [
      suggestion.symbol,
      suggestion.suggested_action,
      suggestion.reason,
      suggestion.sentiment_score,
      suggestion.momentum,
      suggestion.confidence,
      suggestion.risk_level === 'HIGH' ? 'HIGH' : 'MEDIUM'
    ]);

    const signalId = signalResult[0].id;

    // 发送飞书通知
    try {
      const { sendFeishuText } = await import('../../services/market/watcher/feishu-notify');
      await sendFeishuText(`
✅ 交易信号已批准

📊 股票：${suggestion.symbol}
🎯 操作：${suggestion.suggested_action}
💯 置信度：${(suggestion.confidence * 100).toFixed(0)}%

📝 理由：${suggestion.reason}
👤 审批人：${reviewed_by}
      `);
    } catch (error) {
      logger.error('Failed to send Feishu notification:', error);
    }

    res.json({ success: true, signal_id: signalId });
  } catch (error) {
    logger.error('Error approving suggestion:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 拒绝建议
router.post('/sentiment/suggestions/:id/reject', async (req: Request, res: Response) => {
  try {
    const suggestionId = parseInt(req.params.id);
    const { review_note } = req.body;
    const reviewed_by = (req as any).auth?.userId || 'system';

    if (!review_note) {
      res.status(400).json({ success: false, error: 'Review note is required for rejection' });
      return;
    }

    // 获取建议详情
    const suggestion = await queryOne(`
      SELECT * FROM sentiment_suggestions WHERE id = $1
    `, [suggestionId]);

    if (!suggestion) {
      res.status(404).json({ success: false, error: 'Suggestion not found' });
      return;
    }

    if (suggestion.status !== 'pending') {
      res.status(400).json({ success: false, error: 'Suggestion already reviewed' });
      return;
    }

    // 更新建议状态
    await query(`
      UPDATE sentiment_suggestions
      SET status = 'rejected',
          reviewed_at = NOW(),
          reviewed_by = $1,
          review_note = $2
      WHERE id = $3
    `, [reviewed_by, review_note, suggestionId]);

    res.json({ success: true });
  } catch (error) {
    logger.error('Error rejecting suggestion:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 获取聚合统计
router.get('/dashboard/stats', async (_req: Request, res: Response) => {
  try {
    const [signalsTotal, signalsToday, signalsGenerated, signalsSent, newsToday] = await Promise.all([
      queryOne(`SELECT COUNT(*)::int as count FROM signals`),
      queryOne(`SELECT COUNT(*)::int as count FROM signals WHERE created_at >= CURRENT_DATE`),
      queryOne(`SELECT COUNT(*)::int as count FROM signals WHERE status = 'generated'`),
      queryOne(`SELECT COUNT(*)::int as count FROM signals WHERE status = 'sent'`),
      queryOne(`SELECT COUNT(*)::int as count FROM news_items WHERE created_at >= CURRENT_DATE`),
    ]);

    res.json({
      success: true,
      data: {
        totalSignals: signalsTotal?.count || 0,
        todaySignals: signalsToday?.count || 0,
        generatedSignals: signalsGenerated?.count || 0,
        sentSignals: signalsSent?.count || 0,
        todayNews: newsToday?.count || 0,
      }
    });
  } catch (error) {
    logger.error('Error fetching stats:', error);
    res.json({ success: false, error: 'Database error' });
  }
});

// 获取系统日志（从日志文件读取）
router.get('/dashboard/system', async (_req: Request, res: Response) => {
  try {
    // 从日志目录读取最近的日志
    const fs = await import('fs');
    const path = await import('path');
    const logPath = path.join(process.cwd(), 'logs/combined.log');
    
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf-8');
      const lines = content.split('\n').filter(l => l.includes('info')).slice(-10);
      const logs = lines.map((line, i) => {
        try {
          const obj = JSON.parse(line);
          return {
            id: `log_${i}`,
            agent_id: 'system',
            input_summary: obj.message || '-',
            output_summary: obj.level || '-',
            status: 'success',
            timestamp: obj.timestamp || new Date().toISOString()
          };
        } catch {
          return null;
        }
      }).filter(Boolean);
      res.json({ success: true, data: logs });
    } else {
      res.json({ success: true, data: [] });
    }
  } catch (error) {
    logger.error('Error fetching system logs:', error);
    res.json({ success: false, error: 'System error' });
  }
});

// ==================== Watchlist API ====================
router.get('/watchlist', async (req: Request, res: Response): Promise<void> => {
  try {
    const market = req.query.market as string;
    const sql = market 
      ? 'SELECT symbol, name, market, sector, sector_rank, is_active, is_tradeable, created_at FROM watchlist WHERE market = $1 AND is_active = true ORDER BY sector_rank'
      : 'SELECT symbol, name, market, sector, sector_rank, is_active, is_tradeable, created_at FROM watchlist ORDER BY market, sector, sector_rank';
    const params = market ? [market] : [];
    const result = await query(sql, params);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('watchlist error:', error);
    res.json({ success: false, error: String(error) });
  }
});

router.post('/watchlist', async (req: Request, res: Response): Promise<void> => {
  try {
    const { symbol, name, market, sector, sector_rank, is_tradeable } = req.body;
    await query(
      `INSERT INTO watchlist (symbol, name, market, sector, sector_rank, is_tradeable, added_by, added_reason)
       VALUES ($1, $2, $3, $4, $5, $6, 'manual', 'API添加')
       ON CONFLICT DO NOTHING`,
      [symbol, name || symbol, market, sector || '未分类', sector_rank || 99, is_tradeable ?? true]
    );
    await query(
      `INSERT INTO watchlist_history (symbol, market, action, reason, operator) VALUES ($1, $2, 'added', $3, 'manual')`,
      [symbol, market, 'API添加']
    );
    res.json({ success: true, message: `${symbol} 已添加` });
  } catch (error) {
    logger.error('watchlist add error:', error);
    res.json({ success: false, error: String(error) });
  }
});

router.put('/watchlist/:symbol', async (req: Request, res: Response): Promise<void> => {
  try {
    const { symbol } = req.params;
    const { is_active, market } = req.body;
    await query(
      `UPDATE watchlist SET is_active = $1, updated_at = NOW() WHERE symbol = $2 AND market = $3`,
      [is_active ?? true, symbol, market]
    );
    await query(
      `INSERT INTO watchlist_history (symbol, market, action, reason, operator) VALUES ($1, $2, $3, $4, 'manual')`,
      [symbol, market, is_active ? 'resumed' : 'paused', 'API操作']
    );
    res.json({ success: true });
  } catch (error) {
    logger.error('watchlist update error:', error);
    res.json({ success: false, error: String(error) });
  }
});

router.delete('/watchlist/:symbol', async (req: Request, res: Response): Promise<void> => {
  try {
    const { symbol } = req.params;
    const { market } = req.body;
    await query(
      `UPDATE watchlist SET is_active = false, removed_at = NOW(), removed_reason = 'API删除' WHERE symbol = $1 AND market = $2`,
      [symbol, market]
    );
    await query(
      `INSERT INTO watchlist_history (symbol, market, action, reason, operator) VALUES ($1, $2, 'removed', $3, 'manual')`,
      [symbol, market, 'API删除']
    );
    res.json({ success: true });
  } catch (error) {
    logger.error('watchlist delete error:', error);
    res.json({ success: false, error: String(error) });
  }
});

export default router;
