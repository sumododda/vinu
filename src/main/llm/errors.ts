// Tagged error shape used across the LLM clients so the pipeline (and any
// retry/backoff logic upstream) can distinguish transient from permanent
// failures without depending on a specific SDK's class hierarchy.

import * as AnthropicSDK from '@anthropic-ai/sdk';
import * as OpenAISDK from 'openai';

export type LLMErrorCode =
  | 'timeout'
  | 'rate_limit'
  | 'auth'
  | 'network'
  | 'aborted'
  | 'bad_request'
  | 'server'
  | 'unknown';

export class LLMError extends Error {
  readonly code: LLMErrorCode;
  readonly status?: number;
  readonly cause?: unknown;

  constructor(
    code: LLMErrorCode,
    message: string,
    opts: { status?: number; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'LLMError';
    this.code = code;
    this.status = opts.status;
    this.cause = opts.cause;
  }
}

/**
 * Map an Anthropic SDK error to an {@link LLMError}. Non-SDK errors are
 * classified best-effort (AbortError -> aborted, everything else -> unknown).
 */
export function mapAnthropicError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;

  if (err instanceof AnthropicSDK.APIUserAbortError) {
    return new LLMError('aborted', err.message || 'request aborted', { cause: err });
  }
  if (err instanceof AnthropicSDK.APIConnectionTimeoutError) {
    return new LLMError('timeout', err.message || 'request timed out', { cause: err });
  }
  if (err instanceof AnthropicSDK.APIConnectionError) {
    return new LLMError('network', err.message || 'network error', { cause: err });
  }
  if (err instanceof AnthropicSDK.RateLimitError) {
    return new LLMError('rate_limit', err.message, { status: err.status, cause: err });
  }
  if (err instanceof AnthropicSDK.AuthenticationError) {
    return new LLMError('auth', err.message, { status: err.status, cause: err });
  }
  if (err instanceof AnthropicSDK.PermissionDeniedError) {
    return new LLMError('auth', err.message, { status: err.status, cause: err });
  }
  if (err instanceof AnthropicSDK.BadRequestError) {
    return new LLMError('bad_request', err.message, { status: err.status, cause: err });
  }
  if (err instanceof AnthropicSDK.InternalServerError) {
    return new LLMError('server', err.message, { status: err.status, cause: err });
  }
  if (err instanceof AnthropicSDK.APIError) {
    return new LLMError('unknown', err.message, { status: err.status, cause: err });
  }
  return toGenericLLMError(err);
}

/**
 * Map an OpenAI SDK error to an {@link LLMError}. Shared by the OpenRouter and
 * custom OpenAI-compatible clients.
 */
export function mapOpenAIError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;

  if (err instanceof OpenAISDK.APIUserAbortError) {
    return new LLMError('aborted', err.message || 'request aborted', { cause: err });
  }
  if (err instanceof OpenAISDK.APIConnectionTimeoutError) {
    return new LLMError('timeout', err.message || 'request timed out', { cause: err });
  }
  if (err instanceof OpenAISDK.APIConnectionError) {
    return new LLMError('network', err.message || 'network error', { cause: err });
  }
  if (err instanceof OpenAISDK.RateLimitError) {
    return new LLMError('rate_limit', err.message, { status: err.status, cause: err });
  }
  if (err instanceof OpenAISDK.AuthenticationError) {
    return new LLMError('auth', err.message, { status: err.status, cause: err });
  }
  if (err instanceof OpenAISDK.PermissionDeniedError) {
    return new LLMError('auth', err.message, { status: err.status, cause: err });
  }
  if (err instanceof OpenAISDK.BadRequestError) {
    return new LLMError('bad_request', err.message, { status: err.status, cause: err });
  }
  if (err instanceof OpenAISDK.InternalServerError) {
    return new LLMError('server', err.message, { status: err.status, cause: err });
  }
  if (err instanceof OpenAISDK.APIError) {
    return new LLMError('unknown', err.message, { status: err.status, cause: err });
  }
  return toGenericLLMError(err);
}

function toGenericLLMError(err: unknown): LLMError {
  // Handle native AbortError from an AbortController without a wrapping SDK.
  if (err instanceof Error) {
    if (err.name === 'AbortError') {
      return new LLMError('aborted', err.message || 'request aborted', { cause: err });
    }
    return new LLMError('unknown', err.message, { cause: err });
  }
  return new LLMError('unknown', String(err), { cause: err });
}
