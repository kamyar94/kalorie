// Barcode helpers (GTIN: EAN-8, UPC-A, EAN-13, GTIN-14). Plain functions, safe for client code,
// for example to check a scanned code before asking the server.

/** Digits of a GTIN (EAN-8, UPC-A, EAN-13, GTIN-14), or null. Spaces and dashes are ignored. */
export const normalizeBarcode = (value: string) => {
  const digits = String(value ?? "").replace(/[\s-]/g, "");
  return /^\d{8}$|^\d{12,14}$/.test(digits) ? digits : null;
};

/** The GS1 check digit is right (a misread digit almost always breaks it). */
export const isValidGtin = (digits: string) => {
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false;
  let sum = 0;
  for (let i = digits.length - 2, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3)
    sum += Number(digits[i]) * weight;
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
};
