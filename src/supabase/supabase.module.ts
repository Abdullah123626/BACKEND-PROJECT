import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseService } from './supabase.service.js';

@Global()
@Module({
    // SupabaseModule ke andar ConfigModule available karta.
	imports: [ConfigModule],
    // SupabaseService ko NestJS ke dependency injection system mein register karta.
	providers: [SupabaseService],
    // SupabaseService ko doosre modules ke liye available/export karta ha.
	exports: [SupabaseService],   
})
export class SupabaseModule {}
