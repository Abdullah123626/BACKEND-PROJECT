import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';

// @nestjs/throttler CommonJS hai aur Nest 12 (ESM-only) ko require() karta hai,
// jo Vercel pe ERR_REQUIRE_ESM deta hai. Is liye ye chhota in-memory limiter use ho raha.
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 10;

interface Hit {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, Hit>();

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const now = Date.now();

    this.removeExpired(now);

    const key = `${this.getClientIp(request)}:${request.method}:${request.path}`;
    let hit = this.hits.get(key);
    if (!hit || hit.resetAt <= now) {
      hit = { count: 0, resetAt: now + WINDOW_MS };
      this.hits.set(key, hit);
    }
    hit.count++;

    const retryAfterSeconds = Math.ceil((hit.resetAt - now) / 1000);
    response.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
    response.setHeader(
      'X-RateLimit-Remaining',
      Math.max(0, MAX_REQUESTS - hit.count),
    );

    if (hit.count > MAX_REQUESTS) {
      response.setHeader('Retry-After', retryAfterSeconds);
      throw new HttpException(
        'Too many requests. Please try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  // Vercel/proxy ke peeche asli client IP x-forwarded-for me hota hai
  private getClientIp(request: Request): string {
    const forwarded = request.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return first?.split(',')[0]?.trim() || request.ip || 'unknown';
  }

  private removeExpired(now: number) {
    if (this.hits.size < 1000) return;
    for (const [key, hit] of this.hits) {
      if (hit.resetAt <= now) this.hits.delete(key);
    }
  }
}
