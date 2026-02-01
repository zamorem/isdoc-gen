export interface Address {
    street: string;
    city: string;
    zip: string;
}

export interface CompanyConfig {
    name: string;
    company_id: string;
    tax_id: string;
    address: Address;
    bank_account?: string;
}

export interface ContactInfo {
    name: string;
    address: string;
    email: string;
    phone: string;
}

export interface Config {
    supplier: CompanyConfig;
    recipient?: CompanyConfig;
    recipients?: Record<string, CompanyConfig>;
    contact?: ContactInfo;
    due_days: number;
    currency: string;
}

export interface Item {
    text: string;
    md?: number;
    md_rate?: number;
    hr?: number;
    hr_rate?: number;
}

export interface InvoiceYAML {
    nr: string;
    month: number;
    issued_at?: string;
    taxable_at?: string;
    payment_id: string;
    recipient_id?: string;
    items: Item[];
}
