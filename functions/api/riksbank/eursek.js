export async function onRequestGet({ request }) {
  const json = (body, status = 200, extraHeaders = {}) => new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=21600",
      ...extraHeaders
    }
  });

  // Use a stable cache key so client-side cache-busting does not trigger a new
  // Riksbank request on every dashboard refresh.
  const cache = caches.default;
  const cacheUrl = new URL("/api/riksbank/eursek-daily-cache", request.url);
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const upstream = await fetch("https://api.riksbank.se/swea/v1/Observations/Latest/sekeurpmi, {
      headers: { "accept": "application/json" },
    });
    if (!upstream.ok) throw new Error("Riksbanken HTTP " + upstream.status);
    const payload = await upstream.json();

    const candidates = [];
    const walk = value => {
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
        return;
      }
      if (!value || typeof value !== "object") return;
      const entries = Object.entries(value);
      const dateEntry = entries.find(([key, v]) => /^(date|observationdate|period|datum)$/i.test(key) && typeof v === "string");
      const valueEntry = entries.find(([key, v]) => /^(value|observation|rate|valueofobservation)$/i.test(key) && (typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)))));
      if (dateEntry && valueEntry) {
        const rate = Number(valueEntry[1]);
        if (Number.isFinite(rate) && rate > 5 && rate < 30) {
          candidates.push({ date: dateEntry[1], rate });
        }
      }
      for (const [, child] of entries) {
        if (child && typeof child === "object") walk(child);
      }
    };
    walk(payload);
    candidates.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const latest = candidates[0];
    if (!latest) throw new Error("Kunde inte hitta en giltig EUR/SEK-notering i Riksbankens svar.");

    const response = json({
      pair: "EUR/SEK",
      eurSek: latest.rate,
      date: latest.date,
      source: "Sveriges riksbank",
      fetchedAt: new Date().toISOString()
    });
    response.headers.set("cache-control", "public, max-age=300, s-maxage=86400");
    await cache.put(cacheKey, response.clone());
    return response;
  } catch (error) {
    return json({
      error: "Kunde inte hämta EUR/SEK från Riksbanken.",
      details: String(error?.message || error)
    }, 502);
  }
}
