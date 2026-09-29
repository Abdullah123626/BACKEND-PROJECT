import {
	ArgumentsHost,
	Catch,
	ExceptionFilter,
	HttpException,
	HttpStatus,
	Logger,
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
	private readonly logger = new Logger(HttpExceptionFilter.name);

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

		// Ghair-mutawaqqa error: log me sirf naam aur route (stack trace, body ya
		// headers nahi, taake password/token kabhi log na hon). Client ko generic message.
		if (!(exception instanceof HttpException)) {
			const name = exception instanceof Error ? exception.name : typeof exception;
			this.logger.error(`Unhandled ${name} on ${request.method} ${request.path}`);
		}

		const payload: ErrorResponse = {
			statusCode: status,
			message,
			error,
			// Query string me token ho sakta hai, is liye sirf path
			path: request.path,
			timestamp: new Date().toISOString(),
		};

		response.status(status).json(payload);
	}
}
