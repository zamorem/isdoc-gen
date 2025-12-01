// index.ts
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import Invoice from '@deltazero/isdoc';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

interface Address {
    street: string;
    city:   string;
    zip:    string;
}
interface CompanyConfig {
    name:         string;
    company_id:   string;

    tax_id:       string;
    address:      Address;
    bank_account?: string;
}
interface Config {
    supplier:   CompanyConfig;
    recipient:  CompanyConfig;
    due_days:   number;
    currency:   string;
}
interface Item {
    text:     string;
    md?:      number;
    md_rate?: number;
    hr?:      number;
    hr_rate?: number;
}
interface InvoiceYAML {
    nr: string;
    month: number;
    payment_id:   string;
    items: Item[];
}
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

// ── CLI ─────────────────────────────────────────────────────
const argv = yargs(hideBin(process.argv))
    .option('config', {
        alias:    'c', type: 'string', demandOption: true,
        describe: 'path to config.yaml'
    })
    .option('invoice', {
        alias:    'i', type: 'string', demandOption: true,
        describe: 'path to invoice.yaml'
    })
    .help().parseSync();

const cfgPath = argv.config;
const invPath = argv.invoice;

// ── Load YAML ───────────────────────────────────────────────
const cfg = yaml.load(fs.readFileSync(cfgPath, 'utf8')) as Config;
const inv = yaml.load(fs.readFileSync(invPath, 'utf8')) as InvoiceYAML;

// ── Date & Number Helpers ──────────────────────────────────
const resolveBilling = (item: Item) => {
    const hasMD = item.md !== undefined && item.md_rate !== undefined;
    if (hasMD) {
        return { quantity: item.md as number, rate: item.md_rate as number, unit: 'md' as const };
    }
    const hasHR = item.hr !== undefined && item.hr_rate !== undefined;
    if (hasHR) {
        return { quantity: item.hr as number, rate: item.hr_rate as number, unit: 'hr' as const };
    }
    throw new Error(`Item "${item.text}" must specify either md+md_rate or hr+hr_rate`);
};

const year      = new Date().getFullYear();
const month     = inv.month as keyof typeof monthsLabel;
const invoiceNo = `${year}/${inv.nr}`;
const issueDate = new Date(year, month, 0, 12);           // last day of month
const dueDate   = new Date(issueDate);
dueDate.setDate(issueDate.getDate() + cfg.due_days);
const total     = inv.items
    .reduce((sum, it) => {
        const { quantity, rate } = resolveBilling(it);
        return sum + Math.round(quantity * rate * 100)/100;
    }, 0);

// assume non-VAT if tax_id is blank
const vatApplicable = Boolean(cfg.supplier.tax_id && cfg.supplier.tax_id.trim());
const vatPercent    = vatApplicable ? 21 : 0;
const currency      = cfg.currency;
const taxInclusiveAmonunt =  Math.round(total * (1 + vatPercent/100) * 100)/100;
const taxAmount = Math.round(total * vatPercent/100 * 100)/100;


// ── Build ISDOC via @deltazero/isdoc ──────────────────────
const invoiceData = {
    DocumentType: 1 as const,                   // invoice
    ID:           invoiceNo,
    IssuingSystem:'zizka',
    IssueDate:    issueDate,
    TaxPointDate: issueDate,
    VATApplicable: vatApplicable,
    DocumentCurrencyCode: currency,

    AccountingSupplierParty: {
        Party: {
            PartyIdentification: { ID: cfg.supplier.company_id },
            PartyName:           { Name: cfg.supplier.name },
            PostalAddress:       {
                StreetName:     cfg.supplier.address.street,
                BuildingNumber: '',
                CityName:       cfg.supplier.address.city,
                PostalZone:     cfg.supplier.address.zip,
                Country:        { IdentificationCode: '', Name: '' }
            },
            PartyTaxScheme: {
                CompanyID: cfg.supplier.tax_id || cfg.supplier.company_id,
                TaxScheme: vatApplicable ? 'VAT' : 'NONE'
            }
        }
    },

    AccountingCustomerParty: {
        Party: {
            PartyIdentification: { ID: cfg.recipient.company_id },
            PartyName:           { Name: cfg.recipient.name },
            PostalAddress:       {
                StreetName:     cfg.recipient.address.street,
                BuildingNumber: '',
                CityName:       cfg.recipient.address.city,
                PostalZone:     cfg.recipient.address.zip,
                Country:        { IdentificationCode: 'CZ', Name: '' }
            },
            PartyTaxScheme: {
                CompanyID: cfg.recipient.tax_id || cfg.recipient.company_id,
                TaxScheme: vatApplicable ? 'VAT' : 'NONE'
            }
        }
    },

    InvoiceLines: {
        InvoiceLine: inv.items.map((it, idx) => {
            const { quantity, rate } = resolveBilling(it);
            const amt = Math.round(quantity * rate * 100)/100;
            return {
                ID:                        String(idx+1),
                InvoicedQuantity:          quantity,
                LineExtensionAmount:       amt,
                LineExtensionAmountTaxInclusive: amt * (1 + vatPercent/100),
                LineExtensionTaxAmount:    Math.round(amt * vatPercent/100 * 100)/100,
                UnitPrice:                 rate,
                UnitPriceTaxInclusive:     Math.round(rate * (1 + vatPercent/100) * 100)/100,
                ClassifiedTaxCategory:     {
                    Percent: vatPercent,
                    VATCalculationMethod: 0,
                    VATApplicable: vatApplicable
                },
                Item: { Description: it.text.replace('{{month}}', String(monthsLabel[month])) }
            };
        })
    },

    TaxTotal: {
        TaxSubTotal: {
            TaxableAmount:    total,
            TaxAmount:        taxAmount,
            TaxInclusiveAmount: taxInclusiveAmonunt,
            AlreadyClaimedTaxableAmount:    0,
            AlreadyClaimedTaxAmount:       0,
            AlreadyClaimedTaxInclusiveAmount: 0,
            DifferenceTaxableAmount:       total,
            DifferenceTaxAmount:           taxAmount,
            DifferenceTaxInclusiveAmount:  taxInclusiveAmonunt,
            TaxCategory: {
                Percent: vatPercent,
                VATApplicable: vatApplicable
            }
        },
        TaxAmount: taxAmount
    },

    LegalMonetaryTotal: {
        TaxExclusiveAmount:            total,
        TaxInclusiveAmount:            taxInclusiveAmonunt,
        AlreadyClaimedTaxExclusiveAmount: 0,
        AlreadyClaimedTaxInclusiveAmount: 0,
        DifferenceTaxExclusiveAmount:  total,
        DifferenceTaxInclusiveAmount:  taxInclusiveAmonunt,
        PayableRoundingAmount:         0,
        PaidDepositsAmount:            0,
        PayableAmount:                 taxInclusiveAmonunt
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
const xml     = invoice.toXML();

// write to sibling .isdoc
const outPath = path.join(
    path.dirname(invPath),
    path.basename(invPath, path.extname(invPath)) + '.isdoc'
);
fs.writeFileSync(outPath, xml, 'utf8');
console.log(`→ ${outPath} generated`);
