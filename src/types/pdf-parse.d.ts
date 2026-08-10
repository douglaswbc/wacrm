// `pdf-parse` ships no type declarations. We use a small subset of its API:
// parse a PDF Buffer and read the extracted text via `result.text`. See
// https://github.com/mozilla/pdf.js/tree/master (pdf-parse is a wrapper around pdf.js)
declare module "pdf-parse" {
  interface PdfParseResult {
    /** Number of pages in the PDF. */
    numpages: number;
    /** Extracted text, one page concatenated per entry. */
    text?: string;
    /** Raw page texts (one entry per page). */
    pages?: string[];
  }

  interface PdfParseOptions {
    /** Page to render first (1-based). */
    pagerender?: (page: unknown) => Promise<Uint8Array>;
    /** Max length of the returned text in characters. */
    max?: number;
    /** Version of pdf.js to use internally. */
    version?: string;
  }

  function pdfParse(data: Buffer | Uint8Array, options?: PdfParseOptions): Promise<PdfParseResult>;

  export default pdfParse;
}
