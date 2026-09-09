import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CSS = (ROOT / "style.css").read_text(encoding="utf-8")


class V44OrderGeometryContractTest(unittest.TestCase):
    def test_header_and_rows_share_one_column_template(self):
        self.assertIn("--work-order-columns:", CSS)
        shared = re.search(
            r"\.user-work-order-head,\s*\.user-work-order-row\s*\{[^}]*"
            r"grid-template-columns\s*:\s*var\(--work-order-columns\)",
            CSS,
            re.S,
        )
        self.assertIsNotNone(
            shared,
            "V44 header and rows must consume the same column template",
        )

    def test_product_column_absorbs_resize_before_numeric_columns(self):
        template = re.search(
            r"--work-order-columns\s*:\s*([^;]+);",
            CSS,
        )
        self.assertIsNotNone(template)
        value = template.group(1)
        self.assertRegex(value, r"minmax\([^,]+,\s*1fr\)")
        self.assertIn("var(--work-col-carton)", value)
        self.assertIn("var(--work-col-retail)", value)
        self.assertIn("var(--work-col-qty)", value)
        self.assertIn("var(--work-col-bargain)", value)
        self.assertNotRegex(
            value,
            r"minmax\([^)]*var\(--work-col-(?:carton|retail|qty|bargain)\)",
            "Numeric/action columns must not fluid-shrink independently of the product column",
        )

    def test_order_compaction_uses_parent_container_not_viewport(self):
        self.assertRegex(
            CSS,
            r"\.user-work-mine\s*\{[^}]*container-type\s*:\s*inline-size",
        )
        self.assertRegex(CSS, r"@container\s+user-work-order\s*\(max-width:")
        self.assertNotIn(".user-work-order-row{min-width:720px}", CSS)


if __name__ == "__main__":
    unittest.main()
