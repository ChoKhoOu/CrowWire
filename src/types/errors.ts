export class TransientError extends Error {
  readonly retryable = true as const;
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'TransientError';
  }
}

export class PermanentError extends Error {
  readonly retryable = false as const;
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'PermanentError';
  }
}

export class FatalError extends Error {
  readonly fatal = true as const;
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'FatalError';
  }
}
