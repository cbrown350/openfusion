// Reads a user-attached file into a text string for fusion `context`.
//
// PDFs → pdfjs-dist text extraction (dynamic import so the ~300KB parser is code-split
//   out of the main bundle; only loaded when a PDF is actually attached).
// Everything else → `file.text()` (UTF-8). Unknown/binary files degrade gracefully:
//   the text is likely garbage but the user can see it and remove the chip.
//
// The pdfjs worker is wired via Vite's `new URL(..., import.meta.url)` pattern, which
// emits the worker as a separate chunk. pdfjs v6 requires the worker set before getDocument.
//
// Failure (e.g. corrupt/encrypted PDF) throws — ComposerAttachments catches it and marks
// the chip with an error rather than aborting the whole attach.

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

/** Read a file's text content. PDFs go through pdfjs; everything else is read as UTF-8. */
export async function fileToText(file: File): Promise<string> {
  if (isPdf(file)) return pdfToText(file);
  return file.text();
}

async function pdfToText(file: File): Promise<string> {
  // Dynamic import: keeps pdfjs (~300KB) out of the main bundle.
  const pdfjs = await import("pdfjs-dist");
  // Worker: bundled locally (no CDN dependency). Vite statically recognizes this
  // `new URL(..., import.meta.url)` form and emits the worker as a separate chunk.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((it: any) => (typeof it.str === "string" ? it.str : ""))
      .join(" ");
    parts.push(text);
  }
  return parts.join("\n\n");
}
