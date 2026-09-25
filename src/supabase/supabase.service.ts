import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
	private readonly client: SupabaseClient;
	private readonly adminClient: SupabaseClient;

	constructor(private readonly configService: ConfigService) {
		const url = this.configService.get<string>('supabase.url');
		const anonKey = this.configService.get<string>('supabase.anonKey');
		const serviceRoleKey = this.configService.get<string>(
			'supabase.serviceRoleKey',
		);

		if (!url || !anonKey || !serviceRoleKey) {
			throw new Error('Supabase configuration is incomplete');
		}

		this.client = createClient(url, anonKey, {
			auth: {
				autoRefreshToken: false,
				persistSession: false,
			},
		});

		this.adminClient = createClient(url, serviceRoleKey, {
			auth: {
				autoRefreshToken: false,
				persistSession: false,
			},
		});
	}

	getClient(): SupabaseClient {
		return this.client;
	}

	getAdminClient(): SupabaseClient {
		return this.adminClient;
	}
}
