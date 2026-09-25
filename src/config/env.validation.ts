import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  CORS_ORIGIN: Joi.string().default('http://localhost:3001'),
  FRONTEND_URL: Joi.string().uri().default('http://localhost:3001'),
  SUPABASE_URL: Joi.string().uri().allow('').default(''),
  SUPABASE_ANON_KEY: Joi.string().allow('').default(''),
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().allow('').default(''),
});
