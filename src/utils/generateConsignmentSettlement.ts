import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib';
import { COMPANY_INFO } from './payslip';
import { formatRM } from './format';

export interface ConsignmentSettlementInput {
  dealerName: string;      // consignor, e.g. "Top Mark"
  carLabel: string;        // e.g. "2019 Perodua Alza"
  carPlate?: string;
  sellingPrice: number;
  addOnTotal: number;
  discount: number;
  purchasePrice: number;
  repairCost: number;
  miscCost: number;
  disbursementCharges: number;
  commission: number;
  intakeBonus: number;
  netProfit: number;       // matches the in-app Deal Financials Net Profit
  splitPercent: number;    // consignor's share of net profit, e.g. 30
  generatedAt: Date;
}

const GOLD = rgb(0.722, 0.525, 0.043);
const INK = rgb(0.11, 0.11, 0.13);
const GRAY = rgb(0.42, 0.42, 0.45);
const HAIRLINE = rgb(0.87, 0.83, 0.71);
const RED = rgb(0.7, 0.13, 0.13);

function profitShare(input: ConsignmentSettlementInput): number {
  return Math.max(0, input.netProfit) * (input.splitPercent / 100);
}

// Detailed, itemized settlement receipt — every expense that fed into Net
// Profit is shown so the consignor can see exactly how their share was
// derived, not just take the final number on faith.
export async function buildConsignmentSettlementPdf(input: ConsignmentSettlementInput): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]);
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

  try {
    const logoBytes = await fetch('/logo.png').then((r) => r.arrayBuffer());
    const logoImg = await pdfDoc.embedPng(logoBytes);
    const logoW = 100;
    const logoH = (logoImg.height / logoImg.width) * logoW;
    page.drawImage(logoImg, { x: margin, y: y - logoH + 24, width: logoW, height: logoH });
  } catch {
    page.drawText(COMPANY_INFO.name, { x: margin, y, size: 20, font: bold, color: GOLD });
  }
  page.drawText('CONSIGNMENT SETTLEMENT', { x: margin, y: y - 40, size: 16, font: bold, color: INK });
  rightText(COMPANY_INFO.name, y, 11, bold, GOLD);
  rightText(COMPANY_INFO.tagline, y - 14, 8, font, GRAY);
  rightText(COMPANY_INFO.address, y - 26, 8, font, GRAY);
  rightText(COMPANY_INFO.phone, y - 38, 8, font, GRAY);

  y -= 66;
  hr(y, GOLD, 1.5);
  y -= 26;

  const infoLabel = (label: string, value: string, x: number, yPos: number) => {
    page.drawText(label, { x, y: yPos, size: 8, font, color: GRAY });
    page.drawText(value, { x, y: yPos - 13, size: 11, font: bold, color: INK });
  };
  infoLabel('CONSIGNOR', input.dealerName, margin, y);
  const carValue = input.carPlate ? `${input.carLabel}  ·  ${input.carPlate}` : input.carLabel;
  infoLabel('VEHICLE', carValue, 320, y);
  infoLabel('SPLIT', `${input.splitPercent}% of Net Profit`, margin, y - 34);
  infoLabel(
    'DATE',
    input.generatedAt.toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' }),
    320,
    y - 34,
  );

  y -= 74;
  hr(y);
  y -= 24;

  page.drawText('DEAL BREAKDOWN', { x: margin, y, size: 9, font: bold, color: GRAY });
  y -= 20;
  row('Selling Price', input.sellingPrice, y, { bold: true, size: 12 });
  y -= 20;
  if (input.addOnTotal > 0) { row('+ Customer Add-ons', input.addOnTotal, y); y -= 18; }
  if (input.discount > 0) { row('- Discount', input.discount, y, { color: RED }); y -= 18; }
  row('- Purchase Price', input.purchasePrice, y, { color: RED }); y -= 18;
  if (input.repairCost > 0) { row('- Repair Expenses', input.repairCost, y, { color: RED }); y -= 18; }
  if (input.miscCost > 0) { row('- Misc Costs', input.miscCost, y, { color: RED }); y -= 18; }
  if (input.disbursementCharges > 0) { row('- Disbursement Charges', input.disbursementCharges, y, { color: RED }); y -= 18; }
  if (input.commission > 0) { row('- Salesman Commission', input.commission, y, { color: RED }); y -= 18; }
  if (input.intakeBonus > 0) { row('- Intake Bonus', input.intakeBonus, y, { color: RED }); y -= 18; }

  y -= 6;
  hr(y, GOLD, 1.5);
  y -= 22;
  row('NET PROFIT', input.netProfit, y, { bold: true, size: 13 });

  y -= 38;
  hr(y);
  y -= 24;

  page.drawText('SETTLEMENT', { x: margin, y, size: 9, font: bold, color: GRAY });
  y -= 20;
  row('Purchase Price (returned)', input.purchasePrice, y); y -= 18;
  row(`Consignor Share (${input.splitPercent}% of Net Profit)`, profitShare(input), y); y -= 18;

  y -= 10;
  hr(y, GOLD, 1.5);
  y -= 28;
  page.drawText('TOTAL TO TRANSFER', { x: margin, y, size: 14, font: bold, color: INK });
  rightText(formatRM(input.purchasePrice + profitShare(input)), y, 16, bold, GOLD);

  const footerY = 70;
  hr(footerY + 24);
  page.drawText(
    `Generated ${input.generatedAt.toLocaleString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${COMPANY_INFO.website}`,
    { x: margin, y: footerY, size: 8, font, color: GRAY },
  );

  return pdfDoc.save();
}

// Short summary — just the final take-in price, no expense breakdown. For
// handing to the consignor as a plain settlement notice.
export async function buildConsignmentSummaryPdf(input: ConsignmentSettlementInput): Promise<Uint8Array> {
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
  page.drawText('TAKE-IN SETTLEMENT SUMMARY', { x: margin, y: y - 36, size: 14, font: bold, color: INK });
  rightText(COMPANY_INFO.name, y, 10, bold, GOLD);
  rightText(COMPANY_INFO.phone, y - 13, 8, font, GRAY);

  y -= 60;
  hr(y, GOLD, 1.5);
  y -= 26;

  const infoLabel = (label: string, value: string, x: number, yPos: number) => {
    page.drawText(label, { x, y: yPos, size: 8, font, color: GRAY });
    page.drawText(value, { x, y: yPos - 13, size: 11, font: bold, color: INK });
  };
  infoLabel('CONSIGNOR', input.dealerName, margin, y);
  const carValue = input.carPlate ? `${input.carLabel}  ·  ${input.carPlate}` : input.carLabel;
  infoLabel('VEHICLE', carValue, 320, y);
  infoLabel(
    'DATE',
    input.generatedAt.toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' }),
    margin,
    y - 34,
  );

  y -= 70;
  hr(y);
  y -= 34;

  const total = input.purchasePrice + profitShare(input);
  page.drawText('TAKE-IN PRICE', { x: margin, y, size: 12, font: bold, color: GRAY });
  y -= 30;
  rightText(formatRM(total), y, 30, bold, GOLD);

  y -= 20;
  page.drawText(
    `(Purchase Price ${formatRM(input.purchasePrice)} + Profit Share ${formatRM(profitShare(input))})`,
    { x: margin, y, size: 9, font, color: GRAY },
  );

  const footerY = 40;
  hr(footerY + 20);
  page.drawText(
    `Generated ${input.generatedAt.toLocaleString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${COMPANY_INFO.website}`,
    { x: margin, y: footerY, size: 8, font, color: GRAY },
  );

  return pdfDoc.save();
}
