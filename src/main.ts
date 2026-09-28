import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmetImport, { type HelmetOptions } from 'helmet';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';

// helmet ESM/CJS typings alag resolve hoti hain (Vercel pe CJS typings milti hain),
// runtime pe dono cases me default export hi function hai
const helmet = helmetImport as unknown as (
  options?: HelmetOptions,
) => (...args: any[]) => void;

async function bootstrap() {

  // nest server application creation
  const app = await NestFactory.create(AppModule);

  // configuration get kr ra
  const configService = app.get(ConfigService);


  // SECurity
  app.use(helmet());
  app.useGlobalFilters(new HttpExceptionFilter());

  // CORS
  app.enableCors({
    origin: configService.get<string>('app.corsOrigin'),
    credentials: true,
  });

  // DTO validation
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
    }),
  );

  // Server Start - Vercel khud PORT deta hai, is liye process.env.PORT pehle
  await app.listen(process.env.PORT ?? 3000);
}

// Vercel ke official NestJS pattern ki tarah top-level await ke baghair
void bootstrap();
