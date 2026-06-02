/**
 * YoCapi Birthday — Frontend App
 */

// ─── Estado ──────────────────────────────────────────────────────────────────
let currentSession = null;

const MONTHS = [
    '', 'Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showState(id) {
    const states = [
        'state-loading','state-login','state-not-follower',
        'state-register','state-registered','state-error','state-offline'
    ];
    states.forEach(s => {
        const el = $(s);
        if (el) el.style.display = (s === id) ? (s === 'state-loading' || s === 'state-not-follower' || s === 'state-error' || s === 'state-offline' ? 'flex' : 'block') : 'none';
    });

    // Show hero section only on the login state
    const hero = $('hero-section');
    if (hero) hero.style.display = (id === 'state-login') ? 'block' : 'none';
}

async function api(method, path, body) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' }
    };
    if (currentSession) opts.headers['Authorization'] = 'Bearer ' + currentSession;
    if (body) opts.body = JSON.stringify(body);

    try {
        const res = await fetch(BACKEND_URL + path, opts);
        const data = await res.json();
        return { ok: res.ok, status: res.status, data };
    } catch (e) {
        return { ok: false, status: 0, data: { error: e.message }, offline: true };
    }
}

function formatBirthday(month, day) {
    return `${day} de ${MONTHS[month]}`;
}

function updateUserPill(session) {
    if (!session) {
        $('user-pill').style.display = 'none';
        return;
    }
    $('user-pill').style.display = 'flex';
    $('user-avatar').src = session.profile_image || '';
    $('user-name').textContent = session.display_name;
}

// ─── Poblar selector de días ──────────────────────────────────────────────────
function populateDays(month) {
    const sel = $('pick-day');
    const current = sel.value;
    sel.innerHTML = '<option value="">—</option>';
    const max = month ? new Date(2000, month, 0).getDate() : 31;
    for (let d = 1; d <= max; d++) {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        sel.appendChild(opt);
    }
    if (current && parseInt(current) <= max) sel.value = current;
}

// ─── Cargar stats del footer ──────────────────────────────────────────────────
async function loadStats() {
    const r = await api('GET', '/api/stats');
    if (r.ok && r.data.total > 0) {
        $('footer-count').textContent = `${r.data.total} cumpleaños registrados`;
    }
}

// ─── Inicializar ──────────────────────────────────────────────────────────────
async function init() {
    // Leer sesión de la URL (después del redirect OAuth)
    const params = new URLSearchParams(window.location.search);
    const sessionFromUrl = params.get('session');
    const error = params.get('error');

    // Limpiar URL
    window.history.replaceState({}, '', window.location.pathname);

    // Leer sesión guardada en localStorage
    const savedSession = localStorage.getItem('bday_session');

    showState('state-loading');

    // Error del backend
    if (error) {
        handleError(error);
        return;
    }

    // Si llegó una sesión nueva desde el OAuth redirect
    if (sessionFromUrl) {
        localStorage.setItem('bday_session', sessionFromUrl);
        currentSession = sessionFromUrl;
    } else if (savedSession) {
        currentSession = savedSession;
    }

    // Verificar estado del servidor
    const statusRes = await api('GET', '/api/config/status');
    if (statusRes.offline || statusRes.status === 0) {
        showState('state-offline');
        return;
    }

    // Si hay sesión, obtener datos del usuario
    if (currentSession) {
        const meRes = await api('GET', '/api/me');
        if (meRes.ok) {
            const me = meRes.data;
            updateUserPill(me);

            if (me.birthday) {
                showRegistered(me.birthday, me.sounds);
            } else {
                showRegisterForm(me);
            }
            loadStats();
            return;
        } else {
            // Sesión expirada
            localStorage.removeItem('bday_session');
            currentSession = null;
        }
    }

    // Sin sesión → mostrar login
    showState('state-login');
    loadStats();
}

function handleError(errorCode) {
    const messages = {
        not_follower:     'Necesitas seguir el canal de yocapi_pr para registrar tu cumpleaños.',
        streamer_not_setup: 'El sistema aún no está completamente configurado. Intenta más tarde.',
        auth_failed:      'No se pudo completar la autenticación con Twitch.',
        invalid_state:    'La sesión de autorización expiró. Intenta de nuevo.',
    };

    if (errorCode === 'not_follower') {
        showState('state-not-follower');
        return;
    }

    $('error-msg').textContent = messages[errorCode] || `Error: ${errorCode}`;
    showState('state-error');
}

function showRegisterForm(me) {
    $('register-avatar').src = me.profile_image || '';
    $('register-username').textContent = me.display_name;
    populateDays(null);
    showState('state-register');
}

function showRegistered(birthday, sounds) {
    const dateStr = formatBirthday(birthday.month, birthday.day);
    $('reg-date-display').textContent = dateStr;
    $('reg-info-date').textContent = dateStr;
    renderSoundsPreview(sounds || []);
    showState('state-registered');
}

// ─── Sounds Preview ───────────────────────────────────────────────────────────
let previewAudio = null;
let previewPlayBtn = null;

function stopPreviewAudio() {
    if (previewAudio) {
        previewAudio.pause();
        previewAudio.currentTime = 0;
        previewAudio = null;
    }
    if (previewPlayBtn) {
        previewPlayBtn.textContent = '▶';
        previewPlayBtn.style.background = 'linear-gradient(135deg, var(--twitch), var(--twitch-dk))';
        previewPlayBtn.style.boxShadow = '0 2px 10px rgba(145,70,255,0.35)';
        previewPlayBtn.style.animation = 'none';
        const waveform = previewPlayBtn.closest('.sound-mini-card')?.querySelector('.sound-mini-wave');
        if (waveform) waveform.classList.remove('active');
        previewPlayBtn = null;
    }
}

function renderSoundsPreview(sounds) {
    const section = $('sounds-preview-section');
    const list    = $('sounds-preview-list');
    if (!sounds || sounds.length === 0) {
        section.style.display = 'none';
        return;
    }
    section.style.display = 'block';
    list.innerHTML = '';

    sounds.forEach(sound => {
        if (!sound.file) return;
        const card = document.createElement('div');
        card.className = 'sound-mini-card';
        card.innerHTML = `
            <button class="sound-mini-play" title="Escuchar vista previa">▶</button>
            <div class="sound-mini-info">
                <div class="sound-mini-name">${sound.name || sound.file.replace('.mp3','')}</div>
                <div class="sound-mini-sub">🎵 ${sound.file}</div>
            </div>
            <div class="sound-mini-wave">
                ${[0.5,0.8,1,0.6,0.9,0.5,0.7].map((h,i) =>
                    `<span style="height:${Math.round(h*14)}px;--d:${(0.5+i*0.1).toFixed(1)}s;--dl:${(i*0.07).toFixed(2)}s"></span>`
                ).join('')}
            </div>
        `;

        const playBtn = card.querySelector('.sound-mini-play');
        playBtn.addEventListener('click', () => {
            if (previewPlayBtn === playBtn) {
                stopPreviewAudio();
                return;
            }
            stopPreviewAudio();

            const audio = new Audio(`music/${sound.file}`);
            previewAudio = audio;
            previewPlayBtn = playBtn;

            playBtn.textContent = '⏸';
            playBtn.style.background = 'linear-gradient(135deg, #3ddc84, #28a865)';
            playBtn.style.boxShadow = '0 2px 10px rgba(61,220,132,0.4)';
            playBtn.style.animation = 'sound-pulse 1s ease-in-out infinite';
            card.querySelector('.sound-mini-wave').classList.add('active');

            audio.play().catch(() => stopPreviewAudio());
            audio.addEventListener('ended', () => stopPreviewAudio());
        });

        list.appendChild(card);
    });
}

// ─── Login ────────────────────────────────────────────────────────────────────
$('btn-login').addEventListener('click', () => {
    window.location.href = BACKEND_URL + '/auth/twitch/user';
});

$('btn-retry').addEventListener('click', () => {
    window.location.href = BACKEND_URL + '/auth/twitch/user';
});

// ─── Logout ───────────────────────────────────────────────────────────────────
$('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('bday_session');
    currentSession = null;
    updateUserPill(null);
    showState('state-login');
});

// ─── Date picker logic ────────────────────────────────────────────────────────
$('pick-month').addEventListener('change', function() {
    populateDays(parseInt(this.value) || null);
    validateDatePicker();
});
$('pick-day').addEventListener('change', validateDatePicker);

function validateDatePicker() {
    const m = $('pick-month').value;
    const d = $('pick-day').value;
    $('btn-register').disabled = !(m && d);
}

// ─── Registrar ────────────────────────────────────────────────────────────────
$('btn-register').addEventListener('click', async () => {
    const month = parseInt($('pick-month').value);
    const day   = parseInt($('pick-day').value);
    if (!month || !day) return;

    $('btn-register').disabled = true;
    $('btn-register').textContent = 'Guardando...';

    const r = await api('POST', '/api/birthday/register', { month, day });
    if (r.ok) {
        // Actualizar la vista de usuario
        const meRes = await api('GET', '/api/me');
        if (meRes.ok) updateUserPill(meRes.data);
        showRegistered({ month, day }, meRes.ok ? meRes.data.sounds : []);
        loadStats();
    } else {
        $('btn-register').disabled = false;
        $('btn-register').textContent = 'Registrar cumpleaños 🎉';
        alert('Error al registrar: ' + (r.data?.error || 'Inténtalo de nuevo'));
    }
});

// ─── Cambiar fecha ────────────────────────────────────────────────────────────
$('btn-change').addEventListener('click', async () => {
    const meRes = await api('GET', '/api/me');
    if (meRes.ok) {
        const me = meRes.data;
        if (me.birthday) {
            let changesCount = me.birthday.changes_count || 0;
            let lastChanged = me.birthday.last_changed_at ? new Date(me.birthday.last_changed_at) : null;
            
            if (changesCount >= 1 && lastChanged) {
                const nextAllowed = new Date(lastChanged);
                nextAllowed.setMonth(nextAllowed.getMonth() + 6);
                if (new Date() < nextAllowed) {
                    alert(`Debes esperar 6 meses desde tu último cambio para volver a modificar tu fecha. Podrás cambiarla a partir del ${nextAllowed.toLocaleDateString()}.`);
                    return;
                }
            }
            
            if (changesCount === 0) {
                if (!confirm('Esta será tu única oportunidad de cambiar la fecha, no podrás volver a hacerlo hasta dentro de 6 meses. ¿Estás seguro de continuar?')) {
                    return;
                }
            }
        }
        showRegisterForm(meRes.data);
    }
});

// ─── Error back ───────────────────────────────────────────────────────────────
$('btn-error-back').addEventListener('click', () => {
    window.location.reload();
});

$('btn-offline-retry').addEventListener('click', () => {
    window.location.reload();
});

// ─── Arrancar ────────────────────────────────────────────────────────────────
init();
