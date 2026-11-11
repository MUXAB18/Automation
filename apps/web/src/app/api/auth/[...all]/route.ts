import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

// Resolved per request so the environment is read at runtime, never at build time.
export const GET = (request: Request) => toNextJsHandler(getAuth()).GET(request);
export const POST = (request: Request) => toNextJsHandler(getAuth()).POST(request);
