import {
	ArgumentsHost,
	Catch,
	ExceptionFilter,
	HttpException,
	HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

type ErrorResponse = {
	statusCode: number;
	message: string | string[];
	error: string;
	path: string;
	timestamp: string;
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
	catch(exception: unknown, host: ArgumentsHost): void {
		const context = host.switchToHttp();
		const response = context.getResponse<Response>();
		const request = context.getRequest<Request>();

		const status =
			exception instanceof HttpException
				? exception.getStatus()
				: HttpStatus.INTERNAL_SERVER_ERROR;
		const exceptionResponse =
			exception instanceof HttpException ? exception.getResponse() : null;

		let message: string | string[] = 'Internal server error';
		let error = 'Internal Server Error';

		if (typeof exceptionResponse === 'string') {
			message = exceptionResponse;
		} else if (exceptionResponse && typeof exceptionResponse === 'object') {
			const body = exceptionResponse as {
				message?: string | string[];
				error?: string;
			};
			message = body.message ?? message;
			error = body.error ?? error;
		}

		const payload: ErrorResponse = {
			statusCode: status,
			message,
			error,
			path: request.url,
			timestamp: new Date().toISOString(),
		};

		response.status(status).json(payload);
	}
}