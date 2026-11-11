import { describe, expect, it } from "vitest";

import { cn } from "./cn";

describe("cn", () => {
  it("keeps a colour next to a size from Kal's type scale", () => {
    expect(cn("text-on-primary", "text-headline")).toBe("text-on-primary text-headline");
    expect(cn("text-caption", "text-label")).toBe("text-label");
    expect(cn("text-muted", "text-danger")).toBe("text-danger");
  });
});
