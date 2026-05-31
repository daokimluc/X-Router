/**
 * Typed "resource not found" error. Thrown by admin handlers in place of
 * `throw new Error("… not found")` so the shared error handler maps it to a
 * 404 with the standard `{ error: { type, message, code } }` envelope instead of
 * a generic 500. (admin-error-semantics, A2.)
 */
export class NotFoundError extends Error {
  readonly code: string;
  readonly statusCode = 404;

  constructor(message: string, code = "not_found") {
    super(message);
    this.name = "NotFoundError";
    this.code = code;
  }
}
