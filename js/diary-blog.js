// =========================================================
// PARIKRAMAPATH - SEPARATE YATRA DIARY BLOGPOST, SHARE & SEO MODULE
// URL Pattern: /diary/<user>/<yatra>/<day>
// =========================================================

window.ParikramaDiaryBlog = (function() {
    let allApprovedDiariesCache = [];

    const YATRA_SLUG_ALIASES = {
        'नर्मदा परिक्रमा': 'narmada_parikrama',
        'माँ नर्मदा परिक्रमा': 'narmada_parikrama',
        'narmada parikrama': 'narmada_parikrama',
        'गिरनार परिक्रमा': 'girnar_parikrama',
        'girnar parikrama': 'girnar_parikrama',
        'ब्रज 84 कोस परिक्रमा': 'braj_84_kos_parikrama',
        'braj 84 kos parikrama': 'braj_84_kos_parikrama'
    };

    function slugifyPart(val) {
        const raw = (val || '').toString().toLowerCase().trim();
        if (!raw) return '';
        if (YATRA_SLUG_ALIASES[raw]) return YATRA_SLUG_ALIASES[raw];

        for (const [k, v] of Object.entries(YATRA_SLUG_ALIASES)) {
            if (raw.includes(k.toLowerCase())) return v;
        }

        const cleaned = raw
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '_')
            .replace(/-+/g, '_')
            .replace(/^_+|_+$/g, '');

        return cleaned || 'yatra';
    }

    function getDiaryDaySlug(diary) {
        const dNum = parseInt(diary?.day_number, 10) || 1;
        return `day-${dNum}`;
    }

    function buildDiaryCleanPath(diary) {
        const uSlug = slugifyPart(diary?.yatri_name) || 'yatri';
        const ySlug = slugifyPart(diary?.yatra_name) || 'yatra';
        const daySlug = getDiaryDaySlug(diary);
        return `/diary/${uSlug}/${ySlug}/${daySlug}`;
    }

    function buildDiaryFullUrl(diary) {
        const cleanPath = buildDiaryCleanPath(diary);
        return `${window.location.origin}${cleanPath}`;
    }

    function parseDiaryPathFromLocation() {
        const pathname = (window.location.pathname || '').replace(/\/+$/, '');
        const parts = pathname.split('/').filter(Boolean);
        if (parts.length >= 4 && parts[0].toLowerCase() === 'diary') {
            return {
                userSlug: parts[1].toLowerCase(),
                yatraSlug: parts[2].toLowerCase(),
                daySlug: parts[3].toLowerCase()
            };
        }
        return null;
    }

    function normalizePhotos(rawPhotos) {
        let arr = rawPhotos;
        if (typeof arr === 'string') {
            try { arr = JSON.parse(arr); } catch (e) { arr = []; }
        }
        return Array.isArray(arr) ? arr.filter(Boolean).slice(0, 2) : [];
    }

    async function fetchApprovedDiaries(forceRefresh = false) {
        if (!forceRefresh && Array.isArray(allApprovedDiariesCache) && allApprovedDiariesCache.length > 0) {
            return allApprovedDiariesCache;
        }
        if (typeof supabaseClient === 'undefined') {
            return allApprovedDiariesCache;
        }

        try {
            const { data, error } = await supabaseClient
                .from('yatra_diaries')
                .select('*')
                .eq('status', 'approved')
                .order('created_at', { ascending: false });

            if (!error && Array.isArray(data) && data.length > 0) {
                allApprovedDiariesCache = data;
            }
        } catch (e) {}

        return allApprovedDiariesCache;
    }

    function updateSeoForDiaryPost(diary) {
        if (!diary) return;
        const dayNum = parseInt(diary.day_number, 10) || 1;
        const titleStr = `${diary.yatri_name} — ${diary.yatra_name} Diary Day ${dayNum} | Parikramapath.in`;
        const descStr = (diary.experience_text || `${diary.yatra_name} Day ${dayNum} यात्रा अनुभव — ${diary.start_place || ''} से ${diary.night_halt || ''}`)
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 155);
        const fullUrl = buildDiaryFullUrl(diary);
        const photos = normalizePhotos(diary.photo_urls);

        document.title = titleStr;

        let metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) metaDesc.setAttribute('content', descStr);

        let canonical = document.querySelector('link[rel="canonical"]');
        if (canonical) canonical.setAttribute('href', fullUrl);

        let scriptEl = document.getElementById('diaryBlogJsonLd');
        if (!scriptEl) {
            scriptEl = document.createElement('script');
            scriptEl.id = 'diaryBlogJsonLd';
            scriptEl.type = 'application/ld+json';
            document.head.appendChild(scriptEl);
        }

        const schemaObj = {
            '@context': 'https://schema.org',
            '@type': 'BlogPosting',
            'headline': `${diary.yatri_name} — ${diary.yatra_name} Diary | Day ${dayNum}`,
            'description': descStr,
            'datePublished': diary.diary_date || diary.created_at || new Date().toISOString(),
            'url': fullUrl,
            'author': {
                '@type': 'Person',
                'name': diary.yatri_name || 'परिक्रमावासी'
            },
            'publisher': {
                '@type': 'Organization',
                'name': 'Parikramapath',
                'url': window.location.origin
            }
        };

        if (photos.length > 0) {
            schemaObj.image = photos;
        }

        scriptEl.textContent = JSON.stringify(schemaObj);
    }

    function ensureContainer() {
        let container = document.getElementById('diaryBlogViewContainer');
        if (!container) {
            const gateBox = document.querySelector('#yatraGate .gate-box');
            if (!gateBox) return null;
            container = document.createElement('section');
            container.id = 'diaryBlogViewContainer';
            container.style.cssText = 'display:none; margin-top:16px; text-align:left;';
            const infoHeading = Array.from(gateBox.querySelectorAll('h2')).find(h => h.textContent.includes('परिक्रमापथ (Parikramapath) क्या है?'));
            if (infoHeading && infoHeading.parentNode) {
                infoHeading.parentNode.insertBefore(container, infoHeading.parentNode.firstChild);
            } else {
                gateBox.appendChild(container);
            }
        }
        return container;
    }

    window.shareDiaryPost = async function(diaryId) {
        const list = await fetchApprovedDiaries();
        const d = list.find(item => String(item.id) === String(diaryId));
        if (!d) return;

        const shareUrl = buildDiaryFullUrl(d);
        const dayNum = parseInt(d.day_number, 10) || 1;
        const shareText = `🚩 ${d.yatri_name} की ${d.yatra_name} डायरी — Day ${dayNum} (${d.diary_date || ''})\n🚶 ${d.start_place || '-'} ➔ 🛌 ${d.night_halt || '-'} (${d.distance_km || 0} km)\n\nपूरा अनुभव पढ़ें: ${shareUrl}`;

        if (navigator.share) {
            try {
                await navigator.share({
                    title: `${d.yatri_name} — ${d.yatra_name} | Day ${dayNum}`,
                    text: shareText,
                    url: shareUrl
                });
                return;
            } catch (e) {}
        }

        const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
        window.open(waUrl, '_blank', 'noopener');
    };

    window.copyDiaryLink = function(diaryId) {
        const list = allApprovedDiariesCache || [];
        const d = list.find(item => String(item.id) === String(diaryId));
        if (!d) return;
        const shareUrl = buildDiaryFullUrl(d);

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(shareUrl).then(() => {
                alert(`📋 लिंक कॉपी हो गया:\n${shareUrl}`);
            }).catch(() => {
                prompt('लिंक कॉपी करें:', shareUrl);
            });
        } else {
            prompt('लिंक कॉपी करें:', shareUrl);
        }
    };

    function renderSingleDiaryBlogPost(diary, allDiaries) {
        const container = ensureContainer();
        if (!container || !diary) return;

        const yatraGate = document.getElementById('yatraGate');
        if (yatraGate && yatraGate.style.display === 'none') {
            yatraGate.style.display = 'flex';
        }

        const cleanPath = buildDiaryCleanPath(diary);
        try {
            if (window.location.pathname !== cleanPath) {
                window.history.replaceState({ diaryId: diary.id }, '', cleanPath);
            }
        } catch (e) {}

        updateSeoForDiaryPost(diary);

        const dayNum = parseInt(diary.day_number, 10) || 1;
        const photos = normalizePhotos(diary.photo_urls);
        const photosHtml = photos.length > 0
            ? `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:8px; margin:12px 0;">
                ${photos.map(u => `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="${diary.yatri_name} Day ${dayNum}" style="width:100%; height:190px; object-fit:cover; border-radius:8px; border:1px solid #ffe0b2;"></a>`).join('')}
               </div>`
            : '';

        const sameYatriOtherDays = allDiaries
            .filter(item =>
                String(item.id) !== String(diary.id) &&
                slugifyPart(item.yatri_name) === slugifyPart(diary.yatri_name) &&
                slugifyPart(item.yatra_name) === slugifyPart(diary.yatra_name)
            )
            .sort((a, b) => (parseInt(a.day_number, 10) || 1) - (parseInt(b.day_number, 10) || 1));

        const otherDaysHtml = sameYatriOtherDays.length > 0
            ? `
                <div style="margin-top:16px; padding-top:12px; border-top:1px dashed #c5e1a5;">
                    <h3 style="margin:0 0 8px 0; font-size:15px; color:#1b5e20;">
                        📚 ${diary.yatri_name} के अन्य दिन के अनुभव (${diary.yatra_name}):
                    </h3>
                    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(210px, 1fr)); gap:8px;">
                        ${sameYatriOtherDays.map(other => {
                            const oDay = parseInt(other.day_number, 10) || 1;
                            const snippet = (other.experience_text || `${other.start_place || ''} ➔ ${other.night_halt || ''}`).slice(0, 85);
                            return `
                                <div onclick="ParikramaDiaryBlog.openDiaryById('${other.id}')" style="background:#f9fbe7; border:1px solid #c5e1a5; border-radius:8px; padding:9px; cursor:pointer;">
                                    <div style="font-weight:bold; font-size:13px; color:#d84315;">Day ${oDay} • 📅 ${other.diary_date || ''}</div>
                                    <div style="font-size:11.5px; color:#2e7d32; margin:2px 0;">📏 ${other.distance_km || 0} km • 🛌 ${other.night_halt || '-'}</div>
                                    <div style="font-size:12px; color:#444; line-height:1.4;">${snippet}${snippet.length >= 85 ? '...' : ''}</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `
            : '';

        container.style.display = 'block';
        container.innerHTML = `
            <article style="background:#ffffff; border:2px solid #ff9800; border-radius:14px; padding:15px; box-shadow:0 4px 14px rgba(0,0,0,0.08);">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
                    <button type="button" onclick="ParikramaDiaryBlog.closeBlogPostView()" style="background:#fff3e0; color:#d84315; border:1px solid #ffb74d; padding:5px 10px; border-radius:6px; font-weight:bold; font-size:12px; cursor:pointer;">
                        ← सभी डायरी / वापस जाएं
                    </button>
                    <div style="display:flex; gap:6px;">
                        <button type="button" onclick="shareDiaryPost('${diary.id}')" style="background:#2e7d32; color:#fff; border:none; padding:5px 10px; border-radius:6px; font-weight:bold; font-size:12px; cursor:pointer;">
                            📤 शेयर करें
                        </button>
                        <button type="button" onclick="copyDiaryLink('${diary.id}')" style="background:#1565c0; color:#fff; border:none; padding:5px 10px; border-radius:6px; font-weight:bold; font-size:12px; cursor:pointer;">
                            📋 लिंक कॉपी
                        </button>
                    </div>
                </div>

                <span style="font-size:11px; background:#fff3e0; color:#e65100; padding:2px 8px; border-radius:10px; font-weight:bold;">
                    ${diary.yatra_name} • Day ${dayNum}
                </span>
                <h2 style="margin:6px 0 4px 0; font-size:19px; color:#222;">
                    🚩 ${diary.yatri_name} — ${diary.yatra_name} डायरी | Day ${dayNum}
                </h2>
                <div style="font-size:12px; color:#666; margin-bottom:10px;">
                    📅 ${diary.diary_date || ''} ${diary.diary_time ? '• 🕒 ' + diary.diary_time : ''}
                </div>

                <div style="background:#f1f8e9; padding:8px 10px; border-radius:8px; border-left:4px solid #2e7d32; font-size:12.5px; color:#1b5e20; margin-bottom:10px;">
                    🚶 <b>प्रस्थान:</b> ${diary.start_place || '-'} ➔ 🛌 <b>रात्रि विश्राम:</b> <b>${diary.night_halt || '-'}</b> • 📏 <b>दूरी:</b> <b>${diary.distance_km || 0} km</b>
                </div>

                <div style="font-size:14px; line-height:1.7; color:#222; white-space:pre-line;">
                    ${diary.experience_text || ''}
                </div>

                ${photosHtml}
                ${otherDaysHtml}
            </article>
        `;
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function renderDiaryHubList() {
        const container = ensureContainer();
        if (!container) return;

        container.style.display = 'block';
        container.innerHTML = `<div style="background:#f9fbe7; border:1.5px solid #c5e1a5; border-radius:12px; padding:12px; font-size:13px;">⏳ यात्रियों की डायरियाँ लोड हो रही हैं...</div>`;

        const diaries = await fetchApprovedDiaries(true);
        if (!diaries || diaries.length === 0) {
            container.innerHTML = `
                <div style="background:#f9fbe7; border:1.5px solid #c5e1a5; border-radius:12px; padding:12px; font-size:13px; color:#444;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <b>📖 यात्रियों की यात्रा डायरी</b>
                        <button type="button" onclick="ParikramaDiaryBlog.closeBlogPostView()" style="background:#eee; border:none; padding:4px 8px; border-radius:5px; cursor:pointer; font-size:11.5px;">✖ बंद करें</button>
                    </div>
                    <p style="margin:8px 0 0 0;">अभी कोई प्रकाशित यात्रा डायरी उपलब्ध नहीं है।</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div style="background:#f9fbe7; border:1.5px solid #c5e1a5; border-radius:12px; padding:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <h2 style="margin:0; font-size:16px; color:#2e7d32;">📖 यात्रियों की यात्रा डायरी (Yatra Diaries)</h2>
                    <button type="button" onclick="ParikramaDiaryBlog.closeBlogPostView()" style="background:#e0e0e0; color:#222; border:none; padding:4px 9px; border-radius:5px; cursor:pointer; font-size:11.5px; font-weight:bold;">✖ बंद करें</button>
                </div>
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(235px, 1fr)); gap:10px;">
                    ${diaries.map(d => {
                        const dayNum = parseInt(d.day_number, 10) || 1;
                        return `
                            <article style="background:#ffffff; border:1px solid #dcedc8; border-radius:10px; padding:10px;">
                                <div style="font-weight:bold; font-size:13.5px; color:#d84315; cursor:pointer;" onclick="ParikramaDiaryBlog.openDiaryById('${d.id}')">
                                    🚩 ${d.yatri_name} — ${d.yatra_name} | Day ${dayNum}
                                </div>
                                <div style="font-size:11px; color:#666; margin:2px 0 6px 0;">📅 ${d.diary_date || ''} • 📏 ${d.distance_km || 0} km</div>
                                <p style="margin:0 0 8px 0; font-size:12.5px; color:#333; line-height:1.5;">${(d.experience_text || '').slice(0, 110)}${(d.experience_text || '').length > 110 ? '...' : ''}</p>
                                <div style="display:flex; gap:6px;">
                                    <button type="button" onclick="ParikramaDiaryBlog.openDiaryById('${d.id}')" style="flex:1; background:#ff5722; color:#fff; border:none; padding:5px; border-radius:5px; font-size:11.5px; font-weight:bold; cursor:pointer;">📖 पूरा पढ़ें</button>
                                    <button type="button" onclick="shareDiaryPost('${d.id}')" style="background:#2e7d32; color:#fff; border:none; padding:5px 8px; border-radius:5px; font-size:11.5px; font-weight:bold; cursor:pointer;">📤</button>
                                </div>
                            </article>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function openDiaryById(diaryId) {
        const diaries = await fetchApprovedDiaries();
        const found = diaries.find(d => String(d.id) === String(diaryId));
        if (found) {
            renderSingleDiaryBlogPost(found, diaries);
        }
    }

    async function openDiaryHub() {
        await renderDiaryHubList();
    }

    function closeBlogPostView() {
        const container = document.getElementById('diaryBlogViewContainer');
        if (container) container.style.display = 'none';
        try {
            if ((window.location.pathname || '').startsWith('/diary/')) {
                window.history.pushState({}, '', '/');
            }
        } catch (e) {}
    }

    async function handleInitialRouteIfDiary() {
        const parsed = parseDiaryPathFromLocation();
        if (!parsed) return;

        const diaries = await fetchApprovedDiaries(true);
        if (!diaries || diaries.length === 0) return;

        const matched = diaries.find(d =>
            slugifyPart(d.yatri_name) === parsed.userSlug &&
            slugifyPart(d.yatra_name) === parsed.yatraSlug &&
            getDiaryDaySlug(d) === parsed.daySlug
        ) || diaries.find(d =>
            slugifyPart(d.yatra_name) === parsed.yatraSlug &&
            getDiaryDaySlug(d) === parsed.daySlug
        ) || diaries.find(d =>
            slugifyPart(d.yatri_name) === parsed.userSlug &&
            getDiaryDaySlug(d) === parsed.daySlug
        ) || diaries.find(d => getDiaryDaySlug(d) === parsed.daySlug)
          || diaries[0];

        if (matched) {
            renderSingleDiaryBlogPost(matched, diaries);
        }
    }

    window.addEventListener('popstate', () => {
        handleInitialRouteIfDiary();
    });

    window.addEventListener('DOMContentLoaded', () => {
        setTimeout(handleInitialRouteIfDiary, 300);
        setTimeout(handleInitialRouteIfDiary, 1200);
    });

    return {
        openDiaryHub,
        openDiaryById,
        closeBlogPostView,
        buildDiaryCleanPath,
        buildDiaryFullUrl
    };
})();