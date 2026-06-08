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
    // Leer parámetros de la URL (después del redirect OAuth)
    const params = new URLSearchParams(window.location.search);
    const authCode = params.get('code');   // código devuelto por Twitch
    const returnedState = params.get('state');
    const error    = params.get('error');

    // Limpiar URL inmediatamente para no dejar rastro del código
    window.history.replaceState({}, '', window.location.pathname);

    // Leer sesión guardada en localStorage
    const savedSession = localStorage.getItem('bday_session');

    showState('state-loading');

    // Error devuelto
    if (error) {
        handleError(error);
        return;
    }

    // Si llegó un código de Twitch, canjearlo por el token real
    if (authCode) {
        const savedState = sessionStorage.getItem('oauth_state');
        if (savedState && returnedState !== savedState) {
            handleError('invalid_state');
            return;
        }
        sessionStorage.removeItem('oauth_state');

        const exchRes = await api('POST', '/api/auth/exchange-viewer-code', { code: authCode });
        if (exchRes.ok && exchRes.data.token) {
            localStorage.setItem('bday_session', exchRes.data.token);
            currentSession = exchRes.data.token;
        } else {
            handleError(exchRes.data?.error || 'auth_failed');
            return;
        }
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
            const container = document.createElement('div');
            container.className = 'sound-mini-card';
            container.style.display = 'flex';
            container.style.alignItems = 'center';
            container.style.gap = '10px';
            container.style.padding = '8px';
            container.style.background = 'rgba(255,255,255,0.05)';
            container.style.borderRadius = '8px';
            container.style.border = '1px solid rgba(255,255,255,0.1)';
            
            container.innerHTML = `
                <label style="display:flex; align-items:center; gap:10px; cursor:pointer; flex:1;">
                    <input type="radio" name="sound_selection" value="${sound.file}" ${isChecked ? 'checked' : ''} style="accent-color: var(--twitch);">
                    <div style="font-weight:700; font-size:0.9rem;">${sound.name || sound.file.replace('.mp3','')}</div>
                </label>
                <button type="button" class="sound-mini-play" title="Escuchar vista previa">▶</button>
            `;

            const playBtn = container.querySelector('.sound-mini-play');
            playBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
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

                audio.play().catch(() => stopPreviewAudio());
                audio.addEventListener('ended', () => stopPreviewAudio());
            });

            soundsList.appendChild(container);
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
    
    // Verificar si HOY es el cumpleaños del usuario (hora México, igual que el backend)
    const now = new Date();
    const mxParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
    const ty = parseInt(mxParts.find(p => p.type === 'year').value);
    const todayMonth = parseInt(mxParts.find(p => p.type === 'month').value);
    const todayDay   = parseInt(mxParts.find(p => p.type === 'day').value);
    const isTodayBirthday = (birthday.month === todayMonth && birthday.day === todayDay);

    const todayDate = new Date(ty, todayMonth - 1, todayDay);
    let bdayDate = new Date(ty, birthday.month - 1, birthday.day);
    if (bdayDate < todayDate) {
        bdayDate = new Date(ty + 1, birthday.month - 1, birthday.day);
    }
    const diffTime = bdayDate - todayDate;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    const cdEl = $('reg-info-countdown');
    if (cdEl) {
        if (diffDays === 0) {
            cdEl.innerHTML = '¡Es hoy! <span style="font-size:1.2em;">🎉</span>';
            cdEl.style.color = '#3ddc84';
        } else if (diffDays === 1) {
            cdEl.textContent = '1 día';
            cdEl.style.color = 'var(--twitch-lt)';
        } else {
            cdEl.textContent = `${diffDays} días`;
            cdEl.style.color = 'var(--twitch-lt)';
        }
    }

    const cdNote = $('global-cooldown-note');
    if (cdNote) {
        cdNote.style.display = isTodayBirthday ? 'block' : 'none';
        if (isTodayBirthday) {
            cdNote.innerHTML = `✨ ¡Feliz cumpleaños! 🎉<br><span style="font-size:0.8rem; font-weight:400; color:var(--text-dim);">Puedes lanzar tu sonido de alerta al stream (1 sola vez).</span>`;
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
    const selectedSound = birthday ? birthday.selected_sound : null;

    let orderedSounds = [];
    if (selectedSound) {
        const mySound = sounds.find(s => s.file === selectedSound);
        if (mySound) {
            mySound.isMySound = true;
            orderedSounds.push(mySound);
        }
        const others = sounds.filter(s => s.file !== selectedSound);
        orderedSounds.push(...others);
    } else {
        orderedSounds = [...sounds];
    }

    let isFirstOther = true;

    orderedSounds.forEach(sound => {
        if (!sound.file) return;

        if (!sound.isMySound && selectedSound && isFirstOther) {
            const header = document.createElement('div');
            header.style.cssText = 'font-size:0.75rem; color:var(--text-dim); font-weight:600; margin-top:10px; margin-bottom:5px; text-transform:uppercase; letter-spacing:1px;';
            header.textContent = 'Otros sonidos (solo vista previa)';
            list.appendChild(header);
            isFirstOther = false;
        } else if (sound.isMySound) {
            const header = document.createElement('div');
            header.style.cssText = 'font-size:0.85rem; color:var(--text-hi); font-weight:700; margin-bottom:5px; display:flex; align-items:center; gap:6px;';
            header.innerHTML = '✨ Tu sonido elegido';
            list.appendChild(header);
        }

        const card = document.createElement('div');
        card.className = 'sound-mini-card';
        card.style.display = 'flex';
        card.style.alignItems = 'center';
        card.style.flexWrap = 'wrap';

        if (sound.isMySound) {
            card.style.border = '1px solid rgba(61, 220, 132, 0.4)';
            card.style.background = 'rgba(61, 220, 132, 0.05)';
        }

        const isPlayed = playedSounds.includes(sound.file);
        const canLaunch = isTodayBirthday && sound.isMySound;

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
            ${canLaunch ? `
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
async function doViewerLogin() {
    showState('state-loading');
    const r = await api('GET', '/api/config/public');
    if (r.ok && r.data.client_id) {
        // Generar state aleatorio
        const state = Math.random().toString(36).substring(2, 15);
        sessionStorage.setItem('oauth_state', state);

        const redirectUri = (r.data.frontend_url || window.location.origin + window.location.pathname).replace(/\/$/, '') + '/';

        const params = new URLSearchParams({
            client_id: r.data.client_id,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'user:read:follows',
            state: state
        });
        window.location.href = 'https://id.twitch.tv/oauth2/authorize?' + params.toString();
    } else {
        handleError('streamer_not_setup');
    }
}

$('btn-login').addEventListener('click', doViewerLogin);
$('btn-retry').addEventListener('click', doViewerLogin);

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
            let lastChanged = me.birthday.last_changed_at ? new Date(me.birthday.last_changed_at) : new Date(me.birthday.registered_at);
            
            if (lastChanged) {
                const nextAllowed = new Date(lastChanged);
                nextAllowed.setMonth(nextAllowed.getMonth() + 6);
                if (new Date() < nextAllowed) {
                    await customAlert(`Debes esperar 6 meses desde tu último registro o cambio. Podrás modificar tu fecha a partir del ${nextAllowed.toLocaleDateString()}.`);
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
window.addEventListener('pageshow', (e) => {
    // Si el usuario regresa usando el botón 'Atrás', sacarlo de la pantalla de carga
    if (e.persisted) {
        init();
    }
});
init();
