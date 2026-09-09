import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const SOURCE =
  "C:/Users/hawa3/.cursor/projects/c-Users-hawa3-cursor-projects-rwa/assets/c__Users_hawa3_AppData_Roaming_Cursor_User_workspaceStorage_c450504259b379848a95e773dcb796d5_images___20__Round_For_Black_Background-8ab12c58-aea0-4be8-b175-a8d1bd96f774.png";

async function resizeIcon(size) {
  return sharp(SOURCE)
    .resize(size, size, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const outputs = [
  { out: "public/brand/app-icon-home.png", size: 1024, fn: resizeIcon },
  { out: "src/app/apple-icon.png", size: 180, fn: resizeIcon },
  { out: "src/app/icon.png", size: 32, fn: resizeIcon },
  { out: "public/brand/apple-icon.png", size: 180, fn: resizeIcon },
  { out: "public/brand/pwa-icon-192.png", size: 192, fn: resizeIcon },
  { out: "public/brand/pwa-icon-512.png", size: 512, fn: resizeIcon },
  // Maskable: icon art sits inside the rounded square (~80% safe zone already)
  { out: "public/brand/pwa-icon-maskable.png", size: 512, fn: resizeIcon },
  { out: "public/brand/favicon-16.png", size: 16, fn: resizeIcon },
  { out: "public/brand/favicon-32.png", size: 32, fn: resizeIcon },
  { out: "public/brand/favicon-64.png", size: 64, fn: resizeIcon },
  { out: "public/brand/favicon-128.png", size: 128, fn: resizeIcon },
];

for (const { out, size, fn } of outputs) {
  const dest = path.join(ROOT, out);
  await mkdir(path.dirname(dest), { recursive: true });
  const buf = await fn(size);
  await sharp(buf).toFile(dest);
  const meta = await sharp(dest).metadata();
  console.log(`${out}: ${meta.width}x${meta.height} ${meta.format}`);
}
