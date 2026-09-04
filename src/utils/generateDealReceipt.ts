import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib';
import { COMPANY_INFO } from './payslip';
import { formatRM } from './format';

export interface DealReceiptLine {
  label: string;
  amount: number;
}

export interface DealReceiptInput {
  customerName: string;
  carLabel: string;   // e.g. "2019 Hyundai Santa Fe"
  carPlate?: string;
  salesmanName: string;
  sellingPrice: number;
  plusLines: DealReceiptLine[];   // insurance, bank product, add-on items
  subtotal: number;
  minusLines: DealReceiptLine[];  // discount, deposit/booking fee, loan amount
  resultLabel: string;            // "Collect from Customer" | "Refund to Customer" | "Balance"
  resultAmount: number;
  generatedAt: Date;
}

const GOLD = rgb(0.722, 0.525, 0.043);   // #B8860B, matches payslip branding
const INK = rgb(0.11, 0.11, 0.13);
const GRAY = rgb(0.42, 0.42, 0.45);
const HAIRLINE = rgb(0.87, 0.83, 0.71);
const GREEN = rgb(0.02, 0.45, 0.29);
const RED = rgb(0.7, 0.13, 0.13);

// Builds a Collection Balance receipt as PDF bytes, ready to upload — no DOM/canvas
// involved, since this has to run headlessly (no print dialog) to auto-save.
export async function buildDealReceiptPdf(input: DealReceiptInput): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4 portrait, points
  const { width } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 50;
  const right = width - margin;
  let y = 792;

  const rightText = (text: string, yPos: number, size: number, f: PDFFont, color = INK) => {
    page.drawText(text, { x: right - f.widthOfTextAtSize(text, size), y: yPos, size, font: f, color });
  };
  const hr = (yPos: number, color = HAIRLINE, lineWidth = 1) => {
    page.drawLine({ start: { x: margin, y: yPos }, end: { x: right, y: yPos }, thickness: lineWidth, color });
  };
  const row = (label: string, amount: number, yPos: number, opts?: { bold?: boolean; color?: typeof INK; size?: number }) => {
    const size = opts?.size ?? 11;
    const f = opts?.bold ? bold : font;
    page.drawText(label, { x: margin, y: yPos, size, font: f, color: opts?.color ?? INK });
    rightText(formatRM(amount), yPos, size, f, opts?.color ?? INK);
  };

  // Header — logo (falls back to plain text if the asset can't be fetched) + title.
  try {
    const logoBytes = await fetch('/logo.png').then((r) => r.arrayBuffer());
    const logoImg = await pdfDoc.embedPng(logoBytes);
    const logoW = 100;
    const logoH = (logoImg.height / logoImg.width) * logoW;
    page.drawImage(logoImg, { x: margin, y: y - logoH + 24, width: logoW, height: logoH });
  } catch {
    page.drawText(COMPANY_INFO.name, { x: margin, y, size: 20, font: bold, color: GOLD });
  }
  page.drawText('COLLECTION RECEIPT', { x: margin, y: y - 40, size: 16, font: bold, color: INK });
  rightText(COMPANY_INFO.name, y, 11, bold, GOLD);
  rightText(COMPANY_INFO.tagline, y - 14, 8, font, GRAY);
  rightText(COMPANY_INFO.address, y - 26, 8, font, GRAY);
  rightText(COMPANY_INFO.phone, y - 38, 8, font, GRAY);

  y -= 66;
  hr(y, GOLD, 1.5);
  y -= 26;

  // Deal context — customer, car, salesman, generated date.
  const infoLabel = (label: string, value: string, yPos: number) => {
    page.drawText(label, { x: margin, y: yPos, size: 8, font, color: GRAY });
    page.drawText(value, { x: margin, y: yPos - 13, size: 11, font: bold, color: INK });
  };
  infoLabel('CUSTOMER', input.customerName, y);
  infoLabel('SALESMAN', input.salesmanName, y - 34);
  const carValue = input.carPlate ? `${input.carLabel}  ·  ${input.carPlate}` : input.carLabel;
  page.drawText('VEHICLE', { x: 320, y, size: 8, font, color: GRAY });
  page.drawText(carValue, { x: 320, y: y - 13, size: 11, font: bold, color: INK });
  page.drawText('DATE', { x: 320, y: y - 34, size: 8, font, color: GRAY });
  page.drawText(
    input.generatedAt.toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' }),
    { x: 320, y: y - 47, size: 11, font: bold, color: INK }
  );

  y -= 74;
  hr(y);
  y -= 24;

  // Breakdown — pluses grouped first, then minuses, mirroring the in-app panel.
  row('Selling Price', input.sellingPrice, y, { bold: true, size: 12 });
  y -= 20;
  for (const l of input.plusLines) {
    row(`+ ${l.label}`, l.amount, y, { color: GREEN });
    y -= 18;
  }
  y -= 4;
  hr(y);
  y -= 20;
  row('Subtotal', input.subtotal, y, { bold: true });
  y -= 26;

  for (const l of input.minusLines) {
    // Plain hyphen, not the "−" used in the UI — WinAnsi (the standard PDF font
    // encoding) has no glyph for U+2212 and throws when asked to draw it.
    row(`- ${l.label}`, l.amount, y, { color: RED });
    y -= 18;
  }

  y -= 10;
  hr(y, GOLD, 1.5);
  y -= 28;
  page.drawText(input.resultLabel, { x: margin, y, size: 14, font: bold, color: INK });
  rightText(formatRM(input.resultAmount), y, 16, bold, GOLD);

  // Footer
  const footerY = 70;
  hr(footerY + 24);
  page.drawText(
    `Generated ${input.generatedAt.toLocaleString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${COMPANY_INFO.website}`,
    { x: margin, y: footerY, size: 8, font, color: GRAY }
  );

  return pdfDoc.save();
}

// Uploads generated PDF bytes to Supabase Storage and returns its public URL.
export async function uploadDealReceipt(
  bytes: Uint8Array,
  carId: string,
  storage: { upload: (path: string, data: Uint8Array, opts: { contentType: string }) => Promise<{ error: { message: string } | null }>; getPublicUrl: (path: string) => { data: { publicUrl: string } } }
): Promise<string> {
  const path = `deal-receipts/${carId}-${Date.now()}.pdf`;
  const { error } = await storage.upload(path, bytes, { contentType: 'application/pdf' });
  if (error) throw new Error(error.message);
  return storage.getPublicUrl(path).data.publicUrl;
}
