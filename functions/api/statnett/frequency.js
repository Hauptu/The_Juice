export async function onRequestGet({ request }) {
  const now = new Date();

  // Standard: senaste 6 sekunderna. Dashboardens första anrop kan begära upp till 30 min historik.
  const u = new URL(request.url);
  const requestedFrom = u.searchParams.get("from");
  const requestedTo = u.searchParams.get("to");
  const to = requestedTo ? new Date(requestedTo) : now;
  const requestedFromDate = requestedFrom ? new Date(requestedFrom) : new Date(now.getTime() - 6000);
  const maxFrom = new Date(to.getTime() - 30*60*1000);
  const from = requestedFromDate < maxFrom ? maxFrom : requestedFromDate;

  if(!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to){
    return new Response(JSON.stringify({error:"Ogiltigt tidsintervall"}),{
      status:400,
      headers:{"content-type":"application/json; charset=utf-8"}
    });
  }

  const formatUTC = (date) =>
    date.toISOString().slice(0, 19) + "Z";

  // All dashboard users share the same short-lived upstream cache.
  // Normalize the requested window to a 5-second bucket so 10, 50 or 100
  // open dashboards do not each trigger their own Statnett request.
  const bucketMs = 5000;
  const bucketTo = new Date(Math.floor(to.getTime() / bucketMs) * bucketMs);
  const bucketFrom = new Date(bucketTo.getTime() - 30*60*1000);

  const url =
    "https://driftsdata.statnett.no/restapi/Frequency/BySecond" +
    "?From=" + encodeURIComponent(formatUTC(bucketFrom)) +
    "&To=" + encodeURIComponent(formatUTC(bucketTo));

  try {
    const r = await fetch(url, {
      headers: {
        "user-agent": "Krafthandel Dashboard"
      },
      cf: {
        cacheTtl: 5,
        cacheEverything: true
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