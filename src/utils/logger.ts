import winston from 'winston';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const customFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level}]: ${stack || message}${metaStr}`;
});

const isProduction = process.env['NODE_ENV'] === 'production';

export const logger = winston.createLogger({
  level: process.env['LOG_LEVEL'] || (isProduction ? 'info' : 'debug'),
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    errors({ stack: true }),
    isProduction ? json() : combine(colorize(), customFormat)
  ),
  defaultMeta: { service: 'custody-vault' },
  transports: [
    new winston.transports.Console({
      silent: process.env['NODE_ENV'] === 'test',
    }),
  ],
});
