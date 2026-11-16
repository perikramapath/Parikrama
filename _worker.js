// File Path: _worker.js (Root folder mein, index.html ke paas)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Automatic Dynamic /sitemap.xml
    if (url.pathname === "/sitemap.xml") {
      const SUPABASE_URL = "https://ohazukqrnmiycvkldeeq.supabase.co"; // <-- js/config.js se URL dalein
      const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9oYXp1a3Fybm1peWN2a2xkZWVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2NzM5NTcsImV4cCI6MjExMDI0OTk1N30.6Hq116jqCeESuM9cWmmJljdAj6Mawjfnf_TCCFXDB-o";         // <-- js/config.js se Anon Key dalein

      const fallbackSlugs = [
        "narmada-parikrama",
        "braj-84-kos-parikrama",
        "girnar-parikrama"
      ];

      let yatraXmlEntries = "";

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

      const todayDate = new Date().toISOString().split("T")[0];
      const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://parikramapath.in/</loc>
    <lastmod>${todayDate}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
${yatraXmlEntries}
</urlset>`;

      return new Response(sitemapXml, {
        status: 200,
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=1800"
        }
      });
    }

    // 2. Baaki sabhi files (index.html, js/*, style.css, etc.) normal serve karein
    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};