import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { initNewsSocket } from '../sockets/news-socket';
import cors from 'cors';
import path from 'path';
import { config } from '../config';
import { logger } from '../utils/logger';
import routes from './routes';

const app = express();

// CORS 配置 — 白名单模式，生产环境通过 CORS_ORIGINS 环境变量配置实际域名
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3000', 'http://localhost:3001'];

app.use(cors({
  origin: (origin, cb) => {
    // 允许无 Origin 头的请求（curl、服务端调用等）
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json());

// 请求追踪日志中间件
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// Dashboard 静态文件服务（__dirname 编译后为 dist/api/，../../public 指向项目根目录）
// 根路径静态文件服务（直接访问 panel-orders.html 等）
app.use(express.static(path.join(__dirname, '../../public')));
// /dashboard 路径
app.use('/dashboard', express.static(path.join(__dirname, '../../public')));
// 共享前端 JS 模块（dashboard.html 中绝对路径 /js/ 引用）
app.use('/js', express.static(path.join(__dirname, '../../public/js')));

// 路由
app.use('/api', routes);

// 全局错误处理中间件（必须在路由之后）
 
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled API error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

let httpServer: ReturnType<typeof createServer> | null = null;
let io: Server | null = null;

export async function startAPIServer(): Promise<{ httpServer: ReturnType<typeof createServer>; io: Server }> {
  return new Promise((resolve) => {
    httpServer = createServer(app);
    io = new Server(httpServer, {
      cors: { origin: '*', methods: ['GET', 'POST'] }
    });
    initNewsSocket(httpServer);
    
    httpServer.listen(config.PORT, () => {
      logger.info(`API server listening on port ${config.PORT}`);
      resolve({ httpServer: httpServer!, io: io! });
    });
  });
}

export { app };

