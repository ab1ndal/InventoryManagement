# Attributes Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A superadmin "Attributes" subtab under the Admin hub to curate color-family assignment, fabric multi-family assignment, and the size vocabulary.

**Architecture:** New nested-tab surface in `AdminPage.jsx` with three managers (Colors, Fabrics, Sizes) that read/write the `colors`/`color_families`/`fabrics`/`sizes` tables directly via the Supabase client. Fabric moves from a single `family` column to `families text[]` (mirroring colors); family membership is edited with a reusable chip-toggle. Pure family-index logic is extracted to a tested utility shared by the storefront filter hook and the admin managers.

**Tech Stack:** React 19 (CRA), Supabase JS, shadcn/ui (Table, Input, Button, Tabs), Jest (react-scripts test) for pure-logic units.

## Global Constraints

- Supabase is a single shared project (no local DB). Applying a migration touches production immediately.
- `code` is a PK and FK target (`productsizecolors`, `mockup_variations`, `productimages`) — the manager NEVER renames or deletes a code. Add-new stays in the existing `Add*Dialog` flows.
- Attributes subtab is **superadmin-only** (`AdminPage.jsx` `isSuperAdmin` gate).
- Colors: family-level hex only (`color_families.hex`); never per-color hex.
- `size_type` is one of exactly: `letter`, `waist`, `kids`, `kids_letter`, `special`.
- Match existing admin style: `toast` from `../../components/hooks/use-toast`, shadcn Table, optimistic update + revert on error.
- Build must be warning-clean (Vercel CI fails on ESLint warnings).

## Release coordination (READ BEFORE APPLYING MIGRATIONS)

Three migrations. The fabric change is **split** so dev and prod stay safe on the
single shared Supabase (add early, drop at release):

1. `migration_attributes_manager_rls.sql` (Task 1) — **additive, safe**. Adds
   `UPDATE` policies only. Apply **early**. Nothing breaks.
2. `migration_fabric_families_add.sql` (Task 8a) — **additive, safe**. Adds
   `families[]` + backfills, **keeps `family`**. Apply **early** (right after
   Task 1) so all fabric-reading app code (Tasks 4-7) is testable against a live
   `families[]` column while `family` still exists for any old reader.
3. `migration_fabric_drop_family.sql` (Task 8b) — **breaking**. `drop column
   family`. The instant it applies, any build still reading `fabrics.family`
   breaks. Apply it at the release: **deploy the families[]-only build → drop
   family.** By then no code reads `family`, so there is no broken window.

---

## Task 1: Additive RLS migration (UPDATE policies)

**Files:**
- Create: `schema/migration_attributes_manager_rls.sql`

**Interfaces:**
- Produces: `authenticated UPDATE` on `colors`, `color_families`, `fabrics`, `sizes`.

Confirmed via `pg_policies`: these four tables currently have SELECT + INSERT
policies only — no UPDATE. The managers need UPDATE to write metadata.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- migration_attributes_manager_rls.sql
-- Attributes manager (app-layer). Adds authenticated UPDATE policies so the
-- superadmin Attributes subtab can edit attribute metadata:
--   colors.families[]           (assign filter families to a color)
--   color_families.hex/order    (edit swatch, reorder, rename via add only)
--   fabrics.families[]          (assign filter families to a fabric)
--   sizes.label/type/inches/ord (curate the size vocabulary)
-- Additive and safe: no schema change, SELECT/INSERT policies untouched.
-- Idempotent (drop-if-exists then create) so re-apply is harmless.
-- ============================================================================

begin;

drop policy if exists "authenticated update colors" on colors;
create policy "authenticated update colors"
  on colors for update to authenticated using (true) with check (true);

drop policy if exists "authenticated update color_families" on color_families;
create policy "authenticated update color_families"
  on color_families for update to authenticated using (true) with check (true);

drop policy if exists "authenticated update fabrics" on fabrics;
create policy "authenticated update fabrics"
  on fabrics for update to authenticated using (true) with check (true);

drop policy if exists "authenticated update sizes" on sizes;
create policy "authenticated update sizes"
  on sizes for update to authenticated using (true) with check (true);

commit;
```

- [ ] **Step 2: Apply to prod**

Run:
```bash
supabase db query --linked "$(cat schema/migration_attributes_manager_rls.sql)"
```
Expected: no error; commits.

- [ ] **Step 3: Verify policies exist**

Run:
```bash
supabase db query --linked "select tablename, cmd from pg_policies where tablename in ('colors','color_families','fabrics','sizes') and cmd='UPDATE' order by tablename;"
```
Expected: 4 rows (color_families, colors, fabrics, sizes).

- [ ] **Step 4: Commit**

```bash
git add schema/migration_attributes_manager_rls.sql
git commit -m "Attributes manager: authenticated UPDATE RLS on colors/fabrics/sizes"
```

---

## Task 2: Shared family-index utility (pure, tested)

**Files:**
- Create: `src/utility/attributeFamilies.js`
- Test: `src/utility/__tests__/attributeFamilies.test.js`

**Interfaces:**
- Produces:
  - `buildFamilyIndex(rows: {code, families}[]) => { familyToCodes, codeToFamilies, orderedFamilies }`
  - `toggleInArray(arr: string[], val: string) => string[]`

- [ ] **Step 1: Write the failing test**

```js
import { buildFamilyIndex, toggleInArray } from "../attributeFamilies";

describe("buildFamilyIndex", () => {
  test("maps codes to families and families to codes", () => {
    const { familyToCodes, codeToFamilies } = buildFamilyIndex([
      { code: "Navy", families: ["Blue"] },
      { code: "Peacock", families: ["Blue", "Green"] },
    ]);
    expect([...familyToCodes.Blue].sort()).toEqual(["Navy", "Peacock"]);
    expect(familyToCodes.Green).toEqual(["Peacock"]);
    expect(codeToFamilies.Peacock).toEqual(["Blue", "Green"]);
  });

  test("orders families by member count desc, then name asc", () => {
    const { orderedFamilies } = buildFamilyIndex([
      { code: "a", families: ["Blue"] },
      { code: "b", families: ["Blue"] },
      { code: "c", families: ["Green"] },
      { code: "d", families: ["Amber"] },
    ]);
    expect(orderedFamilies).toEqual(["Blue", "Amber", "Green"]);
  });

  test("handles unassigned (empty families) codes", () => {
    const { codeToFamilies, orderedFamilies } = buildFamilyIndex([
      { code: "Cotton", families: [] },
      { code: "Silk", families: null },
    ]);
    expect(codeToFamilies.Cotton).toEqual([]);
    expect(codeToFamilies.Silk).toEqual([]);
    expect(orderedFamilies).toEqual([]);
  });
});

describe("toggleInArray", () => {
  test("adds when absent", () => {
    expect([...toggleInArray(["Blue"], "Green")].sort()).toEqual(["Blue", "Green"]);
  });
  test("removes when present", () => {
    expect(toggleInArray(["Blue", "Green"], "Blue")).toEqual(["Green"]);
  });
  test("treats null/undefined as empty", () => {
    expect(toggleInArray(null, "Blue")).toEqual(["Blue"]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `CI=true npx react-scripts test src/utility/__tests__/attributeFamilies.test.js`
Expected: FAIL — "Cannot find module '../attributeFamilies'".

- [ ] **Step 3: Write the implementation**

```js
// Pure helpers for families[]-based attribute vocabularies (colors, fabrics).
// A "row" is { code: string, families: string[] }.

// Build family<->code maps from attribute rows. orderedFamilies is sorted by
// member-code count desc, then name asc — used where no family table drives
// display order (fabric). Colors override order from color_families.sort_order.
export function buildFamilyIndex(rows) {
  const familyToCodes = {};
  const codeToFamilies = {};
  (rows || []).forEach(({ code, families }) => {
    const fams = families || [];
    codeToFamilies[code] = fams;
    fams.forEach((f) => (familyToCodes[f] ||= []).push(code));
  });
  const orderedFamilies = Object.keys(familyToCodes).sort(
    (a, b) =>
      familyToCodes[b].length - familyToCodes[a].length || a.localeCompare(b)
  );
  return { familyToCodes, codeToFamilies, orderedFamilies };
}

// Immutable chip toggle: add val if absent, remove if present.
export function toggleInArray(arr, val) {
  const set = new Set(arr || []);
  set.has(val) ? set.delete(val) : set.add(val);
  return [...set];
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `CI=true npx react-scripts test src/utility/__tests__/attributeFamilies.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/utility/attributeFamilies.js src/utility/__tests__/attributeFamilies.test.js
git commit -m "Attributes manager: shared family-index utility (buildFamilyIndex, toggleInArray)"
```

---

## Task 3: Reusable FamilyChips component

**Files:**
- Create: `src/admin/components/attributes/FamilyChips.js`

**Interfaces:**
- Consumes: nothing (leaf component).
- Produces: `FamilyChips({ families: string[], selected: string[], onToggle: (family)=>void, hexMap? })` default export.

- [ ] **Step 1: Write the component**

```jsx
import React from "react";

// Family membership toggle: each family is a clickable chip; selected chips are
// filled. Optional hexMap renders a swatch dot (colors). Shared by the attribute
// managers and AddFabricDialog. Presentational only — parent owns state.
export default function FamilyChips({ families, selected, onToggle, hexMap }) {
  const sel = new Set(selected || []);
  return (
    <div className="flex flex-wrap gap-1.5">
      {families.map((f) => {
        const on = sel.has(f);
        return (
          <button
            key={f}
            type="button"
            onClick={() => onToggle(f)}
            aria-pressed={on}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${
              on
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
            }`}
          >
            {hexMap && (
              <span
                className="h-2.5 w-2.5 rounded-full border border-black/10"
                style={{ background: hexMap[f] || "transparent" }}
              />
            )}
            {f}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles (build check deferred)**

No standalone test (presentational). Verified when a manager renders it in Task 6/7. Proceed.

- [ ] **Step 3: Commit**

```bash
git add src/admin/components/attributes/FamilyChips.js
git commit -m "Attributes manager: reusable FamilyChips toggle component"
```

---

## Task 4: Storefront fabric filter → families[]

**Files:**
- Modify: `src/storefront/hooks/useShopFilters.js` (lines 18-21, 106, 133, 143, 195-215; add import)

**Interfaces:**
- Consumes: `buildFamilyIndex` from `src/utility/attributeFamilies.js` (Task 2).
- Note: reads `fabrics.families` — runtime-verifiable once Task 8a is applied (additive add+backfill). Logic is unit-covered via Task 2.

- [ ] **Step 1: Add the import**

At the top of `src/storefront/hooks/useShopFilters.js`, after existing imports:

```js
import { buildFamilyIndex } from "../../utility/attributeFamilies";
```

- [ ] **Step 2: Dedup fabricCodesFor (multi-family codes can repeat)**

Replace the `fabricCodesFor` function (lines 18-21):

```js
function fabricCodesFor(families, familyToCodes) {
  const codes = [...new Set(families.flatMap((f) => familyToCodes[f] || []))];
  return codes.length ? codes : ["__no_match__"];
}
```

- [ ] **Step 3: Availability maps code → its families (was single family)**

In `fetchAvailableOptionsFromDB`, replace the `fabrics` set (lines 104-108):

```js
    fabrics: new Set(
      (fabRows.data || [])
        .flatMap((r) => fabricIndex.codeToFamilies[r.fabric] || [])
        .filter(Boolean)
    ),
```

- [ ] **Step 4: Update the fabric ref shape**

Change the ref init (line 133):

```js
  const fabricIndexRef = useRef({ familyToCodes: {}, codeToFamilies: {} });
```

- [ ] **Step 5: Load families[] and build the index**

Change the fabrics select (line 143) from `.select("code, family, sort_order").order("sort_order")` to:

```js
        supabase.from("fabrics").select("code, families"),
```

Replace the fabric-index build block (lines 195-215) with:

```js
      if (fabrics.data) {
        // Multi-family: a fabric code lists 1..n families. Shared index builder;
        // the filter lists families ordered by member-code count (proxy volume).
        const { familyToCodes, codeToFamilies, orderedFamilies } =
          buildFamilyIndex(fabrics.data);
        fabricIndexRef.current = { familyToCodes, codeToFamilies };
        setFabricOptions(orderedFamilies);
      }
```

- [ ] **Step 6: Run the storefront tests**

Run: `CI=true npx react-scripts test src/storefront/__tests__/`
Expected: PASS (CartDrawer.test.jsx may fail pre-existing on react-router-dom module resolution — unrelated, documented in project memory). No NEW failures.

- [ ] **Step 7: Build check**

Run: `CI=true npm run build`
Expected: compiles warning-clean.

- [ ] **Step 8: Commit**

```bash
git add src/storefront/hooks/useShopFilters.js
git commit -m "Storefront: fabric filter reads fabrics.families[] (multi-family)"
```

---

## Task 5: AddFabricDialog → families[] multi-select

**Files:**
- Modify: `src/admin/components/AddFabricDialog.js`

**Interfaces:**
- Consumes: `FamilyChips` (Task 3), `toggleInArray` + `buildFamilyIndex` (Task 2), `existingFabrics: {code, families}[]` from `ProductEditDialog`.
- Produces: inserts `fabrics { code, families, sort_order }`.

Owner decision: no `fabric_families` table — the family vocabulary is the set of
distinct families already present, plus any new name typed here.

- [ ] **Step 1: Rewrite the dialog**

Replace the whole file with:

```jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import FamilyChips from "./attributes/FamilyChips";
import { supabase } from "../../lib/supabaseClient";
import { useToast } from "../../components/hooks/use-toast";
import { buildFamilyIndex, toggleInArray } from "../../utility/attributeFamilies";

// Deliberate add-new flow for fabric codes (mirrors AddSizeDialog). A fabric is
// a trade name (code) filed under one or more filter families ("Group Name").
// The family vocabulary is derived from existing fabrics; a brand-new family can
// be introduced by typing it below.
export default function AddFabricDialog({
  open,
  initialCode,
  existingFabrics = [],
  onClose,
  onAdded,
}) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [families, setFamilies] = useState([]);
  const [newFamily, setNewFamily] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCode(initialCode || "");
      setFamilies([]);
      setNewFamily("");
    }
  }, [open, initialCode]);

  const familyOptions = useMemo(() => {
    const { orderedFamilies } = buildFamilyIndex(existingFabrics);
    // Include any just-typed family so its chip shows as selected.
    return [...new Set([...orderedFamilies, ...families])];
  }, [existingFabrics, families]);

  const addTypedFamily = () => {
    const f = newFamily.trim();
    if (!f) return;
    setFamilies((prev) => (prev.includes(f) ? prev : [...prev, f]));
    setNewFamily("");
  };

  const handleAdd = async () => {
    const trimmed = code.trim();
    if (!trimmed || families.length === 0) return;

    const existing = existingFabrics.find(
      (f) => f.code.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) {
      onAdded(existing.code);
      onClose();
      return;
    }

    // Place the new code after the current max sort_order (order is secondary
    // now that families drive the storefront grouping).
    const sortOrder =
      Math.max(0, ...existingFabrics.map((f) => f.sort_order || 0)) + 1;

    setSaving(true);
    const { error } = await supabase.from("fabrics").insert({
      code: trimmed,
      families,
      sort_order: sortOrder,
    });
    setSaving(false);

    // 23505 = another admin added the same code concurrently — select theirs
    if (error && error.code !== "23505") {
      toast({
        variant: "destructive",
        title: "Could not add fabric",
        description: error.message,
      });
      return;
    }

    toast({ title: "Fabric added", description: `“${trimmed}” is now available.` });
    onAdded(trimmed);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add New Fabric</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Fabric name</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. Organza Silk"
              className="mt-1"
            />
          </div>
          <div>
            <Label>Families (filter groups)</Label>
            <div className="mt-1.5">
              <FamilyChips
                families={familyOptions}
                selected={families}
                onToggle={(f) => setFamilies((prev) => toggleInArray(prev, f))}
              />
            </div>
            <div className="mt-2 flex gap-2">
              <Input
                value={newFamily}
                onChange={(e) => setNewFamily(e.target.value)}
                placeholder="New family…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTypedFamily();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addTypedFamily}>
                Add
              </Button>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleAdd}
              disabled={saving || !code.trim() || families.length === 0}
            >
              {saving ? "Adding…" : "Add Fabric"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: ProductEditDialog fabric select → families**

`src/admin/components/ProductEditDialog.js:112` currently reads
`.select("code, family, sort_order")`. After Task 8 drops `fabrics.family`, that
select errors (Supabase rejects a dropped column), and AddFabricDialog needs
`families` to derive its vocabulary. Change line 112:

```js
      .select("code, families, sort_order")
```

The fabric combobox itself uses only `code`/`sort_order`, so no other change in
this file. (`family` was previously unused by the combobox display.)

- [ ] **Step 3: Build check**

Run: `CI=true npm run build`
Expected: warning-clean.

- [ ] **Step 4: Commit**

```bash
git add src/admin/components/AddFabricDialog.js src/admin/components/ProductEditDialog.js
git commit -m "Admin: AddFabricDialog writes fabrics.families[] (multi-family)"
```

---

## Task 6: The three manager components

**Files:**
- Create: `src/admin/components/attributes/ColorsManager.js`
- Create: `src/admin/components/attributes/FabricsManager.js`
- Create: `src/admin/components/attributes/SizesManager.js`
- Modify: `src/admin/components/AddSizeDialog.js` (export `SIZE_TYPES`)

**Interfaces:**
- Consumes: `FamilyChips` (Task 3), `toggleInArray`/`buildFamilyIndex` (Task 2), `SIZE_TYPES` (this task).
- Produces: three default-export components rendered by `AttributesTab` (Task 7).

- [ ] **Step 1: Export SIZE_TYPES from AddSizeDialog**

In `src/admin/components/AddSizeDialog.js`, change `const SIZE_TYPES = [` to
`export const SIZE_TYPES = [` (keep the existing array contents unchanged).

- [ ] **Step 2: Write ColorsManager**

```jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useToast } from "../../../components/hooks/use-toast";
import { Input } from "../../../components/ui/input";
import { Button } from "../../../components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "../../../components/ui/table";
import FamilyChips from "./FamilyChips";
import { toggleInArray } from "../../../utility/attributeFamilies";

// Assign filter families to color codes + curate the color_families vocabulary.
// New colors (added via AddColorDialog) arrive with empty families[] and are
// invisible to the storefront filter until bucketed here.
export default function ColorsManager() {
  const { toast } = useToast();
  const [colors, setColors] = useState([]);      // {code, families}
  const [families, setFamilies] = useState([]);   // {family, hex, sort_order}
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [newFamily, setNewFamily] = useState("");
  const [newHex, setNewHex] = useState("#888888");

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    const [c, f] = await Promise.all([
      supabase.from("colors").select("code, families").order("code"),
      supabase.from("color_families").select("family, hex, sort_order").order("sort_order"),
    ]);
    if (c.error || f.error) {
      toast({ variant: "destructive", title: "Load failed", description: (c.error || f.error).message });
    } else {
      setColors(c.data); setFamilies(f.data);
    }
    setLoading(false);
  }

  const familyNames = useMemo(() => families.map((f) => f.family), [families]);
  const hexMap = useMemo(
    () => Object.fromEntries(families.map((f) => [f.family, f.hex])),
    [families]
  );

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return colors.filter((c) => {
      if (unassignedOnly && (c.families?.length ?? 0) > 0) return false;
      if (q && !c.code.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [colors, search, unassignedOnly]);

  const unassignedCount = useMemo(
    () => colors.filter((c) => (c.families?.length ?? 0) === 0).length,
    [colors]
  );

  async function toggleFamily(code, fam) {
    const row = colors.find((c) => c.code === code);
    const prevFamilies = row.families || [];
    const next = toggleInArray(prevFamilies, fam);
    setColors((prev) => prev.map((c) => (c.code === code ? { ...c, families: next } : c)));
    const { error } = await supabase.from("colors").update({ families: next }).eq("code", code);
    if (error) {
      setColors((prev) => prev.map((c) => (c.code === code ? { ...c, families: prevFamilies } : c)));
      toast({ variant: "destructive", title: "Update failed", description: error.message });
    }
  }

  async function updateHex(family, hex) {
    setFamilies((prev) => prev.map((f) => (f.family === family ? { ...f, hex } : f)));
    const { error } = await supabase.from("color_families").update({ hex }).eq("family", family);
    if (error) toast({ variant: "destructive", title: "Hex update failed", description: error.message });
  }

  async function addFamily() {
    const name = newFamily.trim();
    if (!name) return;
    const sort = Math.max(0, ...families.map((f) => f.sort_order || 0)) + 10;
    const { error } = await supabase
      .from("color_families")
      .insert({ family: name, hex: newHex, sort_order: sort });
    if (error) {
      toast({ variant: "destructive", title: "Could not add family", description: error.message });
      return;
    }
    setNewFamily("");
    toast({ title: "Family added", description: `“${name}” is now a filter group.` });
    load();
  }

  if (loading) {
    return (
      <div className="h-48 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-4 border-blue-600 border-opacity-50" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Families vocabulary */}
      <div className="rounded-md border p-4">
        <h3 className="text-sm font-semibold mb-3">Color families (swatch hex + order)</h3>
        <div className="flex flex-wrap gap-3">
          {families.map((f) => (
            <div key={f.family} className="flex items-center gap-2 text-sm">
              <input
                type="color"
                value={f.hex || "#000000"}
                onChange={(e) => updateHex(f.family, e.target.value)}
                className="h-6 w-6 rounded border p-0"
                title={`Edit ${f.family} hex`}
              />
              <span>{f.family}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <input
            type="color"
            value={newHex}
            onChange={(e) => setNewHex(e.target.value)}
            className="h-8 w-8 rounded border p-0"
          />
          <Input
            value={newFamily}
            onChange={(e) => setNewFamily(e.target.value)}
            placeholder="New family name…"
            className="max-w-xs"
          />
          <Button type="button" variant="outline" onClick={addFamily}>Add family</Button>
        </div>
      </div>

      {/* Codes */}
      <div className="flex items-center gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search colors…"
          className="max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={unassignedOnly}
            onChange={(e) => setUnassignedOnly(e.target.checked)}
          />
          Show unassigned only
          <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-medium">
            {unassignedCount}
          </span>
        </label>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-48">Color</TableHead>
              <TableHead>Families</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((c) => (
              <TableRow key={c.code}>
                <TableCell className="font-medium">{c.code}</TableCell>
                <TableCell>
                  <FamilyChips
                    families={familyNames}
                    selected={c.families || []}
                    onToggle={(fam) => toggleFamily(c.code, fam)}
                    hexMap={hexMap}
                  />
                </TableCell>
              </TableRow>
            ))}
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={2} className="text-center text-gray-400 py-8">
                  No colors match.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write FabricsManager**

```jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useToast } from "../../../components/hooks/use-toast";
import { Input } from "../../../components/ui/input";
import { Button } from "../../../components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "../../../components/ui/table";
import FamilyChips from "./FamilyChips";
import { buildFamilyIndex, toggleInArray } from "../../../utility/attributeFamilies";

// Assign filter families to fabric codes. Vocabulary is derived from the
// families already in use; a new family is introduced by typing it below.
export default function FabricsManager() {
  const { toast } = useToast();
  const [fabrics, setFabrics] = useState([]);   // {code, families}
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [newFamily, setNewFamily] = useState("");

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("fabrics")
      .select("code, families")
      .order("code");
    if (error) {
      toast({ variant: "destructive", title: "Load failed", description: error.message });
    } else {
      setFabrics(data);
    }
    setLoading(false);
  }

  const familyNames = useMemo(() => {
    const { orderedFamilies } = buildFamilyIndex(fabrics);
    return [...new Set([...orderedFamilies, ...(newFamily.trim() ? [newFamily.trim()] : [])])];
  }, [fabrics, newFamily]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return fabrics.filter((f) => !q || f.code.toLowerCase().includes(q));
  }, [fabrics, search]);

  async function toggleFamily(code, fam) {
    const row = fabrics.find((f) => f.code === code);
    const prevFamilies = row.families || [];
    const next = toggleInArray(prevFamilies, fam);
    setFabrics((prev) => prev.map((f) => (f.code === code ? { ...f, families: next } : f)));
    const { error } = await supabase.from("fabrics").update({ families: next }).eq("code", code);
    if (error) {
      setFabrics((prev) => prev.map((f) => (f.code === code ? { ...f, families: prevFamilies } : f)));
      toast({ variant: "destructive", title: "Update failed", description: error.message });
    }
  }

  if (loading) {
    return (
      <div className="h-48 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-4 border-blue-600 border-opacity-50" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search fabrics…"
          className="max-w-xs"
        />
        <Input
          value={newFamily}
          onChange={(e) => setNewFamily(e.target.value)}
          placeholder="New family (then toggle it onto a fabric)…"
          className="max-w-xs"
        />
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-56">Fabric</TableHead>
              <TableHead>Families</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((f) => (
              <TableRow key={f.code}>
                <TableCell className="font-medium">{f.code}</TableCell>
                <TableCell>
                  <FamilyChips
                    families={familyNames}
                    selected={f.families || []}
                    onToggle={(fam) => toggleFamily(f.code, fam)}
                  />
                </TableCell>
              </TableRow>
            ))}
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={2} className="text-center text-gray-400 py-8">
                  No fabrics match.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write SizesManager**

```jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useToast } from "../../../components/hooks/use-toast";
import { Input } from "../../../components/ui/input";
import CustomDropdown from "../../../components/CustomDropdown";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "../../../components/ui/table";
import { SIZE_TYPES } from "../AddSizeDialog";

// Curate the size vocabulary: edit label, type, inches, sort order per code.
// Code is the FK-protected PK — read-only here; add new via AddSizeDialog.
export default function SizesManager() {
  const { toast } = useToast();
  const [sizes, setSizes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("sizes")
      .select("code, label, size_type, numeric_in, sort_order")
      .order("sort_order");
    if (error) {
      toast({ variant: "destructive", title: "Load failed", description: error.message });
    } else {
      setSizes(data);
    }
    setLoading(false);
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sizes.filter((s) => !q || s.code.toLowerCase().includes(q));
  }, [sizes, search]);

  // Optimistic patch of one field; revert both state and DB on error.
  async function patch(code, field, value) {
    const row = sizes.find((s) => s.code === code);
    const prevValue = row[field];
    setSizes((prev) => prev.map((s) => (s.code === code ? { ...s, [field]: value } : s)));
    const { error } = await supabase.from("sizes").update({ [field]: value }).eq("code", code);
    if (error) {
      setSizes((prev) => prev.map((s) => (s.code === code ? { ...s, [field]: prevValue } : s)));
      toast({ variant: "destructive", title: "Update failed", description: error.message });
    }
  }

  if (loading) {
    return (
      <div className="h-48 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-4 border-blue-600 border-opacity-50" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search sizes…"
        className="max-w-xs"
      />
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Code</TableHead>
              <TableHead>Label</TableHead>
              <TableHead className="w-56">Type</TableHead>
              <TableHead className="w-24">Inches</TableHead>
              <TableHead className="w-24">Order</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((s) => (
              <TableRow key={s.code}>
                <TableCell className="font-medium">{s.code}</TableCell>
                <TableCell>
                  <Input
                    defaultValue={s.label}
                    onBlur={(e) => e.target.value !== s.label && patch(s.code, "label", e.target.value)}
                  />
                </TableCell>
                <TableCell>
                  <CustomDropdown
                    value={s.size_type}
                    onChange={(v) => patch(s.code, "size_type", v)}
                    options={SIZE_TYPES}
                    placeholder="Type"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    defaultValue={s.numeric_in ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      if (v !== s.numeric_in) patch(s.code, "numeric_in", v);
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    defaultValue={s.sort_order}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v !== s.sort_order) patch(s.code, "sort_order", v);
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Build check**

Run: `CI=true npm run build`
Expected: warning-clean. (Managers not yet routed — imported in Task 7.)

- [ ] **Step 6: Commit**

```bash
git add src/admin/components/attributes/ColorsManager.js \
        src/admin/components/attributes/FabricsManager.js \
        src/admin/components/attributes/SizesManager.js \
        src/admin/components/AddSizeDialog.js
git commit -m "Attributes manager: Colors/Fabrics/Sizes manager components"
```

---

## Task 7: AttributesTab + wire into AdminPage (superadmin subtab)

**Files:**
- Create: `src/admin/components/attributes/AttributesTab.js`
- Modify: `src/admin/pages/AdminPage.jsx`

**Interfaces:**
- Consumes: the three managers (Task 6).
- Produces: an `Attributes` subtab visible to superadmins only.

- [ ] **Step 1: Write AttributesTab (nested tabs)**

```jsx
import React from "react";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "../../../components/ui/tabs";
import ColorsManager from "./ColorsManager";
import FabricsManager from "./FabricsManager";
import SizesManager from "./SizesManager";

// Nested Colors/Fabrics/Sizes managers, rendered inside the Admin hub's
// superadmin-only "Attributes" subtab.
export default function AttributesTab() {
  return (
    <Tabs defaultValue="colors">
      <TabsList>
        <TabsTrigger value="colors">Colors</TabsTrigger>
        <TabsTrigger value="fabrics">Fabrics</TabsTrigger>
        <TabsTrigger value="sizes">Sizes</TabsTrigger>
      </TabsList>
      <TabsContent value="colors"><ColorsManager /></TabsContent>
      <TabsContent value="fabrics"><FabricsManager /></TabsContent>
      <TabsContent value="sizes"><SizesManager /></TabsContent>
    </Tabs>
  );
}
```

- [ ] **Step 2: Import AttributesTab in AdminPage**

In `src/admin/pages/AdminPage.jsx`, add after the `SalespersonsPage` import:

```js
import AttributesTab from "../components/attributes/AttributesTab";
```

- [ ] **Step 3: Add the superadmin TabsTrigger**

In the `TabsList` (after the `monthly-sales` trigger), add:

```jsx
          {isSuperAdmin && (
            <TabsTrigger value="attributes">Attributes</TabsTrigger>
          )}
```

- [ ] **Step 4: Add the TabsContent**

After the `monthly-sales` `TabsContent`, add:

```jsx
        {isSuperAdmin && (
          <TabsContent value="attributes">
            <AttributesTab />
          </TabsContent>
        )}
```

- [ ] **Step 5: Build check**

Run: `CI=true npm run build`
Expected: warning-clean.

- [ ] **Step 6: Manual verify Colors + Sizes (fabric migration not yet applied)**

Run `npm start`, log in as superadmin, open Admin → Attributes.
- Colors tab: "Show unassigned only" count matches new/empty colors; toggling a
  family chip persists across reload; editing a family hex persists.
- Sizes tab: editing label/inches/order persists across reload.
- As a plain admin, the Attributes subtab is absent.
(Fabrics tab will error until Task 8 — expected; verify it in Task 8.)

- [ ] **Step 7: Commit**

```bash
git add src/admin/components/attributes/AttributesTab.js src/admin/pages/AdminPage.jsx
git commit -m "Attributes manager: superadmin subtab in Admin hub"
```

---

## Task 8a: Fabric families[] — ADD + backfill (additive, apply EARLY)

**Files:**
- Create: `schema/migration_fabric_families_add.sql`

**Interfaces:**
- Produces: `fabrics.families text[]` backfilled from `family`; `family` retained.

**Additive and safe. Apply this right after Task 1** — before Tasks 4-7 so the
fabric-reading app code is testable against a live `families[]` column while
`family` still exists for any old reader.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- migration_fabric_families_add.sql
-- Fabric multi-family, part 1 of 2 (additive). Adds fabrics.families text[] and
-- backfills from the single family column, which is KEPT for now so old readers
-- keep working. The drop lives in migration_fabric_drop_family.sql, applied at
-- release once no code reads family. Owner decision: no fabric_families table —
-- the vocabulary is the set of distinct values in fabrics.families (app-derived).
-- ============================================================================

begin;

-- Backup (drop manually after owner sign-off)
create table _backup_fabrics_family_20260709 as
  select code, family, sort_order from fabrics;

-- Add the array column and backfill each code's single family as a 1-element array
alter table fabrics add column families text[] not null default '{}';
update fabrics set families = array[family];

-- Verify every backfilled row has exactly its one family, and every live
-- products.fabric still maps to a fabrics.code
do $$
declare bad int; unmapped int; bad_val text;
begin
  select count(*) into bad from fabrics where array_length(families,1) is distinct from 1;
  if bad > 0 then
    raise exception 'Fabric backfill error: % row(s) not exactly one family', bad;
  end if;
  select count(*), min(p.fabric) into unmapped, bad_val
  from products p left join fabrics f on f.code = p.fabric where f.code is null;
  if unmapped > 0 then
    raise exception 'Fabric mapping error: % product(s) have a fabric not in the lookup (e.g. "%")', unmapped, bad_val;
  end if;
end $$;

commit;
```

- [ ] **Step 2: Dry-run (rollback) against prod**

Run:
```bash
supabase db query --linked "$(sed 's/^commit;/rollback;/' schema/migration_fabric_families_add.sql)"
```
Expected: no exception (verify DO-block passes); rolls back.

- [ ] **Step 3: Apply for real (additive — safe)**

Run:
```bash
supabase db query --linked "$(cat schema/migration_fabric_families_add.sql)"
```
Expected: commits, no error.

- [ ] **Step 4: Verify backfill**

Run:
```bash
supabase db query --linked "select count(*) total, count(*) filter (where array_length(families,1) is null) empty from fabrics;"
```
Expected: `total` = fabric count (~92), `empty` = 0. (`family` column still present.)

- [ ] **Step 5: Commit**

```bash
git add schema/migration_fabric_families_add.sql
git commit -m "Fabric multi-family (add): fabrics.families[] backfilled, family kept"
```

---

## Task 8b: Fabric — DROP family (breaking, apply at RELEASE)

**Files:**
- Create: `schema/migration_fabric_drop_family.sql`

**Interfaces:**
- Consumes: Tasks 4, 5, 6, 7 shipped (no code reads `fabrics.family`).
- Produces: `fabrics.family` dropped.

**BREAKING. Apply only AFTER the families[]-only build is deployed** (Tasks 4-7
merged + deployed). By then no code reads `family`, so there is no broken window.

- [ ] **Step 1: Confirm no code reads fabrics.family**

Run:
```bash
grep -rn "\.family\b" src/ | grep -i fabric
grep -rn "family" src/storefront/hooks/useShopFilters.js src/admin/components/AddFabricDialog.js src/admin/components/ProductEditDialog.js
```
Expected: no reference to a singular `fabric.family` / `fabrics ... family`
select remains (only `families`). If any remain, fix before dropping.

- [ ] **Step 2: Write the migration**

```sql
-- ============================================================================
-- migration_fabric_drop_family.sql
-- Fabric multi-family, part 2 of 2 (breaking). Drops the now-unused single
-- family column. Apply only after the families[]-only build is deployed.
-- ============================================================================

begin;
alter table fabrics drop column family;
commit;
```

- [ ] **Step 3: Apply**

Run:
```bash
supabase db query --linked "$(cat schema/migration_fabric_drop_family.sql)"
```
Expected: commits, no error.

- [ ] **Step 4: Verify column gone**

Run:
```bash
supabase db query --linked "select column_name from information_schema.columns where table_name='fabrics' and column_name='family';"
```
Expected: 0 rows.

- [ ] **Step 5: Manual verify storefront + fabric manager (post-release)**

- Storefront `/shop`: fabric filter lists the same family groups and returns the
  same product sets as before.
- Admin → Attributes → Fabrics: loads, chips reflect backfilled families,
  toggling persists across reload.
- Add a fabric via ProductEditDialog's fabric combobox → AddFabricDialog
  multi-family chips → new code appears in FabricsManager with those families.

- [ ] **Step 6: Commit**

```bash
git add schema/migration_fabric_drop_family.sql
git commit -m "Fabric multi-family (drop): remove unused fabrics.family column"
```

---

## Task 9: Rebuild graphify graph + update memory

**Files:**
- Regenerated: `graphify-out/*`

- [ ] **Step 1: Rebuild the code graph**

Run:
```bash
/opt/homebrew/opt/python@3.10/bin/python3.10 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```
Expected: graph rebuilt without error.

- [ ] **Step 2: Update project memory**

Append to `project_attribute_normalization.md`: fabric now `families text[]`
(family column dropped, no fabric_families table, vocabulary derived); Attributes
superadmin subtab shipped (ColorsManager buckets empty-families colors,
FabricsManager, SizesManager); `attributeFamilies.js` shared util; UPDATE RLS on
the four tables. Note pending cleanup: drop `_backup_fabrics_family_20260709`.

- [ ] **Step 3: Commit**

```bash
git add graphify-out
git commit -m "Rebuild graphify graph for attributes manager"
```

---

## Self-Review

**Spec coverage:**
- Superadmin Attributes subtab under Admin hub → Task 7. ✓
- Colors: families[] assignment + color_families hex/order + unassigned filter → Task 6 (ColorsManager). ✓
- Fabrics: families[] migration split add(8a)/drop(8b), no table, + assignment → Tasks 8a, 8b, 6, 5, 4. ✓
- Sizes: edit label/type/inches/order, code immutable → Task 6 (SizesManager). ✓
- UPDATE RLS on the four tables → Task 1. ✓
- Storefront fabric families[] path → Task 4. ✓
- AddFabricDialog multi-family → Task 5. ✓
- Code immutable (no rename/delete) → honored (no delete/rename UI anywhere). ✓
- Release coordination for the breaking drop → Task 8 + top-of-plan note. ✓
- Shared tested pure logic → Task 2. ✓

**Placeholder scan:** No TBD/TODO; every code step has full code; commands have expected output. ✓

**Type consistency:** `buildFamilyIndex`→`{familyToCodes, codeToFamilies, orderedFamilies}` used identically in Tasks 2/4/5/6. `toggleInArray` signature consistent. `FamilyChips({families, selected, onToggle, hexMap})` matches all call sites (ColorsManager passes hexMap; Fabrics/AddFabric omit it — optional). `SIZE_TYPES` exported (Task 6 Step 1) before import in SizesManager. `fabricIndexRef` shape change (Task 4 Step 4) matches its reads (Steps 2-3). ✓

**Out-of-scope confirmed absent:** no per-color hex, no bulk import, no code rename/delete, no family rename, no fabric "unassigned" filter. ✓
