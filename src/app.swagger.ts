import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

export const SWAGGER_PATH = 'docs';

// Swagger UI ki files CDN se: Vercel serverless bundle me swagger-ui-dist ki
// static files shamil nahi hotin, is liye local serve karne pe khali page aata hai.
const SWAGGER_UI_CDN = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.33.0';

export function createSwaggerDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Auth & Profile API')
    .setDescription(
      [
        'NestJS + Supabase authentication and user profile API.',
        '',
        '**How to try protected endpoints:** call `POST /auth/login`, copy `session.accessToken`, click **Authorize** (top right) and paste it (without the word Bearer).',
        '',
        'All errors use the same shape: `{ statusCode, message, error, path, timestamp }`.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Supabase access token from /auth/login' },
    )
    .addTag('Auth', 'Signup, login, sessions, password recovery and email change')
    .addTag('Profiles', "The logged-in user's own profile")
    .addTag('Health')
    .build();

  return SwaggerModule.createDocument(app, config);
}

// /docs par Swagger UI aur /docs/json par OpenAPI JSON. SWAGGER_ENABLED=false se band.
export function setupSwagger(app: INestApplication) {
  const enabled = app.get(ConfigService).get<string>('SWAGGER_ENABLED') ?? 'true';
  if (enabled.toLowerCase() === 'false') return;

  SwaggerModule.setup(SWAGGER_PATH, app, () => createSwaggerDocument(app), {
    customSiteTitle: 'Auth & Profile API Docs',
    customCssUrl: `${SWAGGER_UI_CDN}/swagger-ui.css`,
    customJs: [
      `${SWAGGER_UI_CDN}/swagger-ui-bundle.js`,
      `${SWAGGER_UI_CDN}/swagger-ui-standalone-preset.js`,
    ],
    jsonDocumentUrl: `${SWAGGER_PATH}/json`,
    swaggerOptions: {
      // Authorize me dala token page refresh pe bhi yaad rahe
      persistAuthorization: true,
      displayRequestDuration: true,
      tagsSorter: 'alpha',
    },
  });
}
