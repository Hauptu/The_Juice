export async function onRequestGet({ request, env }) {
  const token = env.ENTSOE_API_KEY;
  if (!token) return new Response(JSON.stringify({error:"ENTSO-E API-nyckel saknas i Cloudflare Secret."}), {
    status: 500, headers: {"content-type":"application/json; charset=utf-8"}
  });

  const u = new URL(request.url);
  const from = u.searchParams.get("from");
  const to = u.searchParams.get("to");
  if (!/^\d{12}$/.test(from || "") || !/^\d{12}$/.test(to || "")) {
    return new Response(JSON.stringify({error:"Ogiltigt tidsintervall"}), {
      status: 400, headers: {"content-type":"application/json; charset=utf-8"}
    });
  }

  const areas = {
    SE1: "10Y1001A1001A44P",
    SE2: "10Y1001A1001A45N",
    SE3: "10Y1001A1001A46L",
    SE4: "10Y1001A1001A47J"
  };

  const results = await Promise.all(Object.entries(areas).map(async ([area,eic]) => {
    const url = new URL("https://web-api.tp.entsoe.eu/api");
    for (const [k,v] of Object.entries({
      documentType:"A84", businessType:"A97", processType:"A16",
      controlArea_Domain:eic, periodStart:from, periodEnd:to, securityToken:token
    })) url.searchParams.set(k,v);
    try {
      const r = await fetch(url, { headers: { "user-agent": "Krafthandel Dashboard", "accept":"application/xml,text/xml,*/*" }});
      return r.ok ? [area, await r.text(), null] : [area, null, `HTTP ${r.status}`];
    } catch (e) {
      return [area, null, String(e?.message || e)];
    }
  }));

  const data = {}, errors = {};
  for (const [area,body,error] of results) {
    if (body) data[area] = body;
    else errors[area] = error;
  }

  if (!Object.keys(data).length) return new Response(JSON.stringify({error:"ENTSO-E kunde inte returnera data.",areas:errors}), {
    status: 502, headers: {"content-type":"application/json; charset=utf-8"}
  });

  const out = {generatedAt:new Date().toISOString(), data};
  if (Object.keys(errors).length) out.errors = errors;
  return new Response(JSON.stringify(out), {
    headers: {
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store"
    }
  });
}
