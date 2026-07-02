export class CredentialStoreError extends Error {
    code;
    constructor(code, message, options) {
        super(message);
        this.code = code;
        this.name = "CredentialStoreError";
        if (options?.cause) {
            this.cause = options.cause;
        }
    }
}
