// =========================================================
// PARIKRAMAPATH - AUTH, COMPLETE PROFILE EDIT, ID CARD & SOS
// =========================================================

let profileVideoStream = null;
let capturedSelfieBase64 = null;
let yatraNameCache = {};

function populateSevadarYatraDropdown(yatras) {
    if (Array.isArray(yatras)) {
        yatras.forEach(y => {
            yatraNameCache[String(y.id)] = y.name_hi || y.name;
        });
    }
    const sel = document.getElementById('regSevadarYatra');
    if (sel) {
        sel.innerHTML = yatras.map(y => `<option value="${y.id}">${y.name_hi || y.name}</option>`).join('');
    }
}

async function resolveYatraDisplayName(yatraId) {
    if (!yatraId) return 'अज्ञात यात्रा';
    const key = String(yatraId);
    if (window.activeYatra && String(window.activeYatra.id) === key) {
        const name = window.activeYatra.name_hi || window.activeYatra.name;
        yatraNameCache[key] = name;
        return name;
    }
    if (yatraNameCache[key]) return yatraNameCache[key];

    const { data } = await supabaseClient
        .from('yatras')
        .select('name, name_hi')
        .eq('id', yatraId)
        .single();

    if (data) {
        const name = data.name_hi || data.name;
        yatraNameCache[key] = name;
        return name;
    }
    return 'परिक्रमा यात्रा';
}

function isSosRelevantForStaff(sos) {
    if (!window.currentProfile || !sos) return false;
    const cleanRole = (window.currentProfile.role || '').toLowerCase().trim().replace(/\s+/g, '_');

    // Super Admin aur Admin sabhi yatraon ke SOS dekh sakte hain
    if (cleanRole === 'super_admin' || cleanRole === 'admin') {
        return true;
    }

    // Sevadar (supporter) aur Moderator ko sirf unki assigned yatra ka SOS dikhega
    if (cleanRole === 'moderator' || (cleanRole === 'supporter' && window.currentProfile.status === 'approved')) {
        const assignedId = window.currentProfile.assigned_yatra_id;
        if (!assignedId) return false;
        return String(sos.yatra_id) === String(assignedId);
    }

    return false;
}

function onRoleChange() {
    document.getElementById('sevadarRegFields').style.display =
        document.getElementById('regRole').value === 'supporter' ? 'block' : 'none';
}

// 1. User / Sevadar Registration (Bulletproof Metadata + Upsert)
async function registerUser() {
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPass').value.trim();
    const full_name = document.getElementById('regName').value.trim();
    const mobile = document.getElementById('regMobile').value.trim();
    const role = document.getElementById('regRole').value;
    const assigned_yatra_id = role === 'supporter' ? document.getElementById('regSevadarYatra').value : null;
    const sevadar_area = role === 'supporter' ? document.getElementById('regSevadarArea').value.trim() : null;

    if (!email || !password || !full_name || !mobile) {
        return alert("कृपया सभी आवश्यक जानकारी (नाम, मोबाइल, ईमेल, पासवर्ड) भरें।");
    }

    const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
            data: {
                full_name,
                mobile,
                role,
                assigned_yatra_id,
                sevadar_area
            }
        }
    });

    if (error) return alert("Registration Error: " + error.message);

    if (data && data.user) {
        const { error: profErr } = await supabaseClient.from('profiles').upsert([{
            id: data.user.id,
            full_name,
            mobile,
            email,
            role,
            status: role === 'supporter' ? 'pending' : 'approved',
            assigned_yatra_id,
            sevadar_area
        }], { onConflict: 'id' });

        if (profErr) console.error("Profile upsert warning:", profErr.message);
    }

    alert("✅ Parikramapath पर रजिस्ट्रेशन सफल! कृपया अब लॉगिन करें।");
    toggleAuthForm('login');
}

// 2. Login Function
async function loginUser() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPass').value.trim();

    if (!email || !password) return alert("कृपया Email और Password डालें।");

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) return alert("Login Error: " + error.message);

    await applyUserSession(data.user);
    closeAllModals();
    alert(`🙏 नमस्ते ${window.currentProfile ? window.currentProfile.full_name : ''}! Parikramapath में स्वागत है।`);
}

// 3. Apply User Session & Reveal Profile + Admin/Moderator Controls
async function applyUserSession(user) {
    if (!user) return;
    window.currentUser = user;

    const { data: prof } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

    window.currentProfile = prof || {
        id: user.id,
        full_name: user.email,
        mobile: '',
        email: user.email,
        role: 'pilgrim',
        journey_history: []
    };

    const cleanRole = (window.currentProfile.role || '').toLowerCase().trim().replace(/\s+/g, '_');
    const isAdminOrMod = (cleanRole === 'super_admin' || cleanRole === 'admin' || cleanRole === 'moderator');
    const isStrictAdmin = (cleanRole === 'super_admin' || cleanRole === 'admin');
    const isStaff = isAdminOrMod || (cleanRole === 'supporter' && window.currentProfile.status === 'approved');

    // Home Gate (Gate 1) buttons update
    const gateLoginBtn = document.getElementById('gateLoginBtn');
    const gateProfileBtn = document.getElementById('gateProfileBtn');
    if (gateLoginBtn) gateLoginBtn.style.display = 'none';
    if (gateProfileBtn) {
        gateProfileBtn.style.display = 'inline-block';
        const firstName = (window.currentProfile.full_name || 'Profile').split(' ')[0];
        gateProfileBtn.innerText = `🪪 ${firstName}`;
    }

    // Map Menu buttons update
    const loginBtn = document.getElementById('loginMenuBtn');
    const logoutBtn = document.getElementById('logoutMenuBtn');
    const profileBtn = document.getElementById('profileMenuBtn');

    if (loginBtn) loginBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'block';
    if (profileBtn) profileBtn.style.display = 'block';

    const adminBtn = document.getElementById('adminMenuBtn');
    const manualDrawBtn = document.getElementById('manualDrawMenuBtn');
    const gpsFollowBtn = document.getElementById('gpsFollowMenuBtn');

    if (adminBtn) adminBtn.style.display = isAdminOrMod ? 'block' : 'none';
    if (manualDrawBtn) manualDrawBtn.style.display = isAdminOrMod ? 'block' : 'none';
    if (gpsFollowBtn) gpsFollowBtn.style.display = isAdminOrMod ? 'block' : 'none';

    // Admin aur Sevadar ke liye Live SOS Listener chalu karein
    if (isStaff) {
        startLiveSosListener();
    }

    // Active yatri ki live location broadcast aur sirf super_admin/admin ke liye live tracker
    if (typeof startYatriLocationBroadcast === 'function') {
        startYatriLocationBroadcast();
    }
    if (isStrictAdmin && typeof initAdminLiveYatriTracker === 'function') {
        initAdminLiveYatriTracker();
    }

    // Profile load hote hi map markers par Admin/User Edit buttons refresh karein
    if (typeof renderIsolatedPadavs === 'function' && Array.isArray(window.activeYatraPadavs) && window.activeYatraPadavs.length > 0) {
        renderIsolatedPadavs(window.activeYatraPadavs);
    }
}

// 4. Page Refresh par Automatic Session Check
window.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session && session.user) {
        await applyUserSession(session.user);
    }
});

// =========================================================
// 5. LIVE SELFIE CAMERA, COMPLETE PROFILE EDIT, QR & PDF PASS
// =========================================================
async function startCamera() {
    const video = document.getElementById('cameraVideo');
    const container = document.getElementById('cameraContainer');
    const btn = document.getElementById('startCamBtn');

    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return alert("⚠️ आपका ब्राउज़र कैमरा सपोर्ट नहीं करता या HTTPS कनेक्शन नहीं है।");
        }
        profileVideoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        video.srcObject = profileVideoStream;
        await video.play();

        container.style.display = 'block';
        btn.style.display = 'none';
        document.getElementById('profilePicPreview').style.display = 'none';
    } catch (err) {
        alert("⚠️ Camera Error: " + err.message + "\nकृपया ब्राउज़र में कैमरा की अनुमति (Allow) दें।");
    }
}

function captureSelfie() {
    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('cameraCanvas');
    const ctx = canvas.getContext('2d');

    canvas.width = 250;
    canvas.height = 250;
    const minDim = Math.min(video.videoWidth, video.videoHeight);
    const startX = (video.videoWidth - minDim) / 2;
    const startY = (video.videoHeight - minDim) / 2;

    ctx.drawImage(video, startX, startY, minDim, minDim, 0, 0, 250, 250);
    capturedSelfieBase64 = canvas.toDataURL('image/jpeg', 0.75);

    const preview = document.getElementById('profilePicPreview');
    preview.src = capturedSelfieBase64;
    preview.style.display = 'block';
    document.getElementById('idCardPic').src = capturedSelfieBase64;

    if (profileVideoStream) {
        profileVideoStream.getTracks().forEach(t => t.stop());
        profileVideoStream = null;
    }
    document.getElementById('cameraContainer').style.display = 'none';
    const btn = document.getElementById('startCamBtn');
    btn.style.display = 'inline-block';
    btn.innerText = "🔄 दूसरी सेल्फी लें";
}

function openProfileModal() {
    if (!window.currentUser || !window.currentProfile) return openAuthModal();

    const p = window.currentProfile;
    const uniquePassId = "PP-" + window.currentUser.id.substring(0, 8).toUpperCase();
    const yatraName = window.activeYatra
        ? `${window.activeYatra.icon_emoji || '🕉️'} ${window.activeYatra.name_hi || window.activeYatra.name}`
        : '🕉️ Parikramapath';

    document.getElementById('idCardUniqueNo').innerText = uniquePassId;
    document.getElementById('cardYatraTitle').innerText = yatraName;
    document.getElementById('cardRoleBadge').innerText = (p.role || 'PILGRIM').toUpperCase();
    document.getElementById('cardUserName').innerText = p.full_name || '-';
    document.getElementById('cardUserMobile').innerText = p.mobile || '-';
    const bloodEl = document.getElementById('cardBloodGroup');
    if (bloodEl) bloodEl.innerText = p.blood_group || 'Not Set';
    document.getElementById('cardStartPoint').innerText = window.selectedStartPadav
        ? window.selectedStartPadav.name
        : (p.start_point_name || 'Not Selected');
    document.getElementById('cardEndPoint').innerText = window.calculatedEndPoint || p.end_point_name || 'Not Set';
    document.getElementById('cardEmergency').innerText = p.emergency_contact || 'Not Set';
    document.getElementById('cardAddress').innerText = p.address || 'Not Set';

    const nameInput = document.getElementById('profileFullNameInput');
    const mobileInput = document.getElementById('profileMobileInput');
    const bloodInput = document.getElementById('profileBloodGroupInput');
    if (nameInput) nameInput.value = p.full_name || '';
    if (mobileInput) mobileInput.value = p.mobile || '';
    if (bloodInput) bloodInput.value = p.blood_group || '';
    document.getElementById('profileEmergencyInput').value = p.emergency_contact || '';
    document.getElementById('profileAddressInput').value = p.address || '';

    const completeBtn = document.getElementById('btnCompleteYatra');
    if (completeBtn) {
        completeBtn.style.display = window.activeYatra ? 'block' : 'none';
    }

    if (p.profile_pic) {
        document.getElementById('idCardPic').src = p.profile_pic;
        document.getElementById('profilePicPreview').src = p.profile_pic;
        document.getElementById('profilePicPreview').style.display = 'block';
        document.getElementById('startCamBtn').innerText = "🔄 दूसरी सेल्फी लें";
    }

    const qrBox = document.getElementById('qrcodeBox');
    if (qrBox && typeof QRCode !== 'undefined') {
        qrBox.innerHTML = '';
        const qrText = `ID: ${uniquePassId}\nName: ${p.full_name}\nMobile: ${p.mobile}\nBlood: ${p.blood_group || 'N/A'}\nEmergency: ${p.emergency_contact || 'N/A'}\nYatra: ${window.activeYatra ? window.activeYatra.name : 'Parikramapath'}`;
        new QRCode(qrBox, {
            text: qrText,
            width: 64,
            height: 64,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.L
        });
    }

    const hist = Array.isArray(p.journey_history) ? p.journey_history : [];
    document.getElementById('journeyHistoryBox').innerHTML = `<b>📜 पूर्ण की गई यात्राएं (${hist.length}):</b><br>` +
        (hist.length ? hist.map(h => `✅ ${h.yatra_name} (${h.date})`).join('<br>') : 'अभी तक कोई यात्रा पूर्ण नहीं हुई है।');

    showModal('profileModal');
}

async function saveCompleteProfile() {
    if (!window.currentUser) return;

    const fullName = document.getElementById('profileFullNameInput').value.trim();
    const mobile = document.getElementById('profileMobileInput').value.trim();
    const bloodGroup = document.getElementById('profileBloodGroupInput').value;
    const emergency = document.getElementById('profileEmergencyInput').value.trim();
    const address = document.getElementById('profileAddressInput').value.trim();

    if (!fullName || !mobile) {
        return alert("⚠️ कृपया अपना पूरा नाम और मोबाइल नंबर अवश्य भरें।");
    }

    const updates = {
        full_name: fullName,
        mobile: mobile,
        blood_group: bloodGroup || null,
        emergency_contact: emergency || null,
        address: address || null,
        role: (window.currentProfile && window.currentProfile.role) || 'pilgrim',
        status: (window.currentProfile && window.currentProfile.status) || 'approved'
    };

    if (capturedSelfieBase64) {
        updates.profile_pic = capturedSelfieBase64;
    }

    const { data, error } = await supabaseClient
        .from('profiles')
        .upsert({
            id: window.currentUser.id,
            email: window.currentUser.email,
            ...updates
        }, { onConflict: 'id' })
        .select()
        .single();

    if (error) return alert("Profile Update Error: " + error.message);

    window.currentProfile = data;
    capturedSelfieBase64 = null;

    const gateProfileBtn = document.getElementById('gateProfileBtn');
    if (gateProfileBtn) {
        const firstName = (data.full_name || 'Profile').split(' ')[0];
        gateProfileBtn.innerText = `🪪 ${firstName}`;
    }

    alert("✅ आपका प्रोफ़ाइल विवरण और ID Pass सफलतापूर्वक अपडेट हो गया है!");
    openProfileModal();
}

async function saveProfileExtras() {
    return saveCompleteProfile();
}

function downloadIdCardPDF() {
    if (typeof html2pdf === 'undefined') {
        return alert("PDF लाइब्रेरी लोड हो रही है, कृपया 2 सेकंड बाद प्रयास करें।");
    }
    const element = document.getElementById('dynamicIdCard');
    const opt = {
        margin: 10,
        filename: 'Parikramapath_ID_Pass.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    html2pdf().from(element).set(opt).save();
}

// 6. Complete Current Yatra & Switch to Next Yatra
async function completeCurrentYatra() {
    if (!window.activeYatra) return;
    if (!confirm("क्या आपने यह परिक्रमा पूर्ण कर ली है? इसके बाद आप नई यात्रा शुरू कर सकेंगे।")) return;

    const hist = Array.isArray(window.currentProfile.journey_history) ? window.currentProfile.journey_history : [];
    hist.push({
        yatra_name: window.activeYatra.name,
        start_point: window.selectedStartPadav ? window.selectedStartPadav.name : '',
        date: new Date().toLocaleDateString()
    });

    await supabaseClient.from('profiles').update({
        journey_history: hist,
        active_yatra_id: null,
        start_point_id: null
    }).eq('id', window.currentProfile.id);

    window.currentProfile.journey_history = hist;
    closeAllModals();
    backToYatraGate();
}

// =========================================================
// 7. GEO-FENCED SMART SOS (ONLY REGISTERED / LOGGED-IN USERS)
// =========================================================
function openSOSModal() {
    if (!window.currentUser) {
        alert("🔒 SOS आपातकालीन सहायता का उपयोग करने के लिए कृपया पहले लॉगिन या रजिस्टर करें।");
        openAuthModal();
        return;
    }
    if (!window.activeYatra) return;
    document.getElementById('sosYatraName').innerText = window.activeYatra.name_hi || window.activeYatra.name;
    showModal('sosModal');
}

async function insertSosRecord(helpType, lat, lng) {
    const userName = (window.currentProfile && window.currentProfile.full_name) || window.currentUser.email;
    const userMobile = (window.currentProfile && window.currentProfile.mobile) || 'N/A';
    const yatraDisplay = window.activeYatra.name_hi || window.activeYatra.name;

    const { error } = await supabaseClient.from('sos_alerts').insert([{
        user_id: window.currentUser.id,
        user_name: userName,
        user_mobile: userMobile,
        yatra_id: window.activeYatra.id,
        help_type: helpType,
        lat: lat,
        lng: lng
    }]);

    if (error) {
        alert("SOS Error: " + error.message);
        return;
    }

    closeAllModals();

    const mapUrl = `https://www.google.com/maps?q=${lat},${lng}`;
    const waText = encodeURIComponent(
        `🚨 *PARIKRAMAPATH SOS ALERT*\n` +
        `🚩 यात्रा: ${yatraDisplay}\n` +
        `🆘 सहायता: ${helpType}\n` +
        `👤 यात्री: ${userName}\n` +
        `📞 मोबाइल: ${userMobile}\n` +
        `📍 लोकेशन: ${mapUrl}`
    );

    const sendWa = confirm(
        `🚨 SOS (${yatraDisplay}) पोर्टल पर दर्ज हो गया है!\n\n` +
        `क्या आप तुरंत WhatsApp पर भी अपनी लाइव लोकेशन सेवादार / परिवार को भेजना चाहते हैं?`
    );
    if (sendWa) {
        window.open(`https://wa.me/?text=${waText}`, '_blank');
    }
}

function triggerSOS(helpType) {
    if (!window.currentUser) {
        alert("🔒 कृपया पहले लॉगिन करें।");
        openAuthModal();
        return;
    }
    if (!window.activeYatra) return;

    const fallbackLat = window.yatriLiveCoords?.lat || window.activeYatra.center_lat || 0;
    const fallbackLng = window.yatriLiveCoords?.lng || window.activeYatra.center_lng || 0;

    if (!navigator.geolocation) {
        insertSosRecord(helpType, fallbackLat, fallbackLng);
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            insertSosRecord(helpType, pos.coords.latitude, pos.coords.longitude);
        },
        () => {
            insertSosRecord(helpType, fallbackLat, fallbackLng);
        },
        { enableHighAccuracy: true, timeout: 6000 }
    );
}

// =========================================================
// 8. YATRA-SCOPED LIVE SOS POPUP & CONTINUOUS BUZZER
// =========================================================
let sosRealtimeChannel = null;
let sosBuzzerInterval = null;
let sosAudioCtx = null;

function stopSosBuzzer() {
    if (sosBuzzerInterval) {
        clearInterval(sosBuzzerInterval);
        sosBuzzerInterval = null;
    }
    if (sosAudioCtx) {
        try { sosAudioCtx.close(); } catch (e) {}
        sosAudioCtx = null;
    }
}

// Browser autoplay policy se bachne ke liye pehle click/touch par audio unlock karein
document.addEventListener('pointerdown', () => {
    if (sosAudioCtx && sosAudioCtx.state === 'suspended') {
        sosAudioCtx.resume().catch(() => {});
    }
}, { passive: true });

function playSosBeep() {
    stopSosBuzzer();
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        sosAudioCtx = new AudioCtx();
        if (sosAudioCtx.state === 'suspended') {
            sosAudioCtx.resume();
        }

        let count = 0;
        const triggerPulse = () => {
            if (!sosAudioCtx) return;
            if (sosAudioCtx.state === 'suspended') {
                sosAudioCtx.resume().catch(() => {});
            }
            const now = sosAudioCtx.currentTime;
            const osc = sosAudioCtx.createOscillator();
            const gain = sosAudioCtx.createGain();

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(count % 2 === 0 ? 980 : 740, now);

            gain.gain.setValueAtTime(0.95, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);

            osc.connect(gain);
            gain.connect(sosAudioCtx.destination);

            osc.start(now);
            osc.stop(now + 0.45);
            count++;
        };

        triggerPulse();
        // Jab tak stopSosBuzzer() na dabaya jaye tab tak lagatar bajta rahega
        sosBuzzerInterval = setInterval(triggerPulse, 550);
    } catch (e) {
        console.warn("SOS Buzzer blocked until screen tap:", e);
    }
}

async function showIncomingSosBanner(sos) {
    if (!isSosRelevantForStaff(sos)) return;

    playSosBeep();
    const yatraName = await resolveYatraDisplayName(sos.yatra_id);

    let box = document.getElementById('liveSosAlertBox');
    if (!box) {
        box = document.createElement('div');
        box.id = 'liveSosAlertBox';
        box.style.cssText = 'position:fixed; top:14px; right:14px; z-index:99999; background:#b71c1c; color:#fff; padding:14px 16px; border-radius:12px; box-shadow:0 8px 25px rgba(0,0,0,0.5); max-width:345px; width:90%; border:2px solid #ffcdd2; font-family:sans-serif;';
        document.body.appendChild(box);
    }

    const mapUrl = `https://www.google.com/maps?q=${sos.lat},${sos.lng}`;
    const timeStr = sos.created_at ? new Date(sos.created_at).toLocaleTimeString('hi-IN', { hour: '2-digit', minute: '2-digit' }) : 'अभी';

    box.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <b style="font-size:15px;">🚨 SOS अलर्ट (${timeStr})</b>
            <button onclick="stopSosBuzzer(); document.getElementById('liveSosAlertBox').remove();" style="background:rgba(255,255,255,0.2); border:none; color:#fff; border-radius:6px; padding:2px 8px; cursor:pointer; font-weight:bold;">✖</button>
        </div>
        <div style="background:#ffeb3b; color:#b71c1c; padding:4px 8px; border-radius:6px; font-weight:bold; font-size:12.5px; margin-bottom:7px;">
            🚩 यात्रा: ${yatraName}
        </div>
        <div style="font-size:13px; line-height:1.55;">
            <div><b>🆘 सहायता:</b> ${sos.help_type || 'Emergency'}</div>
            <div><b>👤 यात्री:</b> ${sos.user_name || 'Registered Yatri'}</div>
            <div><b>📞 मोबाइल:</b> <a href="tel:${sos.user_mobile}" style="color:#ffeb3b; font-weight:bold;">${sos.user_mobile || 'N/A'}</a></div>
        </div>
        <div style="display:flex; gap:6px; margin-top:10px;">
            <a href="tel:${sos.user_mobile}" onclick="stopSosBuzzer()" style="flex:1; text-align:center; background:#2e7d32; color:#fff; text-decoration:none; padding:7px; border-radius:6px; font-weight:bold; font-size:12px;">📞 कॉल</a>
            <a href="${mapUrl}" target="_blank" onclick="stopSosBuzzer()" style="flex:1; text-align:center; background:#fff; color:#b71c1c; text-decoration:none; padding:7px; border-radius:6px; font-weight:bold; font-size:12px;">📍 मैप</a>
            <button type="button" onclick="stopSosBuzzer()" style="background:#212121; color:#fff; border:none; padding:7px 9px; border-radius:6px; font-weight:bold; font-size:12px; cursor:pointer;">🔇 शांत</button>
        </div>
    `;
}

async function startLiveSosListener() {
    if (sosRealtimeChannel) {
        try { await supabaseClient.removeChannel(sosRealtimeChannel); } catch (e) {}
        sosRealtimeChannel = null;
    }

    const cleanRole = (window.currentProfile.role || '').toLowerCase().trim().replace(/\s+/g, '_');
    const isGlobalAdmin = (cleanRole === 'super_admin' || cleanRole === 'admin');
    const assignedYatraId = window.currentProfile.assigned_yatra_id;

    // 1. Pichhle 30 minute ka sirf sambandhit yatra ka taza SOS dikhayein
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    let query = supabaseClient
        .from('sos_alerts')
        .select('*')
        .gte('created_at', thirtyMinsAgo)
        .order('created_at', { ascending: false })
        .limit(1);

    if (!isGlobalAdmin && assignedYatraId) {
        query = query.eq('yatra_id', assignedYatraId);
    }

    const { data: recentSos } = await query;
    if (recentSos && recentSos.length > 0) {
        showIncomingSosBanner(recentSos[0]);
    }

    // 2. Realtime channel subscribe karein (Sevadar/Moderator ke liye yatra_id filter ke saath)
    const filterConfig = (!isGlobalAdmin && assignedYatraId)
        ? { event: 'INSERT', schema: 'public', table: 'sos_alerts', filter: `yatra_id=eq.${assignedYatraId}` }
        : { event: 'INSERT', schema: 'public', table: 'sos_alerts' };

    sosRealtimeChannel = supabaseClient
        .channel('public:sos_alerts')
        .on('postgres_changes', filterConfig, (payload) => {
            if (payload && payload.new) {
                showIncomingSosBanner(payload.new);
            }
        })
        .subscribe();
}