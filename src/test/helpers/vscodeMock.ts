import Module from "node:module";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

let installed = false;

export function installVscodeMock(): void {
  if (installed) return;
  installed = true;

  const mockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vscode-mock-")), "index.js");
  fs.writeFileSync(
    mockPath,
    `"use strict";
  module.exports = {
    ExtensionContext: class {},
    extensions: { getExtension: () => undefined },
  };
  `,
    "utf-8",
  );

  type ResolveFilename = (request: string, parent: unknown, ...args: unknown[]) => string;
  const moduleResolver = Module as unknown as { _resolveFilename: ResolveFilename };
  const originalResolveFilename = moduleResolver._resolveFilename;
  moduleResolver._resolveFilename = function (request: string, parent: unknown, ...args: unknown[]): string {
    if (request === "vscode") {
      return mockPath;
    }
    return originalResolveFilename.call(this, request, parent, ...args);
  };
}
