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
- **Import:** `inferProductLine` checks collection `dropship` LAST among the collections, but the whole collection
  step still sits ABOVE factory / machine type / printMethod / default (`product-line-migration.ts:19-49`). So: a
  product carrying `dropship` *plus* another collection keeps its old line, while a product whose only collection is
  `dropship` now resolves to `dropship` instead of `wood` (factory TNW) / `embroidery` (printMethod emb) / `3d`
  (default). Existing products are protected by the backfill picking only an empty `productLine`, by
  `productLineSource='manual'`, and by the one-time flag `PRD-8:product_line_backfill_v1` — **not** by the priority
  order. The risk only materialises if that flag is cleared and the backfill re-run. The spec does not pin this
  ordering (it only tests `productLineForNew('dropship')`). `productLineForNew` stamps new dropship products. The
  import must be called with `collection=dropship` (the unfiltered legacy query does not return them).
- **Not done here:** the staff sidebar's fixed line list (`Sidebar.tsx`) has no Dropship entry — owned by a2.
- **28 products without price on prod** (7 with no variations, 21 with only `<base>-DEFAULT`) — measured 04/10/2026,
  **not re-checked since**. The earlier claim that the next "Import từ OnosPod" would price them is **WRONG**:
  the import is fill-only PER FIELD, and `variations` is only filled when the array is empty
  (`onospod-product-import.service.ts:535`, `isEmptyValue` at `:184` returns false for a one-element array). So the
  21 products that already hold a `-DEFAULT` variation will **never** be priced by this import. Worse,
  `ensureDefaultVariations` (`:585-621`) runs at the END of every import and creates `-DEFAULT` for anything still
  empty, so each run makes the next run less able to fill. To actually price them, delete the `-DEFAULT` variations
  first or change the fill rule. The 7 with no variations are only filled if OnosPod returns variations for them in
  that same run, before `ensureDefaultVariations` fires.
- **"Fill-only" is not side-effect free:** `mapProduct` calls `resolveCollectionId`/`resolveCategoryId` for every
  product including the ones it skips, and those CREATE Collection / ProductCategory rows by name. Two other import
  paths overwrite by design: `importProductConfigs` (`:844`) and `importFullProducts` (`:924`) replace
  `factoryId`, `machineTypeId`, the whole `collectionIds` array, and variation prices merged by SKU. `importFull`
  accepts `productLine` in its DTO and silently ignores it.
