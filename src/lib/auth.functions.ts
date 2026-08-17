import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequest } from "@tanstack/react-start/server";

export const registerMerchant = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(6),
        businessName: z.string().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { signUpUser } = await import("./auth.server");
    return signUpUser({
      email: data.email,
      password: data.password,
      businessName: data.businessName,
    });
  });

export const registerAdmin = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(6),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { signUpUser } = await import("./auth.server");
    return signUpUser({
      email: data.email,
      password: data.password,
    });
  });

export const signInUserFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(1),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { signInUser } = await import("./auth.server");
    return signInUser({
      email: data.email,
      password: data.password,
    });
  });

export const getCurrentUserFn = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const authHeader = request?.headers?.get("authorization");
  const token = authHeader?.replace("Bearer ", "") || "";
  const { verifySession } = await import("./auth.server");
  return verifySession(token);
});
