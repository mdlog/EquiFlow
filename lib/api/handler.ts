import { NextResponse } from "next/server";
import type { Address } from "viem";

/// Shared utilities for API route handlers.
///
/// Why opt-in (not a wrapper that all routes must use): existing routes have
/// slightly different response shapes that the frontend may depend on. Migrate
/// route-by-route only after confirming the new shape is safe at the call site.
///
/// Standard error shape across handlers that adopt this module:
///     { ok: false, error: "<code>", message?: "<human readable>" }
/// Success shape is route-specific (no enforced { ok: true } prefix), since
/// some routes return raw data and others return `{ enabled, ... }`.

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

/// Wrap a route handler so any thrown ApiError converts to a structured JSON
/// response, and any other thrown error becomes a 500 with a stable shape.
/// Plain string returns from the handler are passed through untouched.
export function withErrorHandler<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response> | Response,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json(
          { ok: false, error: err.code, message: err.message },
          { status: err.status },
        );
      }
      // Never expose raw error messages to the client — they can contain RPC
      // URLs with API keys, internal addresses, calldata, viem stack traces.
      // Log on the server, return a stable opaque code.
      console.error("[api] unhandled:", err);
      return NextResponse.json(
        { ok: false, error: "internal_error" },
        { status: 500 },
      );
    }
  };
}

/// Parse JSON body or throw a 400 ApiError. Use inside withErrorHandler.
export async function readJsonBody<T = unknown>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, "invalid_json", "Body is not valid JSON");
  }
}

/// Validate that a value looks like a 0x-prefixed 20-byte address.
/// Throws 400 with `invalid_<field>` if not. Use inside withErrorHandler.
export function requireAddress(
  value: string | null | undefined,
  field: string,
): Address {
  if (!value || !ADDR_RE.test(value)) {
    throw new ApiError(400, `invalid_${field}`, `Missing or malformed ${field}`);
  }
  return value as Address;
}

/// Read a query param or throw 400. Strips whitespace; empty string counts
/// as missing.
export function requireQueryParam(req: Request, name: string): string {
  const v = new URL(req.url).searchParams.get(name)?.trim();
  if (!v) throw new ApiError(400, `missing_${name}`, `?${name} is required`);
  return v;
}
