import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmetImport, { type HelmetOptions } from 'helmet';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';

// helmet ESM/CJS typings alag resolve hoti hain (Vercel pe CJS typings milti hain),
// runtime pe dono cases me default export hi function hai
const helmet = helmetImport as unknown as (
  options?: HelmetOptions,
) => (...args: any[]) => void;

// main.ts aur tests dono yahi setup use karte hain, taake tests asal app jaisa chalein.
export function configureApp(app: INestApplication) {
  const configService = app.get(ConfigService);

  // Vercel/Render ek proxy ke peeche chalte hain: request.ip asli client IP de
  // aur client ka apna X-Forwarded-For header rate limit ko bypass na kar sake.
  (app as NestExpressApplication).set('trust proxy', 1);

  // Security headers. CSP me sirf Swagger UI wala CDN allow (baaki helmet defaults).
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'script-src': ["'self'", 'https://cdn.jsdelivr.net'],
          'style-src': ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
          'img-src': ["'self'", 'data:', 'https://cdn.jsdelivr.net'],
        },
      },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  // CORS_ORIGIN me comma se multiple URLs de sakte hain (e.g. production + localhost)
  app.enableCors({
    origin: (configService.get<string>('app.corsOrigin') ?? '')
      .split(',')
      .map((url) => url.trim().replace(/\/+$/, ''))
      .filter(Boolean),
    credentials: true,
  });

  // Har request ki DTO validation; unexpected fields reject
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
      validationError: { target: false, value: false },
    }),
  );
}
