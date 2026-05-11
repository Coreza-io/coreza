import { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";

interface JwtVerifyOptions {
  optional?: boolean; // if true: no auth header is allowed, but invalid token is NOT allowed
}

export interface JwtUser {
  id: string;
  role?: string;
  email?: string;
}

// ---- Supabase config validation ----
const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    "[jwtAuth] SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or legacy SUPABASE_ANON_KEY) must be set in environment",
  );
}

// Supabase Auth issuer & audience
const SUPABASE_ISSUER = `${supabaseUrl}/auth/v1`;
const SUPABASE_AUDIENCE = process.env.SUPABASE_JWT_AUD || "authenticated";

// ---- JWKS client (remote key set) ----
const jwks = createRemoteJWKSet(
  new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`),
  {
    headers: {
      apikey: supabasePublishableKey,
    },
    cacheMaxAge: 60 * 60 * 1000, // 1 hour
  },
);

// ---- Core verification helper ----
async function verifyJwt(token: string): Promise<JwtUser> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: SUPABASE_ISSUER,
    audience: SUPABASE_AUDIENCE,
  });

  const id =
    (payload.sub as string | undefined) ||
    ((payload as JWTPayload & { user_id?: string }).user_id as
      | string
      | undefined);

  if (!id) {
    throw new Error("JWT payload missing subject (sub/user_id)");
  }

  return {
    id,
    role: (payload as any).role as string | undefined,
    email: (payload as any).email as string | undefined,
  };
}

// ---- Middleware factory ----
function jwtVerifyMiddleware(options: JwtVerifyOptions = {}) {
  const { optional = false } = options;
  const BEARER_PREFIX = "Bearer ";

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization ?? "";

      // No token provided
      if (!authHeader.startsWith(BEARER_PREFIX)) {
        if (optional) {
          return next(); // public route, user just not attached
        }
        return res
          .status(401)
          .json({ error: "Missing or invalid Authorization header" });
      }

      const token = authHeader.substring(BEARER_PREFIX.length).trim();
      if (!token) {
        return res
          .status(401)
          .json({ error: "Missing or invalid Authorization header" });
      }

      // Verify token with Supabase JWKS
      const user = await verifyJwt(token);

      // Attach to request (assumes you've extended Express.Request typing)
      req.user = user;
      (req as any).userId = user.id;

      return next();
    } catch (error: any) {
      // Optional route behavior:
      // - If no token => we already handled above
      // - If token present but invalid => always 401 (even for optional routes)
      //   This avoids "optional but spoofed" situations.
      const message =
        error && error.message
          ? String(error.message)
          : "Invalid or expired token";

      // jose error for expiry is usually named "JWTExpired"
      const isExpired =
        error?.name === "JWTExpired" ||
        message.toLowerCase().includes("expired");

      const status = isExpired ? 401 : 401;

      if (process.env.NODE_ENV !== "production") {
        console.error("[jwtAuth] JWT verification failed:", error);
      }

      return res.status(status).json({ error: "Unauthorized" });
    }
  };
}

// ---- Optional: attach user context helper (if you use this pattern) ----
export function attachUserContext(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Force everything to use the authenticated user
  if (req.params.userId && req.params.userId !== userId) {
    return res.status(403).json({ error: "User mismatch" });
  }

  req.params.userId = userId;
  (req.query as any).user_id = userId;
  (req.body as any).user_id = userId;
  (req as any).userId = userId;

  return next();
}

// ---- Exports ----
export const requireAuth = jwtVerifyMiddleware();
export const optionalAuth = jwtVerifyMiddleware({ optional: true });
export default jwtVerifyMiddleware;
