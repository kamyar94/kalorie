# Open Food Facts fixtures

- `product-3017620422003.json`: a live API v2 reply recorded on 31 Oct 2026
  (`GET /api/v2/product/3017620422003?fields=...`, the fields in `lib/food/off.ts`).
- `product-not-found.json`: the live reply for an all-zero code (`status: 0`, HTTP 200).
- An unknown but valid code gets HTTP 404 with `{"status": 0, "status_verbose": "product not found"}`
  (API documentation); the tests build that reply themselves.

Product data from Open Food Facts (openfoodfacts.org), available under the Open Database License
(ODbL 1.0); individual contents under the Database Contents License.
