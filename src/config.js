import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  BOT_TOKEN: z.string().regex(/^\d+:[\w-]{30,}$/, 'BOT_TOKEN имеет неверный формат (возьмите его у @BotFather)'),
  BOT_USERNAME: z.string().min(3),
  APP_SHORT_NAME: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET должен быть не короче 32 символов'),
  DATABASE_URL: z.string().min(1),
  DB_SSL: z.enum(['true', 'false']).default('false'),
  PUBLIC_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
});

const parsed = schema.safeParse({
  ...process.env,
  // На Render адрес подставляется автоматически
  PUBLIC_URL: process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || undefined,
});

if (!parsed.success) {
  console.error('Ошибка конфигурации (.env / переменные хостинга):');
  for (const issue of parsed.error.issues) console.error(` - ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  botToken: env.BOT_TOKEN,
  botUsername: env.BOT_USERNAME.replace(/^@/, ''),
  appShortName: env.APP_SHORT_NAME,
  jwtSecret: env.JWT_SECRET,
  databaseUrl: env.DATABASE_URL,
  dbSsl: env.DB_SSL === 'true',
  publicUrl: env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/+$/, '') : null,
  port: env.PORT,
};
