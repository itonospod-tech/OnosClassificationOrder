# Clone legacy OnosPod — product catalog area: survey and gap table

> Source: read-only survey of `app.onospod.com` on 01/10/2026 (screens `/items/*-preset`,
> `/category/preset`, `/product-technique/preset`, `/product-material/preset`,
> `/product-tag/preset`, `/product-labels`, product detail `/items/preset/<code>`).
> SKU reconciliation against the 203 production ProductConfigs was done by the coordinator.
> Definition of "clone" = parity of CAPABILITY, not of screens (`LegacyClone-Spec.md` §1).

## 1. Four findings that change earlier assumptions

1. **The six "Items" groups are Collections, not technical product types.** The detail page has two
   separate fields: `Collection` (3D Products / 2D Products / Dropship Products …) and `Manufacture` (factory).
2. **Grabink is a FACTORY** (menu "MFT Grabink"), not a product type. Its 9 products are plain tees
   (Bella+Canvas, Gildan; SKUs `WT-*`, `YT-*`, `UT-*`, `HG-*`, `SW-*`), collection "2D Products", print method DTG.
   (The page counter "All 17" counts the whole 2D collection; only 9 cards are listed.)
3. **Dropship is a sourcing/selling mode**: 11 bought-in NFL/jersey products (`DROP-0001…0011`), factory Mê Linh.
4. **The legacy system has no LED or Canvas line.** Exactly one LED product exists (`4L-WDLED-SIGN`, inside
   the wood group). So an empty `led` / `canvas` `productLine` in the new system is CORRECT, not missing data.
   "Handmade Wood" is really a laser-cut group (wood + acrylic + sticker + stained glass); the new label is
   "Gỗ & cắt khắc" / "Wood & laser cut" (enum `wood` unchanged).

## 2. Real numbers

| Legacy group | Legacy products | New system (prod, 01/10) | Missing |
|---|---|---|---|
| 3D | 158 | 169 | – |
| 2D (incl. Grabink 9) | 17 | 15 | – (Grabink 9/9 present) |
| Embroidery | 12 | 12 | – |
| Handmade Wood | 34 | 3 (`2L-WDSIGN-3MM`, `1L-MICA-SUN-3MM`, `STICKER`) | **31** |
| Dropship | 11 | 0 | **11** |

**42 products missing = running data, not missing screens**: wood orders land in "unmapped factory".
Cause: `import-from-onospod` was last verified on 05/08 (178 products); the unfiltered query now returns
221 rows (x-total 232). The 11 dropship rows are NOT returned by the unfiltered query — they need
`collection:"dropship"`. Fix shipped in commit 54605cb (collection parameter + `productLine` set on new
products from the collection; dropship deliberately not run: no target product line yet).
After importing, the 31 wood products still need dragging into factory TNW (`/adm/settings/product-factory`).

## 3. Gap table

| Legacy screen | New system | Verdict | Work | Effort |
|---|---|---|---|---|
| `/items/{3d,2d,grabink,embroidery,dropship,handmade-wood}-preset` — card grid: image, "Starting from $x", name, SKU, badges (category / DTF / EMB), "Hide product for seller", Un-group, REMOVE, CLONE; left rail "Product type" (All / Apparel / All Over Print / Gift & Accessories / Home & Decorations / Face Mask / Canvas & Poster / Jewelry, with counts); search box. **No default filter** (opens as ALL). | `/adm/products` + `productLine` filter | ADD | Category rail with counts, Clone product, "hidden from seller" badge, Un-group. Default filter in our version: `productLine` from the menu entry + status active | M |
| Product detail `/items/preset/<code>` — Manufacture, Collection, Group/Linked products, Name, Slug, SKU, Print Method (DTF/DTG/EMB), switches (show to seller / design check / affiliate), images, size chart, Colors, Sizes, availability flags (New/Featured/Best Seller/Handmade Wood), YouTube URL, Print Template, fulfilment template URL, Mockup template, Category, Tags, Techniques, Materials, shipping time (max production / max shipping), Variations & Price table (Colour, Size, SKU, Cost, EXP US/TIKTOK US, Non-Ship, Wholesale, EXP US $, TT US $, Package weight/W/H/L), "Calculate Prices" (calls OnosExpress — NOT pressed), "Create new mockup" | `Products.md` §2.4/§2.5 | ADD | Missing (to re-verify in code before building): Tags, Techniques, Materials, group/linked products, New/Featured/Best Seller flags, shipping time, wholesale / EXP US / TT US prices and per-variation package size, bulk price tool | L |
| `/category/preset` — 38 rows, 10/20/50/100 per page; Title, Image, Slug, Parent Category, Status, Created by | `ProductCategory` (Products.md §4) | KEEP if it has Parent/Slug/Image, else ADD | Check schema, import 38 rows | S |
| `/product-technique/preset` — 5 rows (UV, Embroidery, Applique Embroidery, Sublimation, Laser Cut); Title, Badge, Image, Slug, Status | none | BUILD (decision pending) | See §4 | S |
| `/product-material/preset` — 2 rows (Wooden, Polyester Bird Eye Mesh Fabric) | `fabric_type` (workshop_config) | ADD / merge | Map into `fabric_type` (recommended) or new table | S |
| `/product-tag/preset` — 18 rows (Wedding, Valentine, Christmas, Kids, Bestsellers, Signature Products …); same columns | none | **BUILD — approved** | New `product-tag` module, many tags per product | S–M |
| `/product-labels` — 2 rows of one seller, 18-digit code + CODE + owner email, EDIT/REMOVE | none | UNCLEAR | Do not build; likely dead or abandoned experiment | – |

## 3b. Tags, Techniques, Materials — real data (probed 04/10/2026 via the product query)

The legacy `productPreset` query exposes id arrays; names come from `productTags` / `productTechniques` / `productMaterials`.

| Field | Products carrying a value | Distinct values |
|---|---|---|
| `product_tag_ids` | 136 / 221 (dropship 0 / 11) | 18 (all resolve) |
| `product_technique_ids` | 123 / 221 | 4 of the 5 techniques |
| `product_material_ids` | 3 / 221 | 2 |

Tags and Techniques are BUILT (seed + catalog filter + fill-only import; Techniques added 04/10/2026).
**Materials is OUT of scope**: 3 of 221 products is noise, not data — a table + CRUD + import for 3 rows is a net loss.
If ever needed, map by hand into `fabric_type`.

## 4. Techniques vs `print_method`

Legacy products carry BOTH `Print Method` (DTF/DTG/EMB, three toggles) and `Technique` (e.g. Sublimation) as
independent fields.
- Option 1 — merge Technique into `print_method` (add UV / Sublimation / Laser Cut / Applique…): cheap, no new
  screen, but mixes "how it is printed" with "finishing technique".
- Option 2 — keep a separate Technique list (small CRUD + a field on the product): clean, matches legacy.
Leaning: option 2. **Not built** until compared on real data. Materials: likely map into `fabric_type` (decide after Tags).

## 5. Out of scope / not touched

"Calculate Prices" and all price inputs (external call), and any create/edit/delete on the legacy system.

## 6. Decision: `dropship` becomes the 7th `productLine` (04/10/2026)

- **Decision:** add `dropship` to `ProductLine` and import the 11 `DROP-*` products into it.
- **Why:** `productLine` is "the line the SELLER sees", unlike `printMethod` (workshop technique). In the legacy
  system Dropship is a seller-browsable Collection, level with 3D/2D/Embroidery. Filing bought-in jerseys under
  `2d`/`3d` would misstate what they are (they are not printed by any technique); leaving `productLine` empty would
  hide them from every product-line page, so importing them would be pointless.
- **Cost:** one enum value, reversible. Shared enum, labels (vi/en, `customerPortal` + `products` + `layout`),
  badge colour, seller icon; spec `product-line-i18n.spec.ts` fails if a line lacks a label.
- **Import:** `inferProductLine` maps collection `dropship` → `dropship` at the LOWEST priority, so no existing product
  changes line; `productLineForNew` therefore stamps new dropship products. The import must be called with
  `collection=dropship` (the unfiltered legacy query does not return them).
- **Not done here:** the staff sidebar's fixed line list (`Sidebar.tsx`) has no Dropship entry — owned by a2.
- **28 products without price on prod** (7 with no variations, 21 with only `-DEFAULT`) will get variations + prices
  from the legacy system on the next "Import từ OnosPod" — approved by the merger on 04/10/2026.
