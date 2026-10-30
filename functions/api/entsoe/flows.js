const API = "https://web-api.tp.entsoe.eu/api";
const AREAS = {
  SE1:"10Y1001A1001A44P", SE2:"10Y1001A1001A45N",
  SE3:"10Y1001A1001A46L", SE4:"10Y1001A1001A47J",
  NO1:"10YNO-1--------2", NO2:"10YNO-2--------T",
  NO3:"10YNO-3--------J", NO4:"10YNO-4--------9",
  NO5:"10Y1001A1001A48H", FI:"10YFI-1--------U",
  DK1:"10YDK-1--------W", DK2:"10YDK-2--------M",
  DE_LU:"10Y1001A1001A82H", PL:"10YPL-AREA-----S",
  LT:"10YLT-1001A0008Q"
};

// One A11 request per bidding-zone border. Direction is defined by
// out_Domain -> in_Domain; the UI labels this explicitly.
const BORDERS = [
  ["SE1","SE2"],["SE2","SE3"],["SE3","SE4"],
  ["SE1","FI"],["SE1","NO4"],["SE2","NO3"],["SE2","NO4"],
  ["SE3","NO1"],["SE3","NO2"],["SE3","NO5"],
  ["SE4","DK1"],["SE4","DK2"],["SE4","PL"],["SE4","LT"],["SE4","DE_LU"]
];

function utcStamp(d) {
  return d.getUTCFullYear()+String(d.getUTCMonth()+1).padStart(2,"0")+
    String(d.getUTCDate()).padStart(2,"0")+String(d.getUTCHours()).padStart(2,"0")+
    String(d.getUTCMinutes()).padStart(2,"0");
}
function parseXml(xml, from, to) {
  const periods = [...xml.matchAll(/<Period>([\s\S]*?)<\/Period>/g)];
  let points = [];
  for (const period of periods) {
    const body = period[1];
    const start = body.match(/<start>([^<]+)<\/start>/)?.[1] || null;
    const resolution = body.match(/<resolution>([^<]+)<\/resolution>/)?.[1] || "PT60M";
    const step = resolution === "PT15M" ? 15 : resolution === "PT30M" ? 30 : 60;
    for (const p of body.matchAll(/<Point>([\s\S]*?)<\/Point>/g)) {
      const pos = Number(p[1].match(/<position>(\d+)<\/position>/)?.[1]);
      const value = Number(p[1].match(/<quantity>([-\d.]+)<\/quantity>/)?.[1]);
      if (Number.isFinite(pos) && Number.isFinite(value) && start) {
        const t = new Date(start);
        t.setUTCMinutes(t.getUTCMinutes()+(pos-1)*step);
        points.push({time:t.toISOString(),mw:value});
      }
    }
  }
  points.sort((a,b)=>a.time.localeCompare(b.time));
  return points.length ? {...points[points.length-1],from,to,points:points.length} : null;
}
export async function onRequestGet({request,env}) {
  const token = env.ENTSOE_API_KEY;
  if (!token) return Response.json({error:"ENTSO-E API-nyckel saknas."},{status:500});
  const now = new Date();
  const end = new Date(Math.floor(now.getTime()/900000)*900000);
  const start = new Date(end.getTime()-6*60*60*1000);
  const periodStart=utcStamp(start), periodEnd=utcStamp(end);
  const results = await Promise.all(BORDERS.map(async ([from,to])=>{
    const params = new URLSearchParams({
      securityToken:token, documentType:"A11", processType:"A16",
      out_Domain:AREAS[from], in_Domain:AREAS[to],
      periodStart, periodEnd
    });
    try {
      const response=await fetch(API+"?"+params.toString(),{headers:{accept:"application/xml"}});
      const xml=await response.text();
      if (!response.ok) throw Error("HTTP "+response.status);
      if (xml.includes("Acknowledgement_MarketDocument")) throw Error("Ingen publicerad data");
      const parsed=parseXml(xml,from,to);
      return parsed ? {...parsed,status:"ok"} : {from,to,status:"empty"};
    } catch(e) { return {from,to,status:"error",error:String(e.message||e)}; }
  }));
  const ok=results.filter(x=>x.status==="ok").length;
  return Response.json({
    updatedAt:now.toISOString(),periodStart,periodEnd,
    source:"ENTSO-E Transparency Platform · A11 Physical Flows",
    available:ok,total:results.length,flows:results
  },{headers:{"cache-control":"public, max-age=60, s-maxage=60"}});
}
