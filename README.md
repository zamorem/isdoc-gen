# instalace
(vyzaduje nodejs)

```
npm i
```

spusteni
```

npx tsx index.ts --config=mock/config.yaml --invoice=mock/invoice.yaml

npx tsx index.ts --config=config.yaml --invoice=invoices/faktura-05.yaml

vystup:
- `faktura-05.isdoc`
- `faktura-05.pdf`
- `faktura-05-isdoc.pdf`

pozadavek:
- `qpdf` musi byt nainstalovany (kvuli vlozeni ISDOC do PDF)
- PDF pouziva font DejaVu Sans (kvuli UTF-8)

config.yaml:
- recipient muze byt vicenasobny pres `recipients` (mapa id -> firma); `recipient_id` v invoice vybere konkretniho, jinak se vezme prvni; pole `recipient` zustava pro zpetnou kompatibilitu
- `contact` blok pro kontaktni udaje (jmeno, adresa, email, telefon)

faktura.yaml polozky:
- `recipient_id` odkaz do `recipients`
- `md` + `md_rate` (puvodni varianta)
- `hr` + `hr_rate` (fakturace po hodinach)

```
