# Tạp hóa Three-Column Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the patched Tạp hóa desktop visual layer with a fresh, stable three-column workspace while preserving existing sales/order/debt business behavior and backend authority.

**Architecture:** Build a new permanent desktop shell with `left | master | detail` slots and a fixed bottom `Bán | Đơn | Công nợ` nav. New focused view modules render directly into their owned slots and call existing GETLINK/Supabase APIs; they do not move DOM between columns or coordinate through broad MutationObservers. Mobile remains on the existing mobile implementation until separately redesigned.

**Tech Stack:** Static HTML/CSS/JavaScript, existing GETLINK global catalog data, existing Supabase Edge Functions (`getlink-api`, `getlink-orders`, `getlink-product-add`, `getlink-order-customer`), Python unittest contract tests, Node syntax checks, existing static build stamping.

**Spec:** `docs/superpowers/specs/2026-09-14-taphoa-three-column-workspace-design.md`

## Global Constraints

- Start implementation from current `main`; do not use `fix/order-source-left-owner` as the implementation base.
- Desktop three-column layout applies at `min-width: 1000px` only.
- Mobile remains a separate layout; no shrinking the desktop grid into mobile.
- Keep existing Supabase order/debt/customer/pricing authority unchanged.
- Do not introduce new customer-group, debt, pricing, or product-classification business rules.
- Tạp hóa hot interactions must not scan Siêu thị/Tin tức data.
- No cross-column DOM re-parenting after shell creation.
- No broad MutationObserver as a state manager.
- One native scroll owner per desktop column; workspace/body must not become the Tạp hóa content scroll owner.
- Keep `main` locked until the branch passes full Verify GETLINK and focused interaction contracts.

---

### Task 1: Introduce the permanent desktop shell and ownership contract

**Files:**
- Create: `taphoa-desktop-workspace.js`
- Create: `taphoa-desktop-workspace.css`
- Create: `tests/test_taphoa_desktop_workspace.py`
- Modify: `config.js`
- Modify: `tools/stamp_static_build.py`

**Interfaces:**
- Produces: `window.TaphoaDesktopWorkspace`
- Produces DOM ids: `taphoaDesktopWorkspace`, `taphoaLeftRail`, `taphoaMasterList`, `taphoaDetailPane`, `taphoaBottomNav`
- Produces: `TaphoaDesktopWorkspace.mount()`, `setView(view)`, `slots()`, `isActive()`

- [ ] **Step 1: Write the failing shell contract tests**

```python
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class TaphoaDesktopWorkspaceContract(unittest.TestCase):
    def test_shell_has_three_permanent_slots_and_bottom_nav(self):
        js = (ROOT / "taphoa-desktop-workspace.js").read_text("utf-8")
        for token in [
            "taphoaDesktopWorkspace",
            "taphoaLeftRail",
            "taphoaMasterList",
            "taphoaDetailPane",
            "taphoaBottomNav",
        ]:
            self.assertIn(token, js)

    def test_shell_does_not_use_mutation_observer_or_cross_column_reparenting(self):
        js = (ROOT / "taphoa-desktop-workspace.js").read_text("utf-8")
        self.assertNotIn("MutationObserver", js)
        self.assertNotIn("replaceChildren(fresh", js)

    def test_config_loads_new_workspace_assets(self):
        config = (ROOT / "config.js").read_text("utf-8")
        self.assertIn("taphoa-desktop-workspace.css", config)
        self.assertIn("taphoa-desktop-workspace.js", config)
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `python -m unittest tests.test_taphoa_desktop_workspace -v`

Expected: FAIL because the new files/assets do not exist yet.

- [ ] **Step 3: Implement the shell with stable node identity**

Create `taphoa-desktop-workspace.js` with this public shape:

```js
(()=>{
  "use strict";
  const VALID_VIEWS=new Set(["sales","orders","debts"]);
  let root=null;
  let currentView="sales";

  function mount(){
    if(root?.isConnected)return root;
    const host=document.querySelector(".user-work-desktop");
    if(!host||!matchMedia("(min-width:1000px)").matches)return null;
    root=document.createElement("section");
    root.id="taphoaDesktopWorkspace";
    root.dataset.view=currentView;
    root.innerHTML=`
      <aside id="taphoaLeftRail" class="taphoa-desktop-column taphoa-left-rail"></aside>
      <main id="taphoaMasterList" class="taphoa-desktop-column taphoa-master-list"></main>
      <aside id="taphoaDetailPane" class="taphoa-desktop-column taphoa-detail-pane"></aside>
      <nav id="taphoaBottomNav" class="taphoa-desktop-bottom-nav" aria-label="Tạp hóa">
        <button type="button" data-taphoa-view="sales">Bán</button>
        <button type="button" data-taphoa-view="orders">Đơn</button>
        <button type="button" data-taphoa-view="debts">Công nợ</button>
      </nav>`;
    host.appendChild(root);
    return root;
  }

  function setView(view){
    if(!VALID_VIEWS.has(view))return false;
    const node=mount();
    if(!node)return false;
    currentView=view;
    node.dataset.view=view;
    node.querySelectorAll("[data-taphoa-view]").forEach(button=>{
      const active=button.dataset.taphoaView===view;
      button.classList.toggle("active",active);
      button.setAttribute("aria-pressed",active?"true":"false");
    });
    document.dispatchEvent(new CustomEvent("taphoa-desktop-view-change",{detail:{view}}));
    return true;
  }

  function slots(){
    const node=mount();
    return node?{
      left:node.querySelector("#taphoaLeftRail"),
      master:node.querySelector("#taphoaMasterList"),
      detail:node.querySelector("#taphoaDetailPane"),
    }:null;
  }

  window.TaphoaDesktopWorkspace={mount,setView,slots,isActive:()=>Boolean(root?.isConnected),get view(){return currentView}};
})();
```

- [ ] **Step 4: Implement CSS geometry with one scroll owner per column**

`taphoa-desktop-workspace.css` must include:

```css
@media (min-width:1000px){
  #taphoaDesktopWorkspace{
    height:100%;
    min-height:0;
    display:grid;
    grid-template-columns:minmax(180px,220px) minmax(360px,1fr) minmax(380px,1.15fr);
    grid-template-rows:minmax(0,1fr) 48px;
    overflow:hidden;
  }
  #taphoaLeftRail,#taphoaMasterList,#taphoaDetailPane{
    min-width:0;
    min-height:0;
    overflow:auto;
    overscroll-behavior:contain;
  }
  #taphoaBottomNav{
    grid-column:1/-1;
    display:grid;
    grid-template-columns:repeat(3,1fr);
    position:relative;
    z-index:2;
  }
}
```

- [ ] **Step 5: Load assets and include them in build stamping**

Load `taphoa-desktop-workspace.css` before its JS, and include both in `ASSETS` and `version.json` payload generation in `tools/stamp_static_build.py`.

- [ ] **Step 6: Run tests, syntax, stamp**

Run:

```bash
python -m unittest tests.test_taphoa_desktop_workspace -v
node --check taphoa-desktop-workspace.js
python tools/stamp_static_build.py
python tools/stamp_static_build.py --check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add taphoa-desktop-workspace.js taphoa-desktop-workspace.css tests/test_taphoa_desktop_workspace.py config.js tools/stamp_static_build.py index.html version.json
git commit -m "feat: add stable Tạp hóa desktop shell"
```

---

### Task 2: Add a desktop-only data adapter and Tạp hóa RAM index

**Files:**
- Create: `taphoa-desktop-data.js`
- Modify: `config.js`
- Modify: `tools/stamp_static_build.py`
- Modify: `tests/test_taphoa_desktop_workspace.py`

**Interfaces:**
- Produces: `window.TaphoaDesktopData`
- Produces: `buildProductIndex(rows)`, `searchProducts(query, limit)`, `upsertProduct(row)`
- Produces: `readAuth()`, `orderRequest(path, options)`, `productAddRequest(payload)`
- Consumes: existing `window.GETLINK_API_BASE`, `window.GETLINK_API_KEY`, existing `libraryCache`, existing `isMineRow(row)` when available

- [ ] **Step 1: Add failing tests that Tạp hóa search uses its own index**

```python
def test_desktop_data_owns_taphoa_only_product_index(self):
    js=(ROOT / "taphoa-desktop-data.js").read_text("utf-8")
    self.assertIn("buildProductIndex",js)
    self.assertIn("searchProducts",js)
    self.assertIn("upsertProduct",js)
    self.assertNotIn("renderUserWorkHome",js)
    self.assertNotIn("fetchLibraryFromSupabase",js)
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `python -m unittest tests.test_taphoa_desktop_workspace -v`

- [ ] **Step 3: Implement RAM index with pre-normalized search keys**

Use one array of `{row,key}` entries built only from `isMineRow(row)`. `searchProducts(query, limit=80)` normalizes the query once, filters/ranks the pre-normalized keys, and returns original rows. `upsertProduct(row)` updates the index in place by stable URL/id key.

- [ ] **Step 4: Implement API/auth helpers without UI rendering**

`readAuth()` reads `getlink:chat-order-auth`. `orderRequest(path, options)` targets `GETLINK_API_BASE.replace(/\/getlink-api$/, "/getlink-orders")`. `productAddRequest(payload)` targets `.../getlink-product-add`. Both apply `apikey`, bearer token, and JSON headers exactly as the current order manager does.

- [ ] **Step 5: Load/stamp the new data adapter before view modules**

- [ ] **Step 6: Verify**

Run:

```bash
python -m unittest tests.test_taphoa_desktop_workspace -v
node --check taphoa-desktop-data.js
python tools/stamp_static_build.py --check
```

- [ ] **Step 7: Commit**

```bash
git add taphoa-desktop-data.js config.js tools/stamp_static_build.py tests/test_taphoa_desktop_workspace.py index.html version.json
git commit -m "feat: add Tạp hóa desktop data adapter"
```

---

### Task 3: Build Bán fresh into the three owned columns

**Files:**
- Create: `taphoa-desktop-sales.js`
- Modify: `taphoa-desktop-workspace.css`
- Modify: `config.js`
- Modify: `tools/stamp_static_build.py`
- Modify: `tests/test_taphoa_desktop_workspace.py`

**Interfaces:**
- Produces: `window.TaphoaDesktopSales.mount(slots)`, `activate()`, `deactivate()`
- Consumes: `TaphoaDesktopData.searchProducts`, `upsertProduct`, existing cart storage keys/helpers, existing product row data
- Renders directly: left=`Danh mục`; master=`Tìm kiếm + sản phẩm`; detail=`Khách + đơn đang lên`

- [ ] **Step 1: Add failing Bán ownership/performance contracts**

Assert that the module names the three slots, does not call `renderUserWorkHome`, does not reset `scrollTop`, and contains row-local quantity update functions.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement sales state**

Use one module-local state:

```js
const state={query:"",category:"all",quantities:new Map(),notes:new Map(),selectedCustomerId:""};
```

Hydrate quantity/note/customer state once when activating Bán. Do not parse all storage entries per `+/-` click.

- [ ] **Step 4: Render left categories directly into `taphoaLeftRail`**

No legacy category node re-parenting. Category click changes `state.category` and re-renders only master results.

- [ ] **Step 5: Render master search/results from the Tạp hóa RAM index**

Search input updates only master results. Infinite loading appends rows with `insertAdjacentHTML("beforeend", ...)`; it does not replace the list root.

- [ ] **Step 6: Implement row-local quantity and note updates**

A `+/-` click mutates only `state.quantities`, the clicked row quantity DOM, and detail counters/preview. It must not scan every product row.

- [ ] **Step 7: Implement manual add in the no-result state**

For Admin only, submit Tạp hóa name/source/price to `TaphoaDesktopData.productAddRequest()`, call `upsertProduct(data.product)`, then update current results. No catalog reload.

- [ ] **Step 8: Render current order preview in detail**

Show customer, explicit `N dòng · M sản phẩm`, line preview, total, and existing send/update/cancel behavior. Reuse backend business API behavior; do not change price authority.

- [ ] **Step 9: Verify Bán contracts and existing tests**

Run:

```bash
python -m unittest tests.test_taphoa_desktop_workspace -v
python -m unittest discover -s tests -v
node --check taphoa-desktop-sales.js
```

- [ ] **Step 10: Commit**

```bash
git add taphoa-desktop-sales.js taphoa-desktop-workspace.css config.js tools/stamp_static_build.py tests/test_taphoa_desktop_workspace.py index.html version.json
git commit -m "feat: rebuild Tạp hóa sales desktop view"
```

---

### Task 4: Build Đơn fresh with direct left/source ownership and local selection

**Files:**
- Create: `taphoa-desktop-orders.js`
- Modify: `taphoa-desktop-workspace.css`
- Modify: `config.js`
- Modify: `tools/stamp_static_build.py`
- Modify: `tests/test_taphoa_desktop_workspace.py`

**Interfaces:**
- Produces: `window.TaphoaDesktopOrders.mount(slots)`, `activate()`, `deactivate()`, `refresh()`
- Consumes: `TaphoaDesktopData.orderRequest()`
- Renders directly: left=`Theo nguồn`; master=`tabs/search/time + danh sách`; detail=`hóa đơn`

- [ ] **Step 1: Write failing ownership and click-hot-path tests**

Tests must assert:

```python
self.assertIn("renderSourceRail", orders_js)
self.assertIn("renderOrderList", orders_js)
self.assertIn("renderOrderDetail", orders_js)
self.assertNotIn("replaceWith", selection_block)
self.assertNotIn("replaceChildren", orders_js)
self.assertNotIn("MutationObserver", orders_js)
```

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement order state and one refresh path**

Use:

```js
const state={status:"pending",query:"",timePreset:"today",source:"",orders:[],selectedId:""};
```

Fetch orders once per explicit refresh/filter change; keep returned rows in module state.

- [ ] **Step 4: Render `Theo nguồn` directly into left rail**

Aggregate `state.orders` by source and render buttons directly in `taphoaLeftRail`. Source click filters master rows; nothing is moved from master to left.

- [ ] **Step 5: Render compact order master list**

Each row shows customer first, `STT N · Mã đơn #...`, status/date, and explicit `X dòng · Y sản phẩm`. Header contains status tabs and `Tìm kiếm | Hôm nay` on one desktop line.

- [ ] **Step 6: Implement local selection only**

`selectOrder(id)` changes `.selected`/`aria-pressed` on previous and next rows and calls `renderOrderDetail(id)`. It does not replace master row nodes and does not touch master `scrollTop`.

- [ ] **Step 7: Render invoice detail and existing actions**

Detail owns customer/date/code/item lines/total/actions. Sửa / Đã giao / Xóa and Admin đổi khách call existing order endpoints with current permission rules. Refresh only after a mutation actually changes server state.

- [ ] **Step 8: Add rapid-click regression contract**

Add a small browser-independent JS test or DOM fixture test that records row node identity before/after repeated `selectOrder()` calls and verifies the list node references remain identical.

- [ ] **Step 9: Verify**

Run full Python tests and Node checks for the new module.

- [ ] **Step 10: Commit**

```bash
git add taphoa-desktop-orders.js taphoa-desktop-workspace.css config.js tools/stamp_static_build.py tests/test_taphoa_desktop_workspace.py index.html version.json
git commit -m "feat: rebuild Tạp hóa orders desktop view"
```

---

### Task 5: Build Công nợ into the same shell

**Files:**
- Create: `taphoa-desktop-debts.js`
- Modify: `taphoa-desktop-workspace.css`
- Modify: `config.js`
- Modify: `tools/stamp_static_build.py`
- Modify: `tests/test_taphoa_desktop_workspace.py`

**Interfaces:**
- Produces: `window.TaphoaDesktopDebts.mount(slots)`, `activate()`, `deactivate()`, `refresh()`
- Consumes: existing `getlink-orders` debt endpoints through `TaphoaDesktopData.orderRequest()`
- Renders directly: left=`Khách hàng`; master=`timeline`; detail=`giao dịch/số dư`

- [ ] **Step 1: Write failing debt ownership tests**
- [ ] **Step 2: Verify RED**
- [ ] **Step 3: Implement customer/debt left rail**
- [ ] **Step 4: Implement master transaction/timeline list with one native scroll owner**
- [ ] **Step 5: Implement detail pane with running balance and `Dư nợ sau giao dịch`**
- [ ] **Step 6: Preserve existing permissions and mutation endpoints**
- [ ] **Step 7: Verify debt/backend contracts**
- [ ] **Step 8: Commit**

```bash
git add taphoa-desktop-debts.js taphoa-desktop-workspace.css config.js tools/stamp_static_build.py tests/test_taphoa_desktop_workspace.py index.html version.json
git commit -m "feat: rebuild Tạp hóa debt desktop view"
```

---

### Task 6: Wire view switching and disable legacy desktop visual owners

**Files:**
- Modify: `taphoa-desktop-workspace.js`
- Modify: `order-management.js`
- Modify: `taphoa-hot-path-runtime.js`
- Modify: `taphoa-workspace-feedback.js`
- Modify: `taphoa-hot-path-runtime.css`
- Modify: `taphoa-workspace-feedback.css`
- Modify: `tests/test_taphoa_desktop_workspace.py`

**Interfaces:**
- Consumes: `TaphoaDesktopSales`, `TaphoaDesktopOrders`, `TaphoaDesktopDebts`
- Produces one switch path: `activateView("sales"|"orders"|"debts")`

- [ ] **Step 1: Add failing tests for stable shell identity and legacy desktop suppression**

Tests assert that view switching does not recreate `taphoaDesktopWorkspace`, and that legacy desktop render hooks short-circuit when the new desktop shell is active while mobile paths remain available.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement `activateView(view)`**

Deactivate prior view, clear slot contents through their owners, call target view `activate()`, and update bottom-nav state. The shell node itself remains untouched.

- [ ] **Step 4: Gate legacy desktop layers**

At the start of old desktop-only Tạp hóa visual sync/render paths, return early when:

```js
window.TaphoaDesktopWorkspace?.isActive?.() && matchMedia("(min-width:1000px)").matches
```

Do not disable mobile behavior.

- [ ] **Step 5: Remove desktop source-moving/observer orchestration from active path**

The new desktop must not call `moveOrderSourceLeft`, broad feedback observer synchronization, or legacy order-workspace V2 DOM builders.

- [ ] **Step 6: Verify full suite and mobile contracts**

Run:

```bash
python -m unittest discover -s tests -v
node --check app.js
node --check order-management.js
node --check taphoa-desktop-workspace.js
node --check taphoa-desktop-data.js
node --check taphoa-desktop-sales.js
node --check taphoa-desktop-orders.js
node --check taphoa-desktop-debts.js
node --check taphoa-hot-path-runtime.js
node --check taphoa-workspace-feedback.js
```

- [ ] **Step 7: Commit**

```bash
git add taphoa-desktop-workspace.js order-management.js taphoa-hot-path-runtime.js taphoa-workspace-feedback.js taphoa-hot-path-runtime.css taphoa-workspace-feedback.css tests/test_taphoa_desktop_workspace.py
git commit -m "refactor: make new Tạp hóa desktop shell authoritative"
```

---

### Task 7: Lock scroll, rapid interaction, and search performance regressions

**Files:**
- Create: `tests/test_taphoa_desktop_hot_paths.mjs`
- Modify: `.github/workflows/verify.yml`
- Modify: `tests/test_taphoa_desktop_workspace.py`

**Interfaces:**
- Verifies: stable list node identity, independent scroll ownership, row-local quantity changes, Tạp hóa-only search index

- [ ] **Step 1: Add deterministic hot-path tests**

Cover:
- master list `scrollTop` unchanged by `selectOrder()`;
- repeated 20-order selections preserve list row nodes;
- repeated 20 `+` clicks update only target quantity state/counter;
- search calls `TaphoaDesktopData.searchProducts()` and never legacy full-workspace render;
- manual add calls `upsertProduct()` and never full catalog fetch.

- [ ] **Step 2: Add the hot-path test to Verify GETLINK**

Add:

```yaml
- run: node tests/test_taphoa_desktop_hot_paths.mjs
```

- [ ] **Step 3: Run focused and full CI-equivalent checks locally/runner**

Run all Python tests, all Node checks, Deno checks already present in workflow, and static build check.

- [ ] **Step 4: Commit**

```bash
git add tests/test_taphoa_desktop_hot_paths.mjs tests/test_taphoa_desktop_workspace.py .github/workflows/verify.yml
git commit -m "test: lock Tạp hóa desktop hot paths"
```

---

### Task 8: Remove obsolete desktop patch assets only after parity is green

**Files:**
- Modify: `config.js`
- Modify: `tools/stamp_static_build.py`
- Modify or remove desktop-only sections from: `taphoa-hot-path-runtime.js`, `taphoa-hot-path-runtime.css`, `taphoa-workspace-feedback.js`, `taphoa-workspace-feedback.css`, `taphoa-order-workspace-v2.css`
- Modify: `tests/test_taphoa_desktop_workspace.py`

**Interfaces:**
- Final desktop source of truth: `taphoa-desktop-*`
- Mobile may retain legacy helpers that are still required

- [ ] **Step 1: Add failing test that config no longer loads obsolete desktop-only asset when no mobile code depends on it**
- [ ] **Step 2: Prove which legacy files/functions still have mobile consumers before deletion**
- [ ] **Step 3: Remove only dead desktop visual layers; keep shared/mobile helpers**
- [ ] **Step 4: Restamp static build**
- [ ] **Step 5: Run full Verify GETLINK-equivalent suite**
- [ ] **Step 6: Open PR from implementation branch to `main`**
- [ ] **Step 7: Merge only after Verify GETLINK is fully green and production preview has passed these manual checks:**
  - Tạp hóa desktop shows three stable columns;
  - Bán search, rapid `+/-`, manual add feel immediate;
  - Đơn rapid selection updates only detail and never jumps master scroll;
  - `Theo nguồn` is present in left rail without delayed movement;
  - Công nợ maps correctly to three columns;
  - mobile Tạp hóa still behaves as before.

- [ ] **Step 8: Commit cleanup**

```bash
git add config.js tools/stamp_static_build.py taphoa-hot-path-runtime.js taphoa-hot-path-runtime.css taphoa-workspace-feedback.js taphoa-workspace-feedback.css taphoa-order-workspace-v2.css tests/test_taphoa_desktop_workspace.py index.html version.json
git commit -m "chore: retire obsolete Tạp hóa desktop patch layers"
```

## Plan self-review

- Spec coverage: shell, ownership, Bán, Đơn, Công nợ, Tạp hóa-only search, quantity hot path, order selection hot path, manual add, scroll owners, observer removal, mobile boundary, and legacy retirement are each covered by a task.
- Placeholder scan: no TBD/TODO placeholders are used. Task 8 explicitly requires evidence before deleting shared/mobile helpers rather than assuming they are dead.
- Interface consistency: all view modules consume `TaphoaDesktopWorkspace.slots()` and `TaphoaDesktopData`; the shell owns switching; no later task depends on an undefined cross-column DOM move.
