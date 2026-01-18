export function getActorEmail(request: Request): string {
  const accessEmail =
    request.headers.get("Cf-Access-Authenticated-User-Email") ??
    request.headers.get("cf-access-authenticated-user-email") ??
    request.headers.get("X-Auth-Request-Email") ??
    request.headers.get("x-auth-request-email");
  if (accessEmail) {
    return accessEmail;
  }

  const debugEmail =
    request.headers.get("X-Debug-User-Email") ?? request.headers.get("x-debug-user-email");
  if (debugEmail) {
    return debugEmail;
  }

  return "unknown@local";
}
