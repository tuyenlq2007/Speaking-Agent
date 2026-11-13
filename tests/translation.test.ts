import { afterEach, describe, expect, it, vi } from "vitest";
import { translateToVietnamese } from "../src/services/translation";

describe("translateToVietnamese", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requests an English to Vietnamese translation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      responseData: { translatedText: "Thời tiết hôm nay thật đẹp." },
      responseStatus: 200
    }), { status: 200 }));

    await expect(translateToVietnamese("The weather is lovely today.")).resolves.toBe("Thời tiết hôm nay thật đẹp.");
    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestedUrl.searchParams.get("q")).toBe("The weather is lovely today.");
    expect(requestedUrl.searchParams.get("langpair")).toBe("en|vi");
  });

  it("rejects an unsuccessful translation request", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 503 }));
    await expect(translateToVietnamese("Please try again.")).rejects.toThrow("503");
  });
});
