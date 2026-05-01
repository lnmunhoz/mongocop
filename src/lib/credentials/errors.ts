export type CredentialStoreErrorCode = "unsupported_store" | "backend_error";

export class CredentialStoreError extends Error {
  constructor(
    public readonly code: CredentialStoreErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message);
    this.name = "CredentialStoreError";
    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}
