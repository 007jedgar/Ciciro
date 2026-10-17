// Deletes installed dependencies so the next install starts clean: every
// node_modules in the repo (root and each app/tool package) plus the iOS
// Pods and Podfile.lock. Only deletes; run `npm install` afterwards.
import { readdirSync, existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

const targets = [join(root, "node_modules")];
for (const parent of ["apps", "tools"]) {
  const dir = join(root, parent);
  if (!existsSync(dir)) continue;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) targets.push(join(dir, entry.name, "node_modules"));
  }
}
targets.push(
  join(root, "apps/mobile/ios/Pods"),
  join(root, "apps/mobile/ios/Podfile.lock"),
);

for (const target of targets) {
  if (!existsSync(target)) continue;
  await rm(target, { recursive: true, force: true });
  console.log(`removed ${relative(root, target)}`);
}
console.log("done. Run `npm install` to reinstall.");
