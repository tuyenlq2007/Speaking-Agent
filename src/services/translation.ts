const TRANSLATION_ENDPOINT = "https://api.mymemory.translated.net/get";

interface TranslationResponse {
  responseData?: {
    translatedText?: string;
  };
  responseStatus?: number;
}

const translationCache = new Map<string, string>();

export async function translateToVietnamese(text: string, signal?: AbortSignal): Promise<string> {
  const source = text.trim();
  if (!source) return "";

  const cached = translationCache.get(source);
  if (cached) return cached;

  const url = new URL(TRANSLATION_ENDPOINT);
  url.searchParams.set("q", source);
  url.searchParams.set("langpair", "en|vi");

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Translation request failed (${response.status})`);

  const payload = await response.json() as TranslationResponse;
  const translation = payload.responseData?.translatedText?.trim();
  if (!translation || (payload.responseStatus && payload.responseStatus >= 400)) {
    throw new Error("Translation response did not contain translated text");
  }

  translationCache.set(source, translation);
  return translation;
}
