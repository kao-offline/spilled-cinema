import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

/** Precache the shell and its exact built chunks without a runtime dependency. */
export function pwaShellPlugin(): Plugin {
  return {
    name: "spilled-pwa-shell",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const template = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
      const files = Object.keys(bundle).filter((file) => /\.(?:html|js|css|woff2?)$/.test(file)).sort();
      const assets = [...files.map((file) => `/${file}`), "/manifest.webmanifest", "/Spilled.svg", "/rating-icon.png", "/icons/app-icon-dark-rounded-192.png", "/icons/app-icon-dark-rounded-512.png", "/icons/app-icon-light-rounded-192.png", "/icons/app-icon-light-rounded-512.png"];
      const hash = createHash("sha256").update(template);
      for (const file of files) {
        const output = bundle[file];
        hash.update(output.type === "chunk" ? output.code : output.source);
      }
      const version = hash.digest("hex").slice(0, 16);
      this.emitFile({ type: "asset", fileName: "sw.js", source: template.replace('"__SPILLED_PRECACHE__"', JSON.stringify({ version, assets })) });
    },
  };
}
