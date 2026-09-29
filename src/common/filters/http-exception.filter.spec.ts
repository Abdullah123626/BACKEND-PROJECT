import { BadRequestException, Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from './http-exception.filter.js';

function createHost(request: Record<string, unknown>) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => request,
    }),
  };
  return { host, status, json };
}

describe('HttpExceptionFilter', () => {
  it('returns a consistent JSON response for an HTTP exception', () => {
    const { host, status, json } = createHost({
      method: 'POST',
      path: '/auth/signup',
      url: '/auth/signup',
    });

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

  it('hides internal error details, stack traces and query strings', () => {
    const logSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { host, status, json } = createHost({
      method: 'GET',
      path: '/profiles/me',
      url: '/profiles/me?access_token=secret-token',
    });

    const internal = new Error('duplicate key value violates constraint "profiles_pkey" password=hunter2');
    new HttpExceptionFilter().catch(internal, host as any);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body).toMatchObject({
      statusCode: 500,
      message: 'Internal server error',
      path: '/profiles/me',
    });
    expect(JSON.stringify(body)).not.toContain('secret-token');
    expect(JSON.stringify(body)).not.toContain('profiles_pkey');

    const logged = logSpy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('hunter2');
    expect(logged).not.toContain('secret-token');
    expect(logged).not.toContain('at ');
    logSpy.mockRestore();
  });
});
