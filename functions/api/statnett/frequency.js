export async function onRequestGet({ request }) {
  const now = new Date();

  // Hämta de senaste 6 sekunderna från Statnett
  const to = now;
  const from = new Date(now.getTime() - 6000);

  const formatUTC = (date) =>
    date.toISOString().slice(0, 19) + "Z";

  const url =
    "https://driftsdata.statnett.no/restapi/Frequency/BySecond" +
    "?From=" + encodeURIComponent(formatUTC(from)) +
    "&To=" + encodeURIComponent(formatUTC(to));

  try {
    const r = await fetch(url, {
      headers: {
        "user-agent": "Krafthandel Dashboard"
      },
      cf: {
        cacheTtl: 0,
        cacheEverything: false
      }
    });

    if (!r.ok) {
      return new Response(
        JSON.stringify({
          error: "Statnett HTTP " + r.status
        }),
        {
          status: 502,
          headers: {
            "content-type": "application/json; charset=utf-8"
          }
        }
      );
    }

    const body = await r.text();

    return new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    });

  } catch (e) {
    return new Response(
      JSON.stringify({
        error: String(e?.message || e)
      }),
      {
        status: 502,
        headers: {
          "content-type": "application/json; charset=utf-8"
        }
      }
    );
  }
}