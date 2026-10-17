export class KmsError extends Error {
  public readonly code?: string;
  public override readonly cause?: unknown;

  constructor(message: string, options?: { code?: string; cause?: unknown }) {
    super(message);
    this.name = 'KmsError';
    if (options?.code !== undefined) {
      this.code = options.code;
    }
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
