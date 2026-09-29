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

  // ENTSO-E returns A85 imbalance-price documents as ZIP archives in
  // some responses. Extract the XML without adding a third-party runtime
  // dependency; Cloudflare Workers expose DecompressionStream.
  async function unzipXml(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u32 = o => view.getUint32(o, true);
    const u16 = o => view.getUint16(o, true);
    const sig = u32(0);

    // Raw XML response.
    if (sig !== 0x04034b50 && sig !== 0x06054b50 && sig !== 0x02014b50) {
      return new TextDecoder().decode(bytes);
    }

    // Find end-of-central-directory record from the end of the file.
    let eocd = -1;
    const min = Math.max(0, bytes.length - 65557);
    for (let i = bytes.length - 22; i >= min; i--) {
      if (i >= 0 && u32(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw Error("ENTSO-E A85: ZIP-slutpost saknas");

    const cdSize = u32(eocd + 12);
    const cdOffset = u32(eocd + 16);
    let p = cdOffset;
    const entries = [];

    while (p < cdOffset + cdSize && u32(p) === 0x02014b50) {
      const method = u16(p + 10);
      const compressedSize = u32(p + 20);
      const nameLen = u16(p + 28);
      const extraLen = u16(p + 30);
      const commentLen = u16(p + 32);
      const localOffset = u32(p + 42);
      const name = new TextDecoder().decode(bytes.slice(p + 46, p + 46 + nameLen));
      entries.push({method, compressedSize, name, localOffset});
      p += 46 + nameLen + extraLen + commentLen;
    }

    for (const entry of entries) {
      if (!/\.xml$/i.test(entry.name)) continue;
      const o = entry.localOffset;
      if (u32(o) !== 0x04034b50) continue;
      const nameLen = u16(o + 26);
      const extraLen = u16(o + 28);
      const start = o + 30 + nameLen + extraLen;
      const compressed = bytes.slice(start, start + entry.compressedSize);

      if (entry.method === 0) {
        return new TextDecoder().decode(compressed);
      }
      if (entry.method === 8) {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        const plain = new Uint8Array(await new Response(stream).arrayBuffer());
        return new TextDecoder().decode(plain);
      }
      throw Error("ENTSO-E A85: okänd ZIP-komprimering");
    }

    throw Error("ENTSO-E A85: ingen XML-fil i ZIP-svaret");
  }

  async function fetchArea(area, eic) {
    const mfrrUrl = new URL("https://web-api.tp.entsoe.eu/api");
    for (const [k,v] of Object.entries({
      documentType:"A84", businessType:"A97", processType:"A16",
      controlArea_Domain:eic, periodStart:from, periodEnd:to, securityToken:token
    })) mfrrUrl.searchParams.set(k,v);

    const imbalanceUrl = new URL("https://web-api.tp.entsoe.eu/api");
    for (const [k,v] of Object.entries({
      documentType:"A85",
      controlArea_Domain:eic, periodStart:from, periodEnd:to, securityToken:token
    })) imbalanceUrl.searchParams.set(k,v);

    const headers = {
      "user-agent":"Krafthandel Dashboard",
      "accept":"application/xml,text/xml,application/zip,*/*"
    };

    const out = {area, mfrr:null, imbalance:null, mfrrError:null, imbalanceError:null};

    try {
      const r = await fetch(mfrrUrl, {headers});
      out.mfrr = r.ok ? await r.text() : null;
      if (!r.ok) out.mfrrError = `HTTP ${r.status}`;
    } catch (e) {
      out.mfrrError = String(e?.message || e);
    }

    try {
      const r = await fetch(imbalanceUrl, {headers});
      out.imbalance = r.ok ? await unzipXml(await r.arrayBuffer()) : null;
      if (!r.ok) out.imbalanceError = `HTTP ${r.status}`;
    } catch (e) {
      out.imbalanceError = String(e?.message || e);
    }

    return out;
  }

  const results = await Promise.all(
    Object.entries(areas).map(([area,eic]) => fetchArea(area,eic))
  );

  const data = {};
  const errors = {};
  const imbalance = {};
  const imbalanceErrors = {};

  for (const row of results) {
    if (row.mfrr) data[row.area] = row.mfrr;
    else errors[row.area] = row.mfrrError || "mFRR-data saknas";

    if (row.imbalance) imbalance[row.area] = row.imbalance;
    else imbalanceErrors[row.area] = row.imbalanceError || "obalanspris saknas";
  }

  if (!Object.keys(data).length) {
    return new Response(JSON.stringify({
      error:"ENTSO-E kunde inte returnera mFRR-data.",
      areas:errors,
      imbalanceErrors
    }), {
      status:502, headers:{"content-type":"application/json; charset=utf-8"}
    });
  }

  const out = {generatedAt:new Date().toISOString(), data, imbalance};
  if (Object.keys(errors).length) out.errors = errors;
  if (Object.keys(imbalanceErrors).length) out.imbalanceErrors = imbalanceErrors;

  return new Response(JSON.stringify(out), {
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store"
    }
  });
}
