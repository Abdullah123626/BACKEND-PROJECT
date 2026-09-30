import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { setupSwagger } from './app.swagger.js';

async function bootstrap() {
  // nest server application creation
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  
  // API docs: /docs (UI) aur /docs/json (OpenAPI)
  setupSwagger(app);

  const port = Number(process.env.PORT) || 3000;
  
  // Railway container ke liye '0.0.0.0' host add karna lazmi hai
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on port: ${port}`);
}

void bootstrap();