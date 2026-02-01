import * as fs from 'fs';
import { createRequire } from 'module';
import PDFDocument from 'pdfkit';
import { CompanyConfig, ContactInfo } from './types';

export interface InvoicePdfItem {
    description: string;
    quantity: number;
    unit: string;
    rate: number;
    amount: number;
}

export interface InvoiceTotals {
    total: number;
    taxAmount: number;
    totalWithTax: number;
    vatPercent: number;
    vatApplicable: boolean;
}

export interface InvoicePdfData {
    outputPath: string;
    invoiceNo: string;
    issueDate: Date;
    dueDate: Date;
    supplier: CompanyConfig;
    recipient: CompanyConfig;
    contact?: ContactInfo;
    items: InvoicePdfItem[];
    currency: string;
    totals: InvoiceTotals;
    paymentId: string;
}

const PAGE_MARGIN = 50;
const HEADER_FONT_SIZE = 24;
const LABEL_FONT_SIZE = 11;
const BODY_FONT_SIZE = 10;
const TABLE_HEADER_FONT_SIZE = 8;
const ROW_PADDING = 4;
const ROW_HEIGHT = 18;
const TABLE_HEADER_HEIGHT = 22;
const FONT_REGULAR = 'DejaVuSans';
const FONT_BOLD = 'DejaVuSans-Bold';

const resolveFontPath = (fileName: string) => {
    const require = createRequire(import.meta.url);
    return require.resolve(`dejavu-fonts-ttf/ttf/${fileName}`);
};

const registerFonts = (doc: PDFDocument) => {
    doc.registerFont(FONT_REGULAR, resolveFontPath('DejaVuSans.ttf'));
    doc.registerFont(FONT_BOLD, resolveFontPath('DejaVuSans-Bold.ttf'));
};

const formatMoney = (value: number, currency: string) => {
    const formatter = new Intl.NumberFormat('cs-CZ', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    return `${formatter.format(value)} ${currency}`;
};

const formatDate = (date: Date) => new Intl.DateTimeFormat('cs-CZ').format(date);

const formatPartyLines = (party: CompanyConfig) => {
    const lines = [
        party.name,
        party.address.street,
        `${party.address.zip} ${party.address.city}`,
        `IC: ${party.company_id}`
    ];
    if (party.tax_id && party.tax_id.trim()) {
        lines.push(`DIC: ${party.tax_id}`);
    }
    return lines;
};

const formatContactLines = (contact: ContactInfo) => {
    const addressLines = contact.address.split('\n').map((line) => line.trim()).filter(Boolean);
    return [contact.name, ...addressLines, contact.email, contact.phone];
};

const drawHeader = (doc: PDFDocument, data: InvoicePdfData, x: number, y: number, width: number) => {
    doc.fontSize(HEADER_FONT_SIZE)
        .text(`Faktura – daňový doklad č. ${data.invoiceNo}`, x, y, { width });
    return y + 60;
};

const drawPartyBlock = (
    doc: PDFDocument,
    label: string,
    party: CompanyConfig,
    x: number,
    y: number,
    width: number
) => {
    doc.font(FONT_BOLD).fontSize(LABEL_FONT_SIZE).text(label, x, y, { width });
    const lines = formatPartyLines(party);
    let cursorY = y + 16;
    doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE);
    lines.forEach((line) => {
        doc.text(line, x, cursorY, { width });
        cursorY += 14;
    });
    return cursorY - y;
};

const drawInfoBlock = (
    doc: PDFDocument,
    entries: Array<{ label: string; value: string }>,
    x: number,
    y: number,
    width: number
) => {
    const labelWidth = Math.min(120, width * 0.4);
    let cursorY = y;
    doc.fontSize(BODY_FONT_SIZE).font(FONT_REGULAR);
    entries.forEach((entry) => {
        doc.font(FONT_REGULAR).text(entry.label, x, cursorY, { width: labelWidth });
        doc.font(FONT_REGULAR).text(entry.value, x + labelWidth + 8, cursorY, {
            width: width - labelWidth - 8
        });
        cursorY += 16;
    });
    return cursorY;
};

const drawTableHeader = (
    doc: PDFDocument,
    headers: string[],
    columnX: number[],
    columnWidths: number[],
    y: number
) => {
    doc.font(FONT_BOLD).fontSize(TABLE_HEADER_FONT_SIZE);
    headers.forEach((header, index) => {
        const align = index === 0 ? 'left' : 'right';
        doc.text(header, columnX[index], y + ROW_PADDING, {
            width: columnWidths[index] - ROW_PADDING,
            align
        });
    });
    return y + TABLE_HEADER_HEIGHT;
};

const ensureTableSpace = (doc: PDFDocument, y: number, needed: number) => {
    const bottom = doc.page.height - PAGE_MARGIN;
    if (y + needed <= bottom) {
        return y;
    }
    doc.addPage({ size: 'A4', margin: PAGE_MARGIN });
    return PAGE_MARGIN;
};

const drawItemsTable = (
    doc: PDFDocument,
    items: InvoicePdfItem[],
    x: number,
    y: number,
    tableWidth: number,
    currency: string
) => {
    const headers = ['Položka', '', 'Cena'];
    const columnWidths = [
        tableWidth * 0.5,
        tableWidth * 0.32,
        tableWidth * 0.18
    ];
    const columnX = columnWidths.reduce<number[]>((positions, width, index) => {
        const start = index === 0 ? x : positions[index - 1] + columnWidths[index - 1];
        return [...positions, start];
    }, []);

    let cursorY = drawTableHeader(doc, headers, columnX, columnWidths, y);
    doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE);

    items.forEach((item) => {
        const quantityText = item.quantity.toString().replace('.', ',');
        const rateText = `${quantityText} × ${item.rate.toFixed(2).replace('.', ',')} ${currency}`;
        const lineText = `${item.description} (${quantityText} ${item.unit.toLowerCase()})`;
        const descriptionHeight = doc.heightOfString(lineText, {
            width: columnWidths[0] - ROW_PADDING * 2
        });
        const rowHeight = Math.max(ROW_HEIGHT, descriptionHeight + ROW_PADDING * 2);
        cursorY = ensureTableSpace(doc, cursorY, rowHeight + 10);
        if (cursorY === PAGE_MARGIN) {
            cursorY = drawTableHeader(doc, headers, columnX, columnWidths, cursorY);
            doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE);
        }

        doc.text(lineText, columnX[0], cursorY + ROW_PADDING, {
            width: columnWidths[0] - ROW_PADDING * 2
        });

        doc.text(rateText, columnX[1], cursorY + ROW_PADDING, {
            width: columnWidths[1] - ROW_PADDING,
            align: 'right'
        });
        doc.text(formatMoney(item.amount, currency), columnX[2], cursorY + ROW_PADDING, {
            width: columnWidths[2] - ROW_PADDING,
            align: 'right'
        });

        cursorY += rowHeight;
    });

    return cursorY + 10;
};

const drawTotals = (
    doc: PDFDocument,
    totals: InvoiceTotals,
    currency: string,
    x: number,
    y: number,
    width: number
) => {
    const rows = [
        { label: 'Celkem k úhradě', value: formatMoney(totals.total, currency) }
    ];

    let cursorY = y;
    rows.forEach((row, index) => {
        const isTotal = index === rows.length - 1;
        doc.font(isTotal ? FONT_BOLD : FONT_REGULAR)
            .fontSize(isTotal ? LABEL_FONT_SIZE : BODY_FONT_SIZE)
            .text(row.label, x, cursorY, { width: width * 0.5 });
        doc.font(isTotal ? FONT_BOLD : FONT_REGULAR)
            .fontSize(isTotal ? LABEL_FONT_SIZE : BODY_FONT_SIZE)
            .text(row.value, x, cursorY, { width, align: 'right' });
        cursorY += 18;
    });
    return cursorY;
};

const drawPaymentInfo = (
    doc: PDFDocument,
    supplier: CompanyConfig,
    paymentId: string,
    x: number,
    y: number,
    width: number
) => {
    const entries = [
        { label: 'Způsob platby', value: 'převodem' },
        supplier.bank_account ? { label: 'Číslo účtu', value: supplier.bank_account } : null,
        { label: 'Variabilní symbol', value: paymentId }
    ].filter(Boolean) as Array<{ label: string; value: string }>;

    if (entries.length === 0) {
        return y;
    }
    return drawInfoBlock(doc, entries, x, y, width);
};

const drawContactBlock = (
    doc: PDFDocument,
    contact: ContactInfo,
    x: number,
    y: number,
    width: number
) => {
    doc.font(FONT_BOLD).fontSize(LABEL_FONT_SIZE).text('Kontakt', x, y, { width });
    const lines = formatContactLines(contact);
    let cursorY = y + 16;
    doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE);
    lines.forEach((line) => {
        doc.text(line, x, cursorY, { width });
        cursorY += 14;
    });
    return cursorY;
};

export const renderInvoicePdf = (data: InvoicePdfData) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
    const stream = fs.createWriteStream(data.outputPath);
    doc.pipe(stream);
    registerFonts(doc);
    doc.font(FONT_REGULAR);

    const contentWidth = doc.page.width - PAGE_MARGIN * 2;
    let cursorY = PAGE_MARGIN;

    cursorY = drawHeader(doc, data, PAGE_MARGIN, cursorY, contentWidth) + 8;

    const columnGap = 20;
    const columnWidth = (contentWidth - columnGap) / 2;
    const leftX = PAGE_MARGIN;
    const rightX = PAGE_MARGIN + columnWidth + columnGap;

    const supplierHeight = drawPartyBlock(doc, 'Dodavatel', data.supplier, leftX, cursorY, columnWidth);
    const recipientHeight = drawPartyBlock(doc, 'Odběratel', data.recipient, rightX, cursorY, columnWidth);
    cursorY += Math.max(supplierHeight, recipientHeight) + 36;

    const infoEntries = [
        { label: 'Datum vystavení', value: formatDate(data.issueDate) },
        { label: 'Datum splatnosti', value: formatDate(data.dueDate) }
    ];
    cursorY = drawInfoBlock(doc, infoEntries, PAGE_MARGIN, cursorY, contentWidth) + 6;
    cursorY = drawPaymentInfo(doc, data.supplier, data.paymentId, PAGE_MARGIN, cursorY, contentWidth) + 38;

    cursorY = drawItemsTable(doc, data.items, PAGE_MARGIN, cursorY, contentWidth, data.currency);

    const totalsWidth = 220;
    const totalsX = PAGE_MARGIN + contentWidth - totalsWidth;
    cursorY = drawTotals(doc, data.totals, data.currency, totalsX, cursorY, totalsWidth) + 20;

    if (data.contact) {
        const footerHeight = 80;
        const footerY = doc.page.height - PAGE_MARGIN - footerHeight;
        drawContactBlock(doc, data.contact, PAGE_MARGIN, footerY, contentWidth);
    }

    doc.end();

    return new Promise<void>((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
    });
};
