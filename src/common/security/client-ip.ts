import type { Request } from 'express';

// main.ts me "trust proxy" set hai, is liye request.ip proxy (Vercel/Render) ke peeche
// bhi asli client IP deta hai aur client ka apna bheja X-Forwarded-For spoof nahi hota.
export function getClientIp(request: Request): string {
	return request.ip || request.socket?.remoteAddress || 'unknown';
}
