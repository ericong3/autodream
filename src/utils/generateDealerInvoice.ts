import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib';
import { COMPANY_INFO } from './payslip';
import { formatRM } from './format';

// Outgoing consignment — the reverse of generateConsignmentSettlement.ts.
// There we owe the consignor money for a car they handed us; here a dealer
// owes US money for a car we handed them that they've now sold. This is a
// plain bill, not an itemized settlement — there's nothing to break down,
// just the one agreed fixed amount.
export interface DealerInvoiceInput {
  dealerName: string;
  dealerPhone?: string;
  carLabel: string;
  carPlate?: string;
  amount: number;
  soldDate: Date;
  generatedAt: Date;
}

const GOLD = rgb(0.722, 0.525, 0.043);
const GOLD_SOFT = rgb(0.816, 0.69, 0.4);
const INK = rgb(0.098, 0.094, 0.11);
const DARK = rgb(0.106, 0.102, 0.094); // the near-black summary/payment bars
const GRAY = rgb(0.42, 0.42, 0.45);
const GRAY_SOFT = rgb(0.58, 0.57, 0.55);
const ON_DARK_LABEL = rgb(0.62, 0.61, 0.58);
const ON_DARK_VALUE = rgb(0.98, 0.97, 0.95);
const HAIRLINE = rgb(0.83, 0.79, 0.69);
const PAGE_BG = rgb(0.969, 0.957, 0.925);
const PANEL_BG = rgb(0.945, 0.933, 0.896);
const CARD_WHITE = rgb(0.996, 0.992, 0.984);
const CARD_SHADOW = rgb(0.886, 0.875, 0.839);

// Deterministic, human-readable — not a stored sequence, but stable for the
// same car/date so regenerating the same invoice doesn't produce a new
// number each time.
function invoiceNumber(input: DealerInvoiceInput): string {
  const d = input.soldDate;
  const datePart = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const idPart = (input.carPlate || input.carLabel).replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase();
  return `INV-${datePart}-${idPart}`;
}

// Greedy word-wrap against a pixel width, for the one field (address) long
// enough to need it at this column width.
function wrapText(text: string, maxWidth: number, f: PDFFont, size: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (f.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function buildDealerInvoicePdf(input: DealerInvoiceInput): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const oblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const margin = 52;
  const right = width - margin;
  const contentW = right - margin;

  const rightText = (text: string, x: number, yPos: number, size: number, f: PDFFont, color = INK) => {
    page.drawText(text, { x: x - f.widthOfTextAtSize(text, size), y: yPos, size, font: f, color });
  };
  const hr = (yPos: number, x0: number, x1: number, color = HAIRLINE, lineWidth = 1) => {
    page.drawLine({ start: { x: x0, y: yPos }, end: { x: x1, y: yPos }, thickness: lineWidth, color });
  };
  const tracked = (text: string, x: number, yPos: number, size: number, f: PDFFont, color: typeof INK, spacing: number) => {
    let cx = x;
    for (const ch of text) {
      page.drawText(ch, { x: cx, y: yPos, size, font: f, color });
      cx += f.widthOfTextAtSize(ch, size) + spacing;
    }
  };
  const trackedWidth = (text: string, size: number, f: PDFFont, spacing: number) =>
    [...text].reduce((w, ch) => w + f.widthOfTextAtSize(ch, size) + spacing, 0) - spacing;
  const trackedRight = (text: string, x1: number, yPos: number, size: number, f: PDFFont, color: typeof INK, spacing: number) => {
    tracked(text, x1 - trackedWidth(text, size, f, spacing), yPos, size, f, color, spacing);
  };

  // ── Page background + outer frame ──
  page.drawRectangle({ x: 0, y: 0, width, height, color: PAGE_BG });
  page.drawRectangle({ x: 20, y: 20, width: width - 40, height: height - 40, borderColor: GOLD_SOFT, borderWidth: 1 });

  let y = height - 66;

  // ── Header ──
  page.drawText('AUTODREAM', { x: margin, y, size: 24, font: bold, color: INK });
  tracked('PREMIUM USED CARS', margin, y - 18, 8, bold, GOLD, 1.6);
  hr(y - 28, margin, margin + 150, GOLD, 1.5);

  rightText('INVOICE', right, y - 2, 27, bold, INK);
  trackedRight('CONSIGNMENT SALE BILLING', right, y - 20, 7.5, bold, GOLD, 1.2);

  y -= 56;

  // ── Summary bar (dark) ── Invoice No. / Date of Sale / Total Due ──
  const barH = 58;
  page.drawRectangle({ x: margin, y: y - barH, width: contentW, height: barH, color: DARK });
  const barLabelY = y - 22;
  const barValueY = y - 40;
  page.drawText('INVOICE NO.', { x: margin + 20, y: barLabelY, size: 7.5, font: bold, color: ON_DARK_LABEL });
  page.drawText(invoiceNumber(input), { x: margin + 20, y: barValueY, size: 10.5, font: bold, color: ON_DARK_VALUE });
  const col2X = margin + contentW * 0.38;
  page.drawText('DATE OF SALE', { x: col2X, y: barLabelY, size: 7.5, font: bold, color: ON_DARK_LABEL });
  page.drawText(
    input.soldDate.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase(),
    { x: col2X, y: barValueY, size: 10.5, font: bold, color: ON_DARK_VALUE },
  );
  page.drawText('TOTAL DUE', { x: right - 160, y: barLabelY, size: 7.5, font: bold, color: GOLD });
  rightText(formatRM(input.amount), right - 20, barValueY, 16, bold, ON_DARK_VALUE);

  y -= barH + 28;

  // ── FROM / BILL TO panels ──
  const panelGap = 20;
  const panelW = (contentW - panelGap) / 2;
  const panelTop = y;

  const fromLines = wrapText(COMPANY_INFO.address, panelW - 32, font, 8.5);
  const panelH = 26 + (2 + fromLines.length + 1) * 13 + 14;

  page.drawRectangle({ x: margin, y: panelTop - panelH, width: panelW, height: panelH, color: PANEL_BG });
  page.drawRectangle({ x: margin, y: panelTop - panelH, width: 3, height: panelH, color: GOLD });
  let fy = panelTop - 20;
  tracked('FROM', margin + 18, fy, 7.5, bold, GOLD, 1.4);
  fy -= 18;
  page.drawText(COMPANY_INFO.legalName, { x: margin + 18, y: fy, size: 11.5, font: bold, color: INK });
  fy -= 15;
  for (const line of fromLines) {
    page.drawText(line, { x: margin + 18, y: fy, size: 8.5, font, color: GRAY });
    fy -= 12;
  }
  page.drawText(`${COMPANY_INFO.phone}  |  SSM No. ${COMPANY_INFO.ssmNumber}`, { x: margin + 18, y: fy, size: 8.5, font, color: GRAY });

  const billX = margin + panelW + panelGap;
  page.drawRectangle({ x: billX, y: panelTop - panelH, width: panelW, height: panelH, color: PANEL_BG });
  page.drawRectangle({ x: billX, y: panelTop - panelH, width: 3, height: panelH, color: GOLD });
  let by = panelTop - 20;
  tracked('BILL TO', billX + 18, by, 7.5, bold, GOLD, 1.4);
  by -= 18;
  page.drawText(input.dealerName, { x: billX + 18, y: by, size: 11.5, font: bold, color: INK });
  by -= 15;
  page.drawText('Consignment settlement', { x: billX + 18, y: by, size: 8.5, font, color: GRAY });
  if (input.dealerPhone) {
    by -= 12;
    page.drawText(input.dealerPhone, { x: billX + 18, y: by, size: 8.5, font, color: GRAY });
  }

  y = panelTop - panelH - 30;

  // ── Vehicle — its own prominent, unboxed line (a long trim/variant name
  // doesn't fit squeezed into a meta column) ──
  page.drawText('VEHICLE', { x: margin, y, size: 7.5, font: bold, color: GRAY_SOFT });
  y -= 24;
  page.drawText(input.carLabel.toUpperCase(), { x: margin, y, size: 19, font: bold, color: INK });
  if (input.carPlate) {
    y -= 18;
    tracked(`REGISTRATION  ${input.carPlate}`, margin, y, 8, bold, GOLD, 1.2);
  }
  y -= 20;
  hr(y, margin, right);
  y -= 30;

  // ── Itemized table — a white card lifted off the cream page ──
  const colQtyX = right - 210;
  const colPriceX = right - 130;
  const colAmtX = right;
  const headerH = 26;
  const rowH = 34;
  const tableH = headerH + rowH;

  page.drawRectangle({ x: margin + 2, y: y - tableH - 2, width: contentW, height: tableH, color: CARD_SHADOW });
  page.drawRectangle({ x: margin, y: y - tableH, width: contentW, height: tableH, color: CARD_WHITE });
  page.drawRectangle({ x: margin, y: y - headerH, width: contentW, height: headerH, color: DARK });
  page.drawText('DESCRIPTION', { x: margin + 14, y: y - 17, size: 8, font: bold, color: ON_DARK_LABEL });
  rightText('QTY', colQtyX, y - 17, 8, bold, ON_DARK_LABEL);
  rightText('UNIT PRICE', colPriceX, y - 17, 8, bold, ON_DARK_LABEL);
  rightText('AMOUNT', colAmtX - 14, y - 17, 8, bold, ON_DARK_LABEL);

  const rowTextY = y - headerH - 17;
  const itemDesc = `Consignment sale - ${input.carLabel}`;
  page.drawText(itemDesc, { x: margin + 14, y: rowTextY, size: 9.5, font: bold, color: INK });
  if (input.carPlate) {
    page.drawText(`Registration ${input.carPlate}`, { x: margin + 14, y: rowTextY - 12, size: 7.5, font, color: GRAY_SOFT });
  }
  rightText('1', colQtyX, rowTextY, 9.5, font, INK);
  rightText(formatRM(input.amount), colPriceX, rowTextY, 9.5, font, INK);
  rightText(formatRM(input.amount), colAmtX - 14, rowTextY, 9.5, bold, INK);

  y -= tableH + 26;

  // ── Totals — labels left-anchored well clear of the (large) right-aligned
  // amount, which can run wide at 21pt for big numbers ──
  const totalsLabelRight = colPriceX - 10;
  const totalDueLabelX = totalsLabelRight - 170;
  page.drawText('SUBTOTAL', { x: totalsLabelRight - bold.widthOfTextAtSize('SUBTOTAL', 8), y, size: 8, font: bold, color: GRAY_SOFT });
  rightText(formatRM(input.amount), colAmtX - 14, y, 9.5, font, GRAY);
  y -= 30;
  page.drawText('TOTAL DUE', { x: totalDueLabelX, y: y - 4, size: 12, font: bold, color: INK });
  rightText(formatRM(input.amount), colAmtX - 14, y - 9, 21, bold, GOLD);

  y -= 56;

  // ── Payment details (dark card) ──
  const payH = 78;
  page.drawRectangle({ x: margin, y: y - payH, width: contentW, height: payH, color: DARK });
  tracked('PAYMENT DETAILS', margin + 20, y - 20, 7.5, bold, GOLD, 1.4);
  const payColW = contentW / 3;
  const payCell = (cx: number, l: string, v: string) => {
    page.drawText(l, { x: cx, y: y - 40, size: 7.5, font: bold, color: ON_DARK_LABEL });
    page.drawText(v, { x: cx, y: y - 56, size: 10.5, font: bold, color: ON_DARK_VALUE });
  };
  payCell(margin + 20, 'BANK', COMPANY_INFO.bankName);
  payCell(margin + 20 + payColW, 'ACCOUNT NUMBER', COMPANY_INFO.bankAccountNumber);
  payCell(margin + 20 + payColW * 2, 'ACCOUNT NAME', COMPANY_INFO.bankAccountHolder);

  y -= payH + 26;

  // ── Thank-you + signature, kept close together ──
  page.drawText(
    'Thank you for your business. Kindly settle this invoice to the account above and retain this document for your records.',
    { x: margin, y, size: 8.5, font: oblique, color: GRAY },
  );
  y -= 34;
  page.drawLine({ start: { x: margin, y }, end: { x: margin + 170, y }, thickness: 0.75, color: INK });
  y -= 13;
  tracked('AUTHORIZED SIGNATURE', margin, y, 7.5, bold, GRAY_SOFT, 1);
  y -= 14;
  page.drawText(COMPANY_INFO.legalName, { x: margin, y, size: 9.5, font: bold, color: INK });

  // ── Footer ──
  const footerY = 46;
  hr(footerY + 18, margin, right);
  tracked(
    'COMPUTER-GENERATED INVOICE  •  AUTODREAM SDN BHD  •  KUCHING, SARAWAK',
    width / 2 - trackedWidth('COMPUTER-GENERATED INVOICE  •  AUTODREAM SDN BHD  •  KUCHING, SARAWAK', 7, font, 0.6) / 2,
    footerY, 7, font, GRAY_SOFT, 0.6,
  );

  return pdfDoc.save();
}
