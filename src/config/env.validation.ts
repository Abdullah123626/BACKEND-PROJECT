import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  CORS_ORIGIN: Joi.string().default('http://localhost:3000'),
  FRONTEND_URL: Joi.string().uri().default('http://localhost:3000'),
  // Supabase ke baghair app chal hi nahi sakti, is liye start pe hi saaf error
  SUPABASE_URL: Joi.string().uri().required(),
  SUPABASE_ANON_KEY: Joi.string().required(),
  // App ko service-role key ki zaroorat nahi (sirf RLS integration test ke liye optional)
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().optional(),
});
