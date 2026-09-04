import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib';
import { COMPANY_INFO } from './payslip';
import { formatRM } from './format';

export interface DepositReceiptInput {
  customerName: string;
  carLabel?: string;
  carPlate?: string;
  salesmanName: string;
  amount: number;
  generatedAt: Date;
}

const GOLD = rgb(0.722, 0.525, 0.043);
const INK = rgb(0.11, 0.11, 0.13);
const GRAY = rgb(0.42, 0.42, 0.45);
const HAIRLINE = rgb(0.87, 0.83, 0.71);

// Short deposit/booking-fee receipt — auto-generated the moment a salesman
// submits a booking fee with proof of payment attached. One page, no
// expense breakdown, just what the customer needs as proof they paid.
export async function buildDepositReceiptPdf(input: DepositReceiptInput): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 420]);
  const { width } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 50;
  const right = width - margin;
  let y = 372;

  const rightText = (text: string, yPos: number, size: number, f: PDFFont, color = INK) => {
    page.drawText(text, { x: right - f.widthOfTextAtSize(text, size), y: yPos, size, font: f, color });
  };
  const hr = (yPos: number, color = HAIRLINE, lineWidth = 1) => {
    page.drawLine({ start: { x: margin, y: yPos }, end: { x: right, y: yPos }, thickness: lineWidth, color });
  };

  try {
    const logoBytes = await fetch('/logo.png').then((r) => r.arrayBuffer());
    const logoImg = await pdfDoc.embedPng(logoBytes);
    const logoW = 90;
    const logoH = (logoImg.height / logoImg.width) * logoW;
    page.drawImage(logoImg, { x: margin, y: y - logoH + 20, width: logoW, height: logoH });
  } catch {
    page.drawText(COMPANY_INFO.name, { x: margin, y, size: 18, font: bold, color: GOLD });
  }
  page.drawText('DEPOSIT RECEIPT', { x: margin, y: y - 36, size: 14, font: bold, color: INK });
  rightText(COMPANY_INFO.name, y, 10, bold, GOLD);
  rightText(COMPANY_INFO.phone, y - 13, 8, font, GRAY);

  y -= 60;
  hr(y, GOLD, 1.5);
  y -= 26;

  const infoLabel = (label: string, value: string, x: number, yPos: number) => {
    page.drawText(label, { x, y: yPos, size: 8, font, color: GRAY });
    page.drawText(value, { x, y: yPos - 13, size: 11, font: bold, color: INK });
  };
  infoLabel('CUSTOMER', input.customerName, margin, y);
  infoLabel('SALESMAN', input.salesmanName, 320, y);
  infoLabel(
    'DATE',
    input.generatedAt.toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' }),
    margin,
    y - 34,
  );
  if (input.carLabel) {
    const carValue = input.carPlate ? `${input.carLabel}  ·  ${input.carPlate}` : input.carLabel;
    infoLabel('VEHICLE', carValue, 320, y - 34);
  }

  y -= 70;
  hr(y);
  y -= 34;

  page.drawText('DEPOSIT RECEIVED', { x: margin, y, size: 12, font: bold, color: GRAY });
  y -= 30;
  rightText(formatRM(input.amount), y, 30, bold, GOLD);

  y -= 20;
  page.drawText('This deposit will be credited against the final selling price.', { x: margin, y, size: 9, font, color: GRAY });

  const footerY = 40;
  hr(footerY + 20);
  page.drawText(
    `Generated ${input.generatedAt.toLocaleString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${COMPANY_INFO.website}`,
    { x: margin, y: footerY, size: 8, font, color: GRAY },
  );

  return pdfDoc.save();
}

// Uploads generated PDF bytes to Supabase Storage and returns its public URL.
export async function uploadDepositReceipt(
  bytes: Uint8Array,
  customerId: string,
  storage: { upload: (path: string, data: Uint8Array, opts: { contentType: string }) => Promise<{ error: { message: string } | null }>; getPublicUrl: (path: string) => { data: { publicUrl: string } } }
): Promise<string> {
  const path = `deposit-receipts/${customerId}-${Date.now()}.pdf`;
  const { error } = await storage.upload(path, bytes, { contentType: 'application/pdf' });
  if (error) throw new Error(error.message);
  return storage.getPublicUrl(path).data.publicUrl;
}
