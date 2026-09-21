import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "app.js").read_text(encoding="utf-8")
ORDERS = (ROOT / "order-management.js").read_text(encoding="utf-8")
MOBILE = (ROOT / "taphoa-mobile-standard.js").read_text(encoding="utf-8")
EDGE = (ROOT / "supabase/functions/getlink-api/index.ts").read_text(encoding="utf-8")


class RuntimeRefreshStabilityTest(unittest.TestCase):
    def test_catalog_background_poll_is_not_hyperactive(self):
        self.assertIn("const CLASSIFICATION_CHECK_MS=15000;", APP)
        self.assertNotIn("const CLASSIFICATION_CHECK_MS=4000;", APP)

    def test_role_switch_reuses_role_specific_indexeddb_cache(self):
        self.assertIn("const cached=await readUiLibraryCache();", APP)
        self.assertIn("if(cached&&Array.isArray(cached.rows)&&cached.rows.length)", APP)
        self.assertIn('await setAppRole("admin",true);', APP)
        self.assertIn('previousRole==="admin"&&appRole==="user"', APP)

    def test_order_polling_is_bounded_but_focus_refresh_remains(self):
        self.assertIn("const ORDER_SYNC_MS=6000;", ORDERS)
        self.assertIn("const WORKSPACE_RECONCILE_MS=5000;", ORDERS)
        self.assertIn('window.addEventListener("focus",()=>{void checkRemoteRevision();});', ORDERS)

    def test_mobile_async_owner_reconcile_is_coalesced(self):
        self.assertIn("let asyncOwnerTimers=[];", MOBILE)
        self.assertIn("for(const timer of asyncOwnerTimers)window.clearTimeout(timer);", MOBILE)
        self.assertIn("},600)", MOBILE)
        self.assertNotIn("queueSync();queueSync(80);queueSync(320);queueSync(1000);", MOBILE)

    def test_auto_update_worker_cleans_stale_jobs_even_when_idle(self):
        self.assertIn("const staleJobsCleaned=await expireStaleJobs();", EDGE)
        self.assertIn('status:"idle",stale_jobs_cleaned:staleJobsCleaned', EDGE)
        self.assertIn("stale_jobs_cleaned:staleJobsCleaned", EDGE)


if __name__ == "__main__":
    unittest.main()
