// index.ts
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { spawnSync } from 'child_process';
import Invoice from '@deltazero/isdoc';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { renderInvoicePdf } from './pdf-invoice';
import { CompanyConfig, Config, Item, InvoiceYAML } from './types';

type ResolvedBilling = {
    quantity: number;
    rate: number;
    amount: number;
    pdfUnit?: string;
    pdfBillingLabel?: string;
    isdocUnitCode: string;
};

const monthsLabel = {
    1: "leden",
    2: "únor",
    3: "březen",
    4: "duben",
    5: "květen",
    6: "červen",
    7: "červenec",
    8: "srpen",
    9: "září",
    10: "říjen",
    11: "listopad",
    12: "prosinec"
};

const run = async () => {
    // ── CLI ─────────────────────────────────────────────────────
    const argv = yargs(hideBin(process.argv))
        .option('config', {
            alias: 'c', type: 'string', demandOption: true,
            describe: 'path to config.yaml'
        })
        .option('invoice', {
            alias: 'i', type: 'string', demandOption: true,
            describe: 'path to invoice.yaml'
        })
        .help().parseSync();

    const cfgPath = argv.config;
    const invPath = argv.invoice;

    // ── Load YAML ───────────────────────────────────────────────
    const cfg = yaml.load(fs.readFileSync(cfgPath, 'utf8')) as Config;
    const inv = yaml.load(fs.readFileSync(invPath, 'utf8')) as InvoiceYAML;

    // ── Date & Number Helpers ──────────────────────────────────
    const roundMoney = (value: number) => Math.round(value * 100) / 100;

    const resolveBilling = (item: Item) => {
        const hasMD = item.md !== undefined && item.md_rate !== undefined;
        if (hasMD) {
            const quantity = item.md as number;
            const rate = item.md_rate as number;
            return {
                quantity,
                rate,
                amount: roundMoney(quantity * rate),
                pdfUnit: 'MD',
                isdocUnitCode: 'MD'
            } satisfies ResolvedBilling;
        }

        const hasHR = item.hr !== undefined && item.hr_rate !== undefined;
        if (hasHR) {
            const quantity = item.hr as number;
            const rate = item.hr_rate as number;
            return {
                quantity,
                rate,
                amount: roundMoney(quantity * rate),
                pdfUnit: 'HOD',
                isdocUnitCode: 'HOD'
            } satisfies ResolvedBilling;
        }

        if (item.sum !== undefined) {
            return {
                quantity: 1,
                rate: item.sum,
                amount: roundMoney(item.sum),
                pdfBillingLabel: 'jednorázová částka',
                isdocUnitCode: 'C62'
            } satisfies ResolvedBilling;
        }

        throw new Error(`Item "${item.text}" must specify either md+md_rate, hr+hr_rate, or sum`);
    };

    const resolveItemDescription = (text: string) => text.replace('{{month}}', String(monthsLabel[month]));

    const resolveRecipient = (): CompanyConfig => {
        // prefer recipients map when present
        if (cfg.recipients && Object.keys(cfg.recipients).length > 0) {
            const key = inv.recipient_id || Object.keys(cfg.recipients)[0];
            const found = cfg.recipients[key];
            if (!found) {
                const available = Object.keys(cfg.recipients).join(', ') || 'none';
                throw new Error(`Recipient "${key}" not found. Available: ${available}`);
            }
            return found;
        }
        if (cfg.recipient) {
            return cfg.recipient;
        }
        throw new Error('No recipient configured.');
    };

    const recipient = resolveRecipient();

    const month = inv.month as keyof typeof monthsLabel;
    const parseDateValue = (value: string | Date) => {
        if (value instanceof Date) {
            return new Date(value);
        }
        return new Date(`${value}T12:00:00`);
    };
    const defaultIssueDate = () => new Date(2025, month, 0, 12); // last day of month
    const issueDate = inv.issued_at ? parseDateValue(inv.issued_at) : defaultIssueDate();
    const taxableDate = inv.taxable_at ? parseDateValue(inv.taxable_at) : issueDate;
    const invoiceNo = `${issueDate.getFullYear()}/${inv.nr}`;
    const dueDate = new Date(issueDate);
    dueDate.setDate(issueDate.getDate() + 14);
    const total = inv.items
        .reduce((sum, it) => {
            const { amount } = resolveBilling(it);
            return sum + amount;
        }, 0);

    // assume non-VAT if tax_id is blank
    const vatApplicable = Boolean(cfg.supplier.tax_id && cfg.supplier.tax_id.trim());
    const vatPercent = vatApplicable ? 21 : 0;
    const currency = cfg.currency;
    const taxInclusiveAmonunt = Math.round(total * (1 + vatPercent / 100) * 100) / 100;
    const taxAmount = Math.round(total * vatPercent / 100 * 100) / 100;

    const pdfItems = inv.items.map((it) => {
        const { quantity, rate, amount, pdfUnit, pdfBillingLabel } = resolveBilling(it);
        return {
            description: resolveItemDescription(it.text),
            quantity,
            unit: pdfUnit,
            rate,
            amount,
            billingLabel: pdfBillingLabel
        };
    });

    // ── Build ISDOC via @deltazero/isdoc ──────────────────────
    const invoiceData = {
        DocumentType: 1 as const, // invoice
        ID: invoiceNo,
        IssuingSystem: 'zizka',
        IssueDate: issueDate,
        TaxPointDate: taxableDate,
        VATApplicable: vatApplicable,
        DocumentCurrencyCode: currency,

        AccountingSupplierParty: {
            Party: {
                PartyIdentification: { ID: cfg.supplier.company_id },
                PartyName: { Name: cfg.supplier.name },
                PostalAddress: {
                    StreetName: cfg.supplier.address.street,
                    BuildingNumber: '',
                    CityName: cfg.supplier.address.city,
                    PostalZone: cfg.supplier.address.zip,
                    Country: { IdentificationCode: '', Name: '' }
                },
                PartyTaxScheme: {
                    CompanyID: cfg.supplier.tax_id || cfg.supplier.company_id,
                    TaxScheme: vatApplicable ? 'VAT' : 'NONE'
                }
            }
        },

        AccountingCustomerParty: {
            Party: {
                PartyIdentification: { ID: recipient.company_id },
                PartyName: { Name: recipient.name },
                PostalAddress: {
                    StreetName: recipient.address.street,
                    BuildingNumber: '',
                    CityName: recipient.address.city,
                    PostalZone: recipient.address.zip,
                    Country: { IdentificationCode: 'CZ', Name: '' }
                },
                PartyTaxScheme: {
                    CompanyID: recipient.tax_id || recipient.company_id,
                    TaxScheme: vatApplicable ? 'VAT' : 'NONE'
                }
            }
        },

        InvoiceLines: {
            InvoiceLine: inv.items.map((it, idx) => {
                const { quantity, rate, amount, isdocUnitCode } = resolveBilling(it);
                return {
                    ID: String(idx + 1),
                    InvoicedQuantity: {
                        $_unitCode: isdocUnitCode,
                        '#text': quantity
                    },
                    LineExtensionAmount: amount,
                    LineExtensionAmountTaxInclusive: roundMoney(amount * (1 + vatPercent / 100)),
                    LineExtensionTaxAmount: roundMoney(amount * vatPercent / 100),
                    UnitPrice: rate,
                    UnitPriceTaxInclusive: roundMoney(rate * (1 + vatPercent / 100)),
                    ClassifiedTaxCategory: {
                        Percent: vatPercent,
                        VATCalculationMethod: 0,
                        VATApplicable: vatApplicable
                    },
                    Item: { Description: resolveItemDescription(it.text) }
                };
            })
        },

        TaxTotal: {
            TaxSubTotal: {
                TaxableAmount: total,
                TaxAmount: taxAmount,
                TaxInclusiveAmount: taxInclusiveAmonunt,
                AlreadyClaimedTaxableAmount: 0,
                AlreadyClaimedTaxAmount: 0,
                AlreadyClaimedTaxInclusiveAmount: 0,
                DifferenceTaxableAmount: total,
                DifferenceTaxAmount: taxAmount,
                DifferenceTaxInclusiveAmount: taxInclusiveAmonunt,
                TaxCategory: {
                    Percent: vatPercent,
                    VATApplicable: vatApplicable
                }
            },
            TaxAmount: taxAmount
        },

        LegalMonetaryTotal: {
            TaxExclusiveAmount: total,
            TaxInclusiveAmount: taxInclusiveAmonunt,
            AlreadyClaimedTaxExclusiveAmount: 0,
            AlreadyClaimedTaxInclusiveAmount: 0,
            DifferenceTaxExclusiveAmount: total,
            DifferenceTaxInclusiveAmount: taxInclusiveAmonunt,
            PayableRoundingAmount: 0,
            PaidDepositsAmount: 0,
            PayableAmount: taxInclusiveAmonunt
        },
        PaymentMeans: {
            Payment: {
                PaidAmount: total,
                PaymentMeansCode: 42,
                Details: {
                    PaymentDueDate: dueDate,
                    ID: '2701799387',
                    BankCode: '2010',
                    Name: '',
                    IBAN: '',
                    BIC: '',
                    VariableSymbol: inv.payment_id,
                    ConstantSymbol: '',
                    SpecificSymbol: ''
                }
            }
        }
    };

    // instantiate & serialize
    const invoice = new Invoice(invoiceData);
    const xml = invoice.toXML();

    // write to sibling .isdoc
    const outPath = path.join(
        path.dirname(invPath),
        path.basename(invPath, path.extname(invPath)) + '.isdoc'
    );
    fs.writeFileSync(outPath, xml, 'utf8');
    console.log(`→ ${outPath} generated`);

    const pdfPath = path.join(
        path.dirname(invPath),
        path.basename(invPath, path.extname(invPath)) + '.pdf'
    );

    await renderInvoicePdf({
        outputPath: pdfPath,
        invoiceNo,
        issueDate,
        taxableDate,
        dueDate,
        supplier: cfg.supplier,
        recipient,
        contact: cfg.contact,
        items: pdfItems,
        currency,
        totals: {
            total,
            taxAmount,
            totalWithTax: taxInclusiveAmonunt,
            vatPercent,
            vatApplicable
        },
        paymentId: inv.payment_id
    });
    console.log(`→ ${pdfPath} generated`);

    const embeddedPdfPath = path.join(
        path.dirname(invPath),
        path.basename(invPath, path.extname(invPath)) + '-isdoc.pdf'
    );
    const qpdfResult = spawnSync(
        'qpdf',
        [pdfPath, '--add-attachment', outPath, '--', embeddedPdfPath],
        { stdio: 'inherit' }
    );
    if (qpdfResult.error) {
        throw qpdfResult.error;
    }
    if (qpdfResult.status !== 0) {
        throw new Error(`qpdf failed with exit code ${qpdfResult.status}`);
    }
    console.log(`→ ${embeddedPdfPath} generated`);
};

run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
