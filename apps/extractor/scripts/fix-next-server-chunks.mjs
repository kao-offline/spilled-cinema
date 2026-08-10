import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

const serverDir = path.join(process.cwd(), ".next-build", "server");
const chunksDir = path.join(serverDir, "chunks");

async function main() {
  let chunkFiles = [];

  try {
    chunkFiles = await readdir(chunksDir, { withFileTypes: true });
  } catch {
    process.exit(0);
  }

  await mkdir(serverDir, { recursive: true });

  await Promise.all(
    chunkFiles
      .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
      .map((entry) =>
        cp(
          path.join(chunksDir, entry.name),
          path.join(serverDir, entry.name),
          { force: true },
        ),
      ),
  );
}

main().catch((error) => {
  console.error("Failed to mirror Next server chunks:", error);
  process.exit(1);
});
