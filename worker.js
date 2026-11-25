// File Path: worker.js (Root folder mein, wrangler.jsonc ke "main" ke mutabik)

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathnameLower = url.pathname.toLowerCase();

    // 1. Automatic Dynamic /sitemap.xml (Yatras + Approved Diary Posts)
    if (url.pathname === "/sitemap.xml") {
      const SUPABASE_URL = "https://ohazukqrnmiycvkldeeq.supabase.co";
      const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9oYXp1a3Fybm1peWN2a2xkZWVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2NzM5NTcsImV4cCI6MjExMDI0OTk1N30.6Hq116jqCeESuM9cWmmJljdAj6Mawjfnf_TCCFXDB-o";

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

          // Narmada Parikrama ko hamesha sabse upar rakhein
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
      } catch (err) {
        // Fallback use hoga
      }

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
      } catch (err) {
        // Diary sitemap fallback
      }

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

    // 2. Clean BlogPost routes (/diary/<user>/<yatra>/<day>) -> serve index.html
    if (pathnameLower.startsWith("/diary/") && env && env.ASSETS) {
      const indexReq = new Request(new URL("/index.html", request.url), request);
      return env.ASSETS.fetch(indexReq);
    }

    // 3. Baaki sabhi files (index.html, js/*, style.css, etc.) normal serve karein
    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};