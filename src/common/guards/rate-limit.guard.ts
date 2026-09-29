import {
	CanActivate,
	ExecutionContext,
	HttpException,
	HttpStatus,
	Injectable,
	SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AttemptCounter } from '../security/attempt-counter.js';
import { getClientIp } from '../security/client-ip.js';

// @nestjs/throttler CommonJS hai aur Nest 12 (ESM-only) ko require() karta hai,
// jo Vercel pe ERR_REQUIRE_ESM deta hai. Is liye apna chhota limiter.
export type RateLimitOptions = {
	limit: number;
	windowMs: number;
};

const RATE_LIMIT_KEY = 'rateLimit';
const DEFAULT_LIMIT: RateLimitOptions = { limit: 60, windowMs: 60_000 };

// Sensitive routes pe sakht limit lagane ke liye: @RateLimit({ limit: 5, windowMs: 60_000 })
export const RateLimit = (options: RateLimitOptions) =>
	SetMetadata(RATE_LIMIT_KEY, options);

@Injectable()
export class RateLimitGuard implements CanActivate {
	private readonly counters = new Map<string, AttemptCounter>();

	constructor(private readonly reflector: Reflector) {}

	canActivate(context: ExecutionContext): boolean {
		const options =
			this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
				context.getHandler(),
				context.getClass(),
			]) ?? DEFAULT_LIMIT;

		const http = context.switchToHttp();
		const request = http.getRequest<Request>();
		const response = http.getResponse<Response>();

		// Route ke hisaab se alag counter, key = IP + method + path
		const routeKey = `${request.method}:${request.route?.path ?? request.path}`;
		const counter = this.getCounter(routeKey, options);
		const result = counter.hit(`${getClientIp(request)}:${routeKey}`);

		response.setHeader('X-RateLimit-Limit', options.limit);
		response.setHeader('X-RateLimit-Remaining', result.remaining);

		if (!result.allowed) {
			response.setHeader('Retry-After', result.retryAfterSeconds);
			throw new HttpException(
				'Too many requests. Please try again later',
				HttpStatus.TOO_MANY_REQUESTS,
			);
		}
		return true;
	}

	private getCounter(routeKey: string, options: RateLimitOptions): AttemptCounter {
		let counter = this.counters.get(routeKey);
		if (!counter) {
			counter = new AttemptCounter(options.limit, options.windowMs);
			this.counters.set(routeKey, counter);
		}
		return counter;
	}
}
