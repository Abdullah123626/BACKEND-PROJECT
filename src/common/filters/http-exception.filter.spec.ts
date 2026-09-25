import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from './http-exception.filter.js';

describe('HttpExceptionFilter', () => {
  it('returns a consistent JSON response for an HTTP exception', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const request = { url: '/auth/signup' };
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => request,
      }),
    };

    new HttpExceptionFilter().catch(
      new BadRequestException('Email is already registered'),
      host as any,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      message: 'Email is already registered',
      error: 'Bad Request',
      path: '/auth/signup',
      timestamp: expect.any(String),
    });
  });
});
