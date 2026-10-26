import type { IncomingMessage, ServerResponse } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Dev server only. `vite build` never calls configureServer, and the service
// role is read here from .env.local, so it is not bundled into the site.
function localSignInAs(): Plugin {
  return {
    name: "local-sign-in-as",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0];
        if (path !== "/dev/sign-in-as") {
          next();
          return;
        }
        void handleSignInAs(req, res, server.config.mode, server.config.root).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Could not sign in as that person.";
          sendJson(res, 500, { error: message });
        });
      });
    },
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4000) {
        reject(new Error("Request is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleSignInAs(req: IncomingMessage, res: ServerResponse, mode: string, root: string) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }
  const env = loadEnv(mode, root, "");
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const secret = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) {
    sendJson(res, 500, { error: "Add SUPABASE_SERVICE_ROLE_KEY to .env.local and restart the dev server." });
    return;
  }

  let payload: { name?: string; redirectTo?: string };
  try {
    payload = JSON.parse((await readBody(req)) || "{}") as { name?: string; redirectTo?: string };
  } catch {
    sendJson(res, 400, { error: "Send a name and a localhost address." });
    return;
  }
  const name = String(payload.name ?? "").trim();
  let redirectTo: URL;
  try {
    redirectTo = new URL(String(payload.redirectTo ?? ""));
  } catch {
    sendJson(res, 400, { error: "The return address is not a URL." });
    return;
  }
  if (redirectTo.hostname !== "localhost" && redirectTo.hostname !== "127.0.0.1") {
    sendJson(res, 400, { error: "Local sign-in can only return to this computer." });
    return;
  }
  if (!name) {
    sendJson(res, 400, { error: "Choose a person." });
    return;
  }

  const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id, display_name, auth_user_id")
    .eq("display_name", name);
  if (profileError) {
    sendJson(res, 500, { error: profileError.message });
    return;
  }
  if (!profiles || profiles.length !== 1) {
    sendJson(res, 404, { error: profiles?.length ? `More than one profile is named ${name}.` : `No profile is named ${name}.` });
    return;
  }
  const authUserId = String(profiles[0].auth_user_id ?? "");
  if (!authUserId) {
    sendJson(res, 400, { error: `${name} has not signed in with Google yet, so there is no account to open.` });
    return;
  }
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(authUserId);
  if (userError) {
    sendJson(res, 500, { error: userError.message });
    return;
  }
  const email = userData.user?.email ?? "";
  if (!email) {
    sendJson(res, 400, { error: `${name}'s Google account has no email address.` });
    return;
  }
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: redirectTo.origin },
  });
  if (linkError) {
    sendJson(res, 500, { error: linkError.message });
    return;
  }
  const actionLink = link.properties?.action_link;
  if (!actionLink) {
    sendJson(res, 500, { error: "Supabase did not return a sign-in link." });
    return;
  }
  sendJson(res, 200, { url: actionLink });
}

export default defineConfig({
  plugins: [react(), localSignInAs()],
});
