/**
 * AI 导入 PDF 解析回归：
 * 1. 数字版 PDF 能提取正文；
 * 2. 扫描版 / 图片型 PDF 能提取内嵌图片交给 vision 模型。
 * 不调用 DeepSeek，不需要 Database 连接。
 */
import { deflateSync } from "node:zlib";
import { prepareSources, type AiImportWarning } from "../src/server/ai/module-import";

function buildPdf(): Buffer {
  const width = 200;
  const height = 200;
  const pixels = Buffer.alloc(width * height * 3);
  for (let index = 0; index < width * height; index += 1) {
    pixels[index * 3] = 230;
    pixels[index * 3 + 1] = 80;
    pixels[index * 3 + 2] = 120;
  }
  const imageData = deflateSync(pixels);
  const content = Buffer.from(
    "BT /F1 12 Tf 72 240 Td (AI PDF TEXT MARKER ALPHA) Tj ET\nq 160 0 0 160 72 72 cm /Im1 Do Q\n",
    "latin1"
  );

  const chunks: Buffer[] = [];
  let offset = 0;
  const push = (value: string | Buffer): void => {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, "latin1");
    chunks.push(buffer);
    offset += buffer.length;
  };
  const offsets: number[] = [];

  push("%PDF-1.4\n");
  offsets[1] = offset;
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  offsets[2] = offset;
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  offsets[3] = offset;
  push(
    "3 0 obj\n" +
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 320] " +
      "/Resources << /Font << /F1 6 0 R >> /XObject << /Im1 4 0 R >> >> " +
      "/Contents 5 0 R >>\nendobj\n"
  );
  offsets[4] = offset;
  push(
    "4 0 obj\n" +
      "<< /Type /XObject /Subtype /Image /Width " + width + " /Height " + height + " " +
      "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length " + imageData.length + " >>\n" +
      "stream\n"
  );
  push(imageData);
  push("\nendstream\nendobj\n");
  offsets[5] = offset;
  push("5 0 obj\n<< /Length " + content.length + " >>\nstream\n");
  push(content);
  push("\nendstream\nendobj\n");
  offsets[6] = offset;
  push("6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");

  const xrefOffset = offset;
  let xref = "xref\n0 7\n0000000000 65535 f \n";
  for (let index = 1; index <= 6; index += 1) {
    xref += String(offsets[index]).padStart(10, "0") + " 00000 n \n";
  }
  xref += "trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF\n";
  push(xref);
  return Buffer.concat(chunks);
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const output = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(output).set(buffer);
  return output;
}

async function main(): Promise<void> {
  const warnings: AiImportWarning[] = [];
  const file = new File([toArrayBuffer(buildPdf())], "ai-pdf-regression.pdf", { type: "application/pdf" });
  const prepared = await prepareSources([file], warnings);
  const pdfSource = prepared.sources.find((source) => source.kind === "PDF");

  if (pdfSource === undefined) throw new Error("PDF 正文没有被提取");
  if (pdfSource.text.includes("AI PDF TEXT MARKER ALPHA") === false) {
    throw new Error("PDF 正文内容缺少测试标记：" + pdfSource.text.slice(0, 200));
  }
  if ((pdfSource.embeddedImages?.length ?? 0) < 1) throw new Error("PDF 内嵌图片没有被提取");
  if (prepared.images.length < 1) throw new Error("PDF 内嵌图片没有进入 vision 素材");

  console.log("PASS AI 导入 PDF 解析：正文 + 内嵌图片");
  console.log("  text=" + pdfSource.text.trim() + " images=" + String(prepared.images.length));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
