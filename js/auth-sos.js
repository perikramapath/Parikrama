// =========================================================
// PARIKRAMAPATH - AUTH, COMPLETE PROFILE EDIT, ID CARD & SOS
// =========================================================

let profileVideoStream = null;
let capturedSelfieBase64 = null;

function populateSevadarYatraDropdown(yatras) {
    const sel = document.getElementById('regSevadarYatra');
    if (sel) {
        sel.innerHTML = yatras.map(y => `<option value="${y.id}">${y.name_hi || y.name}</option>`).join('');
    }
}

function onRoleChange() {
    document.getElementById('sevadarRegFields').style.display =
        document.getElementById('regRole').value === 'supporter' ? 'block' : 'none';
}

// 1. User / Sevadar Registration
async function registerUser() {
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPass').value.trim();
    const full_name = document.getElementById('regName').value.trim();
    const mobile = document.getElementById('regMobile').value.trim();
    const role = document.getElementById('regRole').value;

    if (!email || !password || !full_name || !mobile) {
        return alert("कृपया सभी आवश्यक जानकारी (नाम, मोबाइल, ईमेल, पासवर्ड) भरें।");
    }

    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    if (error) return alert("Registration Error: " + error.message);

    if (data && data.user) {
        const { error: profErr } = await supabaseClient.from('profiles').insert([{
            id: data.user.id,
            full_name,
            mobile,
            email,
            role,
            status: role === 'supporter' ? 'pending' : 'approved',
            assigned_yatra_id: role === 'supporter' ? document.getElementById('regSevadarYatra').value : null,
            sevadar_area: role === 'supporter' ? document.getElementById('regSevadarArea').value.trim() : null
        }]);

        if (profErr) console.error("Profile insert warning:", profErr.message);
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

    // ID Card Display Fill
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

    // Complete Profile Edit Form Inputs Pre-fill
    const nameInput = document.getElementById('profileFullNameInput');
    const mobileInput = document.getElementById('profileMobileInput');
    const bloodInput = document.getElementById('profileBloodGroupInput');
    if (nameInput) nameInput.value = p.full_name || '';
    if (mobileInput) mobileInput.value = p.mobile || '';
    if (bloodInput) bloodInput.value = p.blood_group || '';
    document.getElementById('profileEmergencyInput').value = p.emergency_contact || '';
    document.getElementById('profileAddressInput').value = p.address || '';

    // Hide "Complete Yatra" button if user is on Home Gate
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

    // Dynamic QR Code Generate
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

    // Journey History Render
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
        address: address || null
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
        })
        .select()
        .single();

    if (error) return alert("Profile Update Error: " + error.message);

    window.currentProfile = data;
    capturedSelfieBase64 = null;

    // Home Gate button par bhi naya naam update karein
    const gateProfileBtn = document.getElementById('gateProfileBtn');
    if (gateProfileBtn) {
        const firstName = (data.full_name || 'Profile').split(' ')[0];
        gateProfileBtn.innerText = `🪪 ${firstName}`;
    }

    alert("✅ आपका प्रोफ़ाइल विवरण और ID Pass सफलतापूर्वक अपडेट हो गया है!");
    openProfileModal();
}

// Backward compatibility alias
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

// 7. Geo-Fenced Smart SOS (Strictly Linked to Active Yatra)
function openSOSModal() {
    if (!window.activeYatra) return;
    document.getElementById('sosYatraName').innerText = window.activeYatra.name;
    showModal('sosModal');
}

function triggerSOS(helpType) {
    if (!navigator.geolocation) return alert("आपके डिवाइस में GPS उपलब्ध नहीं है।");

    navigator.geolocation.getCurrentPosition(async (pos) => {
        const { error } = await supabaseClient.from('sos_alerts').insert([{
            user_id: window.currentUser ? window.currentUser.id : null,
            user_name: window.currentProfile ? window.currentProfile.full_name : 'Guest Yatri',
            user_mobile: window.currentProfile ? window.currentProfile.mobile : 'N/A',
            yatra_id: window.activeYatra.id,
            help_type: helpType,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
        }]);

        if (error) return alert("SOS Error: " + error.message);

        closeAllModals();
        alert(`🚨 SOS भेज दिया गया है! ${window.activeYatra.name} के नजदीकी सेवादारों को आपकी लोकेशन मिल गई है।`);
    }, () => {
        alert("GPS लोकेशन नहीं मिल सकी। कृपया लोकेशन परमिशन चालू करें।");
    });
}