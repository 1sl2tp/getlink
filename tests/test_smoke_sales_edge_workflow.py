from pathlib import Path
import unittest


WORKFLOW = Path(".github/workflows/smoke-supabase.yml").read_text(encoding="utf-8")


class SmokeSalesEdgeWorkflowTests(unittest.TestCase):
    def test_sales_edge_sources_trigger_smoke(self):
        for path in (
            "supabase/functions/getlink-orders/**",
            "supabase/functions/getlink-product-add/**",
            "supabase/functions/getlink-order-customer/**",
        ):
            with self.subTest(path=path):
                self.assertIn(f'- "{path}"', WORKFLOW)

    def test_runtime_smoke_probes_all_sales_edges(self):
        self.assertIn('FUNCTIONS="${API%/getlink-api}"', WORKFLOW)
        self.assertIn('probe_edge "getlink-orders"', WORKFLOW)
        self.assertIn('probe_edge "getlink-product-add"', WORKFLOW)
        self.assertIn('probe_edge "getlink-order-customer"', WORKFLOW)
        self.assertIn('-X OPTIONS', WORKFLOW)
        self.assertIn('test "$CODE" = "204"', WORKFLOW)


if __name__ == "__main__":
    unittest.main()
