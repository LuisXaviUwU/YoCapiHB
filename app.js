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

function customAlert(text) {
    return new Promise(resolve => {
        const modal = $('custom-modal');
        if (!modal) { alert(text); return resolve(); }
        $('modal-title').textContent = 'Atención';
        $('modal-text').textContent = text;
        $('modal-btn-cancel').style.display = 'none';
        
        $('modal-btn-ok').onclick = () => {
            modal.style.display = 'none';
            resolve();
        };
        modal.style.display = 'flex';
    });
}

function customConfirm(text) {
    return new Promise(resolve => {
        const modal = $('custom-modal');
        if (!modal) { return resolve(confirm(text)); }
        $('modal-title').textContent = 'Confirmación';
        $('modal-text').textContent = text;
        $('modal-btn-cancel').style.display = 'block';
        
        $('modal-btn-cancel').onclick = () => {
            modal.style.display = 'none';
            resolve(false);
        };
        $('modal-btn-ok').onclick = () => {
            modal.style.display = 'none';
            resolve(true);
        };
        modal.style.display = 'flex';
    });
}

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
    populateDays(me.birthday ? me.birthday.month : null);
    
    // Render sound selection
    const soundsSection = $('register-sounds-section');
    const soundsList = $('register-sounds-list');
    soundsList.innerHTML = '';
    
    if (me.sounds && me.sounds.length > 0) {
        soundsSection.style.display = 'block';
        me.sounds.forEach((sound, idx) => {
            const isChecked = (me.birthday && me.birthday.selected_sound === sound.file) || (!me.birthday && idx === 0);
            const label = document.createElement('label');
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.style.gap = '10px';
            label.style.padding = '8px';
            label.style.background = 'rgba(255,255,255,0.05)';
            label.style.borderRadius = '8px';
            label.style.cursor = 'pointer';
            label.style.border = '1px solid rgba(255,255,255,0.1)';
            
            label.innerHTML = `
                <input type="radio" name="sound_selection" value="${sound.file}" ${isChecked ? 'checked' : ''} style="accent-color: var(--twitch);">
                <div style="flex:1;">
                    <div style="font-weight:700; font-size:0.9rem;">${sound.name || sound.file.replace('.mp3','')}</div>
                </div>
            `;
            soundsList.appendChild(label);
        });
    } else {
        soundsSection.style.display = 'none';
    }

    showState('state-register');
}

function showRegistered(birthday, sounds) {
    const dateStr = formatBirthday(birthday.month, birthday.day);
    $('reg-date-display').textContent = dateStr;
    $('reg-info-date').textContent = dateStr;
    
    // Verificar si HOY es el cumpleaños del usuario (hora local)
    const now = new Date();
    const todayMonth = now.getMonth() + 1;
    const todayDay   = now.getDate();
    const isTodayBirthday = (birthday.month === todayMonth && birthday.day === todayDay);

    const cdNote = $('global-cooldown-note');
    if (cdNote) {
        cdNote.style.display = isTodayBirthday ? 'block' : 'none';
        if (isTodayBirthday) {
            cdNote.innerHTML = `✨ ¡Feliz cumpleaños! 🎉<br><span style="font-size:0.8rem; font-weight:400; color:var(--text-dim);">Puedes lanzar todos los sonidos al stream, 1 vez cada uno. Hay 5 min de espera entre cada alerta.</span>`;
        }
    }

    renderSoundsPreview(sounds || [], birthday, isTodayBirthday);

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

function renderSoundsPreview(sounds, birthday = null, isTodayBirthday = false) {
    const section = $('sounds-preview-section');
    const list    = $('sounds-preview-list');
    if (!sounds || sounds.length === 0) {
        section.style.display = 'none';
        return;
    }
    section.style.display = 'block';
    list.innerHTML = '';

    const playedSounds = birthday && birthday.played_sounds ? birthday.played_sounds : [];

    sounds.forEach(sound => {
        if (!sound.file) return;
        const card = document.createElement('div');
        card.className = 'sound-mini-card';
        card.style.display = 'flex';
        card.style.alignItems = 'center';
        card.style.flexWrap = 'wrap';

        const isPlayed = playedSounds.includes(sound.file);

        card.innerHTML = `
            <div style="display:flex; align-items:center; flex:1; min-width:200px;">
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
            </div>
            ${isTodayBirthday ? `
                <div style="margin-left:auto; margin-top:5px;">
                    <button class="btn-launch-sound" data-file="${sound.file}" 
                            style="background: ${isPlayed ? 'rgba(255,255,255,0.1)' : 'var(--twitch)'}; 
                                   color: ${isPlayed ? '#888' : '#fff'};
                                   border: none; padding: 8px 14px; border-radius: 8px; font-weight: 700; cursor: ${isPlayed ? 'not-allowed' : 'pointer'};
                                   transition: all 0.2s;" ${isPlayed ? 'disabled' : ''}>
                        ${isPlayed ? '✅ Ya lanzado' : '🚀 Lanzar al stream'}
                    </button>
                </div>
            ` : ''}
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

        // Launch alert to stream logic
        const launchBtn = card.querySelector('.btn-launch-sound');
        if (launchBtn && !isPlayed) {
            launchBtn.addEventListener('click', async () => {
                launchBtn.disabled = true;
                launchBtn.innerHTML = '⏳ Enviando...';
                
                const r = await api('POST', '/api/birthday/alert', { sound_file: sound.file });
                if (r.ok) {
                    launchBtn.innerHTML = '✅ Ya lanzado';
                    launchBtn.style.background = 'rgba(255,255,255,0.1)';
                    launchBtn.style.color = '#888';
                    launchBtn.style.cursor = 'not-allowed';
                    
                    const cdNote = $('global-cooldown-note');
                    if (cdNote) {
                        cdNote.innerHTML = `¡Enviado! 🎉<br><span style="font-size:0.8rem; font-weight:400; color:var(--text-dim);">Debes esperar 5 minutos para lanzar otra alerta diferente.</span>`;
                    }
                } else {
                    launchBtn.disabled = false;
                    launchBtn.innerHTML = '🚀 Lanzar al stream';
                    const msg = r.data?.error || 'Error desconocido';
                    await customAlert('Error: ' + msg);
                }
            });
        }

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

    // Obtener sonido seleccionado
    const selectedSoundInput = document.querySelector('input[name="sound_selection"]:checked');
    const selected_sound = selectedSoundInput ? selectedSoundInput.value : null;

    // Confirmación de que no se podrá cambiar en 6 meses
    const dateStr = `${day} de ${$('pick-month').options[$('pick-month').selectedIndex].text}`;
    const confirmed = await customConfirm(`¿Confirmas que tu cumpleaños es el ${dateStr}? No podrás volver a cambiar la fecha hasta dentro de 6 meses.`);
    if (!confirmed) return;

    $('btn-register').disabled = true;
    $('btn-register').textContent = 'Guardando...';

    const r = await api('POST', '/api/birthday/register', { month, day, selected_sound });
    if (r.ok) {
        // Actualizar la vista de usuario
        const meRes = await api('GET', '/api/me');
        if (meRes.ok) updateUserPill(meRes.data);
        showRegistered(meRes.ok ? meRes.data.birthday : { month, day }, meRes.ok ? meRes.data.sounds : []);
        loadStats();
    } else {
        $('btn-register').disabled = false;
        $('btn-register').textContent = 'Registrar cumpleaños 🎉';
        await customAlert('Error al registrar: ' + (r.data?.error || 'Inténtalo de nuevo'));
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
                    await customAlert(`Debes esperar 6 meses desde tu último cambio para volver a modificar tu fecha. Podrás cambiarla a partir del ${nextAllowed.toLocaleDateString()}.`);
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
