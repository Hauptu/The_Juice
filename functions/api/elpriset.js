export async function onRequestGet() {
  const now = new Date();
  const dates = [-1, 0, 1].map(d => {
    const x = new Date(now);
    x.setUTCDate(x.getUTCDate() + d);
    return x;
  });
  const areas = ["SE1", "SE2", "SE3", "SE4"];

  const jobs = [];
  for (const area of areas) {
    for (const d of dates) {
      const year = d.getUTCFullYear();
      const date = `${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
      const url = `https://www.elprisetjustnu.se/api/v1/prices/${year}/${date}_${area}.json`;
      jobs.push({ area, date: `${year}-${date}`, url });
    }
  }

  const responses = await Promise.all(jobs.map(async j => {
    try {
      const r = await fetch(j.url, { headers: { "user-agent": "Krafthandel Dashboard" } });
      if (!r.ok) return { ...j, ok: false };
      return { ...j, ok: true, data: await r.json() };
    } catch {
      return { ...j, ok: false };
    }
  }));

  const data = {};
  for (const area of areas) {
    const rows = [];
    const seen = new Set();
    for (const r of responses.filter(x => x.area === area && x.ok)) {
      for (const row of (Array.isArray(r.data) ? r.data : [r.data])) {
        const key = String(row?.time_start ?? "");
        if (key && !seen.has(key)) {
          seen.add(key);
          rows.push(row);
        }
      }
    }
    rows.sort((a,b) => new Date(a.time_start) - new Date(b.time_start));
    data[area] = { prices: rows, dates: [...new Set(responses.filter(x=>x.area===area && x.ok).map(x=>x.date))], count: rows.length, errors: [] };
  }

  return new Response(JSON.stringify({
    generatedAt: new Date().toISOString(),
    data
  }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=60"
    }
  });
}
