import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  // nest server application creation
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  // Server Start - Vercel/Render khud PORT dete hain, is liye process.env.PORT pehle
  await app.listen(process.env.PORT ?? 3000);
}

// Vercel ke official NestJS pattern ki tarah top-level await ke baghair
void bootstrap();
