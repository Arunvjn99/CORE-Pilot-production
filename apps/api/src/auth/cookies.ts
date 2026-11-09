import { parseCookie, stringifySetCookie } from 'cookie';
import type { Request, Response } from 'express';

/** __Host- prefix: Secure, Path=/, no Domain → cannot be set or overridden by sibling hosts. */
export const SESSION_COOKIE = '__Host-core_sid';
export const LOGIN_BINDING_COOKIE = '__Host-core_login';

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  return header ? parseCookie(header)[name] : undefined;
}

function write(res: Response, name: string, value: string, maxAge: number): void {
  res.append(
    'Set-Cookie',
    stringifySetCookie({
      name,
      value,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge,
    }),
  );
}

export function setCookie(res: Response, name: string, value: string, maxAgeSeconds: number): void {
  write(res, name, value, maxAgeSeconds);
}

export function clearCookie(res: Response, name: string): void {
  write(res, name, '', 0);
}
