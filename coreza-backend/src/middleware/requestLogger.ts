import { Request, Response, NextFunction } from 'express';

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  // Log request
  console.log(`📥 ${req.method} ${req.url} - ${new Date().toISOString()}`);
  
  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const statusEmoji = status >= 400 ? '❌' : status >= 300 ? '🔄' : '✅';
    
    console.log(`📤 ${statusEmoji} ${req.method} ${req.url} - ${status} - ${duration}ms`);
  });
  
  next();
};