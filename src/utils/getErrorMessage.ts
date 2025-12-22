export function getErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    if ("message" in err) {
      const msg = (err as any).message;
      return typeof msg === "string" ? msg : JSON.stringify(msg);
    }
  }
  return "Action failed";
}
