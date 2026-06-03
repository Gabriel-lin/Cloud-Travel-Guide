import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { app, net, protocol } from "electron";
import { getStaticExportDir } from "./paths";

export const APP_PROTOCOL = "app";

/** Must run before app.ready so production can load `app://` URLs. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

export function installAppProtocolHandler(): void {
  const root = path.resolve(getStaticExportDir());

  protocol.handle(APP_PROTOCOL, async (request) => {
    const { pathname } = new URL(request.url);
    let relative = decodeURIComponent(pathname);
    if (relative.startsWith("/")) relative = relative.slice(1);
    if (!relative || relative === ".") relative = "index.html";

    const filePath = path.resolve(root, relative);
    const pathFromRoot = path.relative(root, filePath);
    if (pathFromRoot.startsWith("..") || path.isAbsolute(pathFromRoot)) {
      return new Response("Forbidden", { status: 403 });
    }

    if (!fs.existsSync(filePath)) {
      return new Response("Not Found", { status: 404 });
    }

    return net.fetch(pathToFileURL(filePath).href);
  });
}

/** Entry URL for the Next static export (avoids broken `file://` + `/_next` paths on Windows). */
export function getProductionLoadUrl(): string {
  return `${APP_PROTOCOL}://./index.html`;
}
