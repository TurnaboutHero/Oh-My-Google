export interface OmgResponse {
  ok: boolean;
  command: string;
  data?: Record<string, unknown>;
  error?: { code: string; message: string; recoverable: boolean; hint?: string };
  next?: string[];
}
