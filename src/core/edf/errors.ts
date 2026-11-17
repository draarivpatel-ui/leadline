/** Every way a file can fail to open. The code is stable; the message is for people. */
export type EdfErrorCode =
  | 'TOO_SHORT'
  | 'BAD_VERSION'
  | 'BAD_FIELD'
  | 'HEADER_SIZE_MISMATCH'
  | 'NO_SIGNALS'
  | 'BAD_SIGNAL'
  | 'TRUNCATED'
  | 'BAD_RECORD_DURATION'
  | 'NO_TIMEKEEPING'
  | 'BAD_TAL';

export class EdfError extends Error {
  readonly code: EdfErrorCode;
  constructor(code: EdfErrorCode, message: string) {
    super(message);
    this.name = 'EdfError';
    this.code = code;
  }
}
