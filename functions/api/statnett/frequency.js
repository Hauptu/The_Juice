export async function onRequestGet({ request }) {
  const today = new Date().toISOString().slice(0, 10);
  const url = `https://driftsdata.statnett.no/restapi/Frequency/BySecond?From=${today}`;
  try {
    const r = await fetch(url, {
      headers: { "user-agent": "Krafthandel Dashboard" },
      cf: { cacheTtl: 4, cacheEverything: true }
    });
    if (!r.ok) return new Response(JSON.stringify({error:`Statnett HTTP ${r.status}`}), {
      status: 502, headers: {"content-type":"application/json; charset=utf-8"}
    });
    const body = await r.text();
    return new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=1, s-maxage=4"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({error:String(e?.message || e)}), {
      status: 502, headers: {"content-type":"application/json; charset=utf-8"}
    });
  }
}
