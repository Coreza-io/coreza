import { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";

interface JwtVerifyOptions {
  optional?: boolean;
}

interface JwtUser {
  id: string;
  role?: string;
  email?: string;
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

const jwks =
  supabaseUrl && supabaseAnonKey
    ? createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`), {
        headers: {
          apikey: supabaseAnonKey,
        },
        cacheMaxAge: 60 * 60 * 1000, // 1 hour cache
      })
    : null;

async function verifyJwt(token: string): Promise<JwtUser> {
  if (!jwks) {
    throw new Error("JWKS not initialized. Missing SUPABASE_URL or SUPABASE_ANON_KEY.");
  }

  const { payload } = await jwtVerify(token, jwks);
  const id = (payload.sub || payload.user_id) as string | undefined;

  if (!id) {
    throw new Error("JWT payload missing subject");
  }

  return {
    id,
    role: payload.role as string | undefined,
    email: payload.email as string | undefined,
  };
}

function jwtVerifyMiddleware(options: JwtVerifyOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization || "";
      const token = authHeader.startsWith("Bearer ")
        ? authHeader.substring("Bearer ".length)
        : null;

      if (!token) {
        if (options.optional) {
          return next();
        }
        return res.status(401).json({ error: "Missing or invalid authorization header" });
      }

      const user = await verifyJwt(token);
      req.user = user;
      req.userId = user.id;

      return next();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid or expired token";

      if (options.optional && !req.user) {
        return next();
      }

      return res.status(401).json({ error: message });
    }
  };
}

function roleCheckMiddleware(role: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (req.user.role !== role) {
      return res.status(403).json({ error: "Forbidden" });
    }

    return next();
  };
}

export const requireAuth = jwtVerifyMiddleware();
export const optionalAuth = jwtVerifyMiddleware({ optional: true });
export const requireRole = (role: string) => roleCheckMiddleware(role);
export default jwtVerifyMiddleware;
