export class HttpError extends Error {
  constructor(public statusCode: number, message: string, public details?: unknown) {
    super(message);
    this.name = "HttpError";
  }
}

export function mensagemErro(error: unknown): string {
  return error instanceof Error ? error.message : "Erro inesperado.";
}
