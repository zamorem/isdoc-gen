# instalace
(vyzaduje nodejs)

```
npm i
```

spusteni
```

npx tsx index.ts --config=mock/config.yaml --invoice=mock/invoice.yaml

npx tsx index.ts --config=config.yaml --invoice=invoices/faktura-05.yaml
qpdf "faktura-14.pdf" --add-attachment "faktura-14.isdoc" -- "faktura-14-isdoc.pdf"

config.yaml:
- recipient muze byt vicenasobny pres `recipients` (mapa id -> firma); `recipient_id` v invoice vybere konkretniho, jinak se vezme prvni; pole `recipient` zustava pro zpetnou kompatibilitu

faktura.yaml polozky:
- `recipient_id` odkaz do `recipients`
- `md` + `md_rate` (puvodni varianta)
- `hr` + `hr_rate` (fakturace po hodinach)

```
