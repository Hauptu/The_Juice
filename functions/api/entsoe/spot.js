export async function onRequestGet({ env }) {
  const token = env.ENTSOE_API_KEY;
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=60"
    }
  });

  if (!token) return json({ error: "ENTSO-E API-nyckel saknas i Cloudflare Secret." }, 500);

  const areas = {
    SE1: "10Y1001A1001A44P",
    SE2: "10Y1001A1001A45N",
    SE3: "10Y1001A1001A46L",
    SE4: "10Y1001A1001A47J"
  };

  // Hämta gårdagen till tre dagar framåt så att aktuell period och publicerade
  // day-ahead-priser täcks även runt dygnsskiften. Tiderna skickas i UTC.
  const now = new Date();
  const fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const toDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 3));
  const stamp = d => d.getUTCFullYear().toString()
    + String(d.getUTCMonth() + 1).padStart(2, "0")
    + String(d.getUTCDate()).padStart(2, "0")
    + String(d.getUTCHours()).padStart(2, "0")
    + String(d.getUTCMinutes()).padStart(2, "0");
  const periodStart = stamp(fromDate);
  const periodEnd = stamp(toDate);

  function parsePrices(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) throw Error("Ogiltigt XML-svar från ENTSO-E.");
    const reason = doc.getElementsByTagNameNS("*", "Reason")[0];
    if (reason) {
      const message = reason.getElementsByTagNameNS("*", "text")[0]?.textContent;
      throw Error(message || "ENTSO-E returnerade ett API-fel.");
    }

    const rows = [];
    for (const series of Array.from(doc.getElementsByTagNameNS("*", "TimeSeries"))) {
      for (const period of Array.from(series.getElementsByTagNameNS("*", "Period"))) {
        const interval = period.getElementsByTagNameNS("*", "timeInterval")[0];
        const startText = interval?.getElementsByTagNameNS("*", "start")[0]?.textContent;
        const periodStartMs = Date.parse(startText || "");
        if (!Number.isFinite(periodStartMs)) continue;

        const resolution = period.getElementsByTagNameNS("*", "resolution")[0]?.textContent || "";
        const stepMs = ({
          PT15M: 15 * 60 * 1000,
          PT30M: 30 * 60 * 1000,
          PT60M: 60 * 60 * 1000,
          PT1H: 60 * 60 * 1000
        })[resolution];
        if (!stepMs) throw Error("Okänd upplösning från ENTSO-E: " + resolution);

        for (const point of Array.from(period.getElementsByTagNameNS("*", "Point"))) {
          const position = Number(point.getElementsByTagNameNS("*", "position")[0]?.textContent);
          const price = Number(point.getElementsByTagNameNS("*", "price.amount")[0]?.textContent);
          if (!Number.isInteger(position) || position < 1 || !Number.isFinite(price)) continue;
          const start = new Date(periodStartMs + (position - 1) * stepMs);
          const end = new Date(start.getTime() + stepMs);
          rows.push({
            time_start: start.toISOString(),
            time_end: end.toISOString(),
            EUR_per_MWh: price
          });
        }
      }
    }

    const unique = new Map();
    for (const row of rows) unique.set(row.time_start, row);
    return Array.from(unique.values()).sort((a, b) => Date.parse(a.time_start) - Date.parse(b.time_start));
  }

  const results = await Promise.all(Object.entries(areas).map(async ([area, eic]) => {
    const url = new URL("https://web-api.tp.entsoe.eu/api");
    for (const [key, value] of Object.entries({
      documentType: "A44",
      in_Domain: eic,
      out_Domain: eic,
      periodStart,
      periodEnd,
      securityToken: token
    })) url.searchParams.set(key, value);

    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "The Juice Dashboard",
          "accept": "application/xml,text/xml,*/*"
        },
        cf: { cacheTtl: 300, cacheEverything: true }
      });
      const body = await response.text();
      if (!response.ok) throw Error("ENTSO-E HTTP " + response.status + (body ? ": " + body.slice(0, 180) : ""));
      const prices = parsePrices(body);
      if (!prices.length) throw Error("Inga day-ahead-priser returnerades.");
      return [area, { prices, count: prices.length, errors: [] }];
    } catch (error) {
      return [area, { prices: [], count: 0, errors: [String(error?.message || error)] }];
    }
  }));

  const data = Object.fromEntries(results);
  const successful = Object.values(data).some(area => area.prices.length > 0);
  if (!successful) {
    return json({
      error: "ENTSO-E kunde inte returnera day-ahead-priser.",
      areas: Object.fromEntries(Object.entries(data).map(([area, value]) => [area, value.errors]))
    }, 502);
  }

  return json({ generatedAt: new Date().toISOString(), data });
}
