import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from './api-responses.js';

// Ek status code ke liye error response (description ke saath), sab ka shape ErrorResponse.
export function ApiErrors(errors: Record<number, string>) {
	return applyDecorators(
		...Object.entries(errors).map(([status, description]) =>
			ApiResponse({ status: Number(status), description, type: ErrorResponse }),
		),
	);
}
