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