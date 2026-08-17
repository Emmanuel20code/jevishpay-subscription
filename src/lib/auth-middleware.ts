import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const request = getRequest();

  if (!request?.headers) {
    throw new Error("Unauthorized: No request headers available");
  }

  const authHeader = request.headers.get("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Unauthorized: No authorization token provided");
  }

  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) {
    throw new Error("Unauthorized: No token provided");
  }

  const { verifySession } = await import("@/lib/auth.server");
  const session = await verifySession(token);
  if (!session) {
    throw new Error("Unauthorized: Invalid or expired token");
  }

  return next({
    context: {
      userId: session.userId,
      email: session.email,
      isAdmin: session.isAdmin,
    },
  });
});
