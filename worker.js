// File Path: worker.js (Root folder mein, wrangler.jsonc ke "main" ke mutabik)

const SUPABASE_URL = "https://ohazukqrnmiycvkldeeq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9oYXp1a3Fybm1peWN2a2xkZWVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2NzM5NTcsImV4cCI6MjExMDI0OTk1N30.6Hq116jqCeESuM9cWmmJljdAj6Mawjfnf_TCCFXDB-o";
const ALWAYS_OG_IMAGE = "https://parikramapath.in/icon-512.png";

function escapeHtmlAttr(str) {
  return (str || "")
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function slugifyDiaryPart(val) {
  const raw = (val || "").toString().toLowerCase().trim();
  if (!raw) return "";

  const aliases = {
    "नर्मदा परिक्रमा": "narmada_parikrama",
    "माँ नर्मदा परिक्रमा": "narmada_parikrama",
    "narmada parikrama": "narmada_parikrama",
    "गिरनार परिक्रमा": "girnar_parikrama",
    "girnar parikrama": "girnar_parikrama",
    "ब्रज 84 कोस परिक्रमा": "braj_84_kos_parikrama",
    "braj 84 kos parikrama": "braj_84_kos_parikrama"
  };

  if (aliases[raw]) return aliases[raw];
  for (const [k, v] of Object.entries(aliases)) {
    if (raw.includes(k.toLowerCase())) return v;
  }

  const cleaned = raw
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/-+/g, "_")
    .replace(/^_+|_+$/g, "");

  return cleaned || "yatra";
}

async function fetchDiaryMetaForPath(pathname) {
  const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length < 4 || parts[0].toLowerCase() !== "diary") return null;

  const userSlug = parts[1].toLowerCase();
  const yatraSlug = parts[2].toLowerCase();
  const daySlug = parts[3].toLowerCase();
  const dayNumFromSlug = parseInt(daySlug.replace(/^day-/i, ""), 10) || 1;

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/yatra_diaries?select=yatri_name,yatra_name,day_number,diary_date,start_place,night_halt,distance_km,experience_text&status=eq.approved&order=created_at.desc&limit=50`,
      {
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );

    if (!resp.ok) return null;
    const rows = await resp.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const matched =
      rows.find(d =>
        slugifyDiaryPart(d.yatri_name) === userSlug &&
        slugifyDiaryPart(d.yatra_name) === yatraSlug &&
        (parseInt(d.day_number, 10) || 1) === dayNumFromSlug
      ) ||
      rows.find(d =>
        slugifyDiaryPart(d.yatra_name) === yatraSlug &&
        (parseInt(d.day_number, 10) || 1) === dayNumFromSlug
      ) ||
      rows.find(d => (parseInt(d.day_number, 10) || 1) === dayNumFromSlug) ||
      rows[0];

    if (!matched) return null;

    const dNum = parseInt(matched.day_number, 10) || dayNumFromSlug;
    const title = `🚩 ${matched.yatri_name || "परिक्रमावासी"} — ${matched.yatra_name || "यात्रा"} | Day ${dNum}`;
    const rawDesc = (matched.experience_text || `${matched.start_place || ""} ➔ ${matched.night_halt || ""} (${matched.distance_km || 0} km)`)
      .replace(/\s+/g, " ")
      .trim();
    const description = rawDesc.slice(0, 160) || "परिक्रमापथ पर यात्री का लाइव अनुभव पढ़ें।";

    return { title, description, image: ALWAYS_OG_IMAGE };
  } catch (e) {
    return null;
  }
}

async function serveIndexWithDynamicOg(request, env, ogOverride = null) {
  const assetRes = await env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
  let html = await assetRes.text();

  const url = new URL(request.url);
  const ogTitle = ogOverride?.title || "🕉️ Parikramapath - भारत की संपूर्ण तीर्थ एवं परिक्रमा मार्गदर्शिका";
  const ogDesc = ogOverride?.description || "नर्मदा, गिरनार, ब्रज 84 कोस सहित भारत की प्रमुख परिक्रमाओं के लाइव GPS रूट, आश्रम, सदाव्रत भोजन, आरती और नियमों की संपूर्ण जानकारी।";
  const ogUrl = url.toString();

  html = html
    .replace(/<meta property="og:title" content="[^"]*">/i, `<meta property="og:title" content="${escapeHtmlAttr(ogTitle)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/i, `<meta property="og:description" content="${escapeHtmlAttr(ogDesc)}">`)
    .replace(/<meta property="og:image" content="[^"]*">/i, `<meta property="og:image" content="${ALWAYS_OG_IMAGE}">`)
    .replace(/<meta property="og:url" content="[^"]*">/i, `<meta property="og:url" content="${escapeHtmlAttr(ogUrl)}">`)
    .replace(/<meta name="twitter:title" content="[^"]*">/i, `<meta name="twitter:title" content="${escapeHtmlAttr(ogTitle)}">`)
    .replace(/<meta name="twitter:description" content="[^"]*">/i, `<meta name="twitter:description" content="${escapeHtmlAttr(ogDesc)}">`);

  if (/<meta name="twitter:image"/i.test(html)) {
    html = html.replace(/<meta name="twitter:image" content="[^"]*">/i, `<meta name="twitter:image" content="${ALWAYS_OG_IMAGE}">`);
  } else {
    html = html.replace(/<meta name="twitter:card" content="[^"]*">/i, `<meta name="twitter:card" content="summary_large_image">\n    <meta name="twitter:image" content="${ALWAYS_OG_IMAGE}">`);
  }

  if (ogOverride?.title) {
    html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtmlAttr(ogTitle)} | Parikramapath.in</title>`);
  }

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathnameLower = url.pathname.toLowerCase();

    // 1. Automatic Dynamic /sitemap.xml (Yatras + Approved Diary Posts)
    if (url.pathname === "/sitemap.xml") {
      const fallbackSlugs = [
        "narmada-parikrama",
        "braj-84-kos-parikrama",
        "girnar-parikrama"
      ];

      let yatraXmlEntries = "";
      let diaryXmlEntries = "";

      try {
        const response = await fetch(
          `${SUPABASE_URL}/rest/v1/yatras?select=slug,created_at&order=created_at.asc`,
          {
            headers: {
              "apikey": SUPABASE_ANON_KEY,
              "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
            }
          }
        );

        if (response.ok) {
          const yatras = await response.json();

          yatras.sort((a, b) => {
            const aIsNarmada = (a.slug || "").toLowerCase().includes("narmada");
            const bIsNarmada = (b.slug || "").toLowerCase().includes("narmada");
            if (aIsNarmada && !bIsNarmada) return -1;
            if (!aIsNarmada && bIsNarmada) return 1;
            return 0;
          });

          yatraXmlEntries = yatras
            .filter(y => y.slug)
            .map(y => {
              const lastMod = y.created_at
                ? y.created_at.split("T")[0]
                : new Date().toISOString().split("T")[0];
              return `  <url>
    <loc>https://parikramapath.in/yatra-guide.html?slug=${encodeURIComponent(y.slug)}</loc>
    <lastmod>${lastMod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>`;
            })
            .join("\n");
        }
      } catch (err) {}

      if (!yatraXmlEntries) {
        const today = new Date().toISOString().split("T")[0];
        yatraXmlEntries = fallbackSlugs
          .map(slug => `  <url>
    <loc>https://parikramapath.in/yatra-guide.html?slug=${slug}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>`)
          .join("\n");
      }

      try {
        const diaryResp = await fetch(
          `${SUPABASE_URL}/rest/v1/yatra_diaries?select=yatri_name,yatra_name,day_number,diary_date,created_at&status=eq.approved&order=created_at.desc&limit=100`,
          {
            headers: {
              "apikey": SUPABASE_ANON_KEY,
              "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
            }
          }
        );

        if (diaryResp.ok) {
          const diaries = await diaryResp.json();
          const seenLocs = new Set();
          const diaryUrls = [];

          for (const d of (Array.isArray(diaries) ? diaries : [])) {
            const uSlug = slugifyDiaryPart(d.yatri_name) || "yatri";
            const ySlug = slugifyDiaryPart(d.yatra_name) || "yatra";
            const dayNum = parseInt(d.day_number, 10) || 1;
            const loc = `https://parikramapath.in/diary/${uSlug}/${ySlug}/day-${dayNum}`;
            if (seenLocs.has(loc)) continue;
            seenLocs.add(loc);

            const lastMod = (d.diary_date || d.created_at || new Date().toISOString()).split("T")[0];
            diaryUrls.push(`  <url>
    <loc>${loc}</loc>
    <lastmod>${lastMod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`);
          }

          diaryXmlEntries = diaryUrls.join("\n");
        }
      } catch (err) {}

      const todayDate = new Date().toISOString().split("T")[0];
      const allEntries = [yatraXmlEntries, diaryXmlEntries].filter(Boolean).join("\n");
      const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://parikramapath.in/</loc>
    <lastmod>${todayDate}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
${allEntries}
</urlset>`;

      return new Response(sitemapXml, {
        status: 200,
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=1800"
        }
      });
    }

    // 2. Clean BlogPost routes (/diary/<user>/<yatra>/<day>) -> dynamic OG + icon-512.png
    if (pathnameLower.startsWith("/diary/") && env && env.ASSETS) {
      const diaryMeta = await fetchDiaryMetaForPath(url.pathname);
      return serveIndexWithDynamicOg(request, env, diaryMeta);
    }

    // 3. Root / Home -> serve index.html with icon-512.png
    if ((url.pathname === "/" || pathnameLower === "/index.html") && env && env.ASSETS) {
      return serveIndexWithDynamicOg(request, env, null);
    }

    // 4. Baaki sabhi files normal serve karein
    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};