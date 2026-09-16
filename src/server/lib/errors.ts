import "server-only";

// Typed errors whose code and message are safe to send to a client (SEC-12).
// Internal detail belongs in `cause`, which is logged and never serialized.

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "PAGINATION_DEPTH"
  | "UNSAFE_URL"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "IMPORT_STALE"
  | "IMPORT_EXPIRED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "UNPROCESSABLE"
  | "IMAGE_TOO_LARGE"
  | "RATE_LIMITED"
  | "INTERNAL";

export type FieldIssue = Readonly<{ path: string; message: string }>;

export type ErrorBody = {
  error: { code: ErrorCode; message: string; details?: readonly FieldIssue[] };
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: readonly FieldIssue[];

  constructor(
    code: ErrorCode,
    status: number,
    message: string,
    options: { cause?: unknown; details?: readonly FieldIssue[] } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = options.details;
  }
}

export class ValidationError extends AppError {
  constructor(details: readonly FieldIssue[], message = "Invalid request.") {
    super("VALIDATION_ERROR", 400, message, { details });
  }
}

export class PaginationDepthError extends AppError {
  constructor() {
    super(
      "PAGINATION_DEPTH",
      400,
      "Too many pages. Narrow the filters instead.",
    );
  }
}

export class UnsafeUrlError extends AppError {
  /** `reason` must never contain a resolved internal address (SEC-05). */
  constructor(reason: string, cause?: unknown) {
    super("UNSAFE_URL", 400, `This URL can't be fetched: ${reason}`, { cause });
  }
}

export class UnauthorizedError extends AppError {
  constructor() {
    super("UNAUTHORIZED", 401, "Authentication required.");
  }
}

export class ForbiddenError extends AppError {
  constructor() {
    super("FORBIDDEN", 403, "You don't have permission to do that.");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found.") {
    super("NOT_FOUND", 404, message);
  }
}

export class ConflictError extends AppError {
  constructor(
    message = "This conflicts with existing data.",
    code: "CONFLICT" | "IMPORT_STALE" | "IMPORT_EXPIRED" = "CONFLICT",
  ) {
    super(code, 409, message);
  }
}

export class UnprocessableError extends AppError {
  constructor(
    message: string,
    code: "UNPROCESSABLE" | "IMAGE_TOO_LARGE" = "UNPROCESSABLE",
  ) {
    super(code, 422, message);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = "The request body is too large.") {
    super("PAYLOAD_TOO_LARGE", 413, message);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(message = "Unsupported content type.") {
    super("UNSUPPORTED_MEDIA_TYPE", 415, message);
  }
}

export class RateLimitedError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("RATE_LIMITED", 429, "Too many requests. Try again later.");
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Maps any thrown value to a client-safe response. Only AppError messages are exposed;
 * everything else — driver errors, SQL, stack traces — becomes a generic 500.
 */
export function toErrorResponse(error: unknown): {
  status: number;
  body: ErrorBody;
} {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
    };
  }
  return {
    status: 500,
    body: { error: { code: "INTERNAL", message: "Something went wrong." } },
  };
}
