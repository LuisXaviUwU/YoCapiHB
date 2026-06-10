/**
 * YoCapi Birthday — Frontend App
 */

// ─── Estado ──────────────────────────────────────────────────────────────────
let currentSession = null;
let selectedLaunchSoundFile = null;
const BIRTHDAY_ALERT_COOLDOWN_MS = 30_000;
let cooldownRefreshTimer = null;

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

function formatCooldown(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) {
        return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
    }
    return `${seconds}s`;
}

function clearCooldownTimer() {
    if (cooldownRefreshTimer) {
        clearTimeout(cooldownRefreshTimer);
        cooldownRefreshTimer = null;
    }
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
                showRegistered(me);
            } else {
                showRegisterForm(me);
            }
            loadStats();
            loadCommunityUpcoming();
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

    if (errorCode.startsWith('not_follower')) {
        showState('state-not-follower');
        return;
    }

    $('error-msg').textContent = messages[errorCode] || `Error: ${errorCode}`;
    showState('state-error');
}

function showRegisterForm(me) {
    $('register-avatar').src = me.profile_image || '';
    $('register-username').textContent = me.display_name;
    if (me.birthday) {
        $('pick-month').value = me.birthday.month;
        populateDays(me.birthday.month);
        $('pick-day').value = me.birthday.day;
    } else {
        $('pick-month').value = "";
        populateDays(null);
        $('pick-day').value = "";
    }
    
    let disableDate = false;
    let nextAllowedStr = '';
    if (me.birthday) {
        let lastChanged = me.birthday.last_changed_at ? new Date(me.birthday.last_changed_at) : new Date(me.birthday.registered_at);
        if (lastChanged) {
            const nextAllowed = new Date(lastChanged);
            nextAllowed.setMonth(nextAllowed.getMonth() + 6);
            if (new Date() < nextAllowed) {
                disableDate = true;
                nextAllowedStr = nextAllowed.toLocaleDateString();
            }
        }
    }
    
    $('pick-month').disabled = disableDate;
    $('pick-day').disabled = disableDate;
    
    const dateWarning = $('date-warning-msg');
    if (dateWarning) {
        if (disableDate) {
            dateWarning.innerHTML = `⚠️ La fecha está bloqueada hasta el ${nextAllowedStr}.<br>Aún así, <strong>puedes editar tu sonido</strong> libremente.`;
            dateWarning.style.display = 'block';
        } else {
            dateWarning.style.display = 'none';
        }
    }

    // Render sound selection
    const soundsSection = $('register-sounds-section');
    const soundsList = $('register-sounds-list');
    soundsList.innerHTML = '';
    
    if (me.sounds && me.sounds.length > 0) {
        soundsSection.style.display = 'block';
        const helper = soundsSection.querySelector('.register-sounds-helper');
        if (helper) {
            helper.textContent = 'Puedes previsualizarlos ahora y luego lanzar cualquiera de los 3 en tu cumpleaños.';
        }
        me.sounds.forEach((sound, idx) => {
            const container = document.createElement('div');
            container.className = 'sound-mini-card';
            container.style.display = 'flex';
            container.style.alignItems = 'center';
            container.style.gap = '12px';
            container.style.padding = '10px 12px';
            container.style.background = 'rgba(255,255,255,0.05)';
            container.style.borderRadius = '8px';
            container.style.border = '1px solid rgba(255,255,255,0.1)';
            
            container.innerHTML = `
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:700; font-size:0.92rem;">${sound.name || sound.file.replace('.mp3','')}</div>
                    <div style="font-size:0.76rem; color:var(--text-dim); margin-top:2px;">Vista previa del audio disponible</div>
                </div>
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

    validateDatePicker();
    showState('state-register');
}

// ─── Próximos Cumpleaños de la Comunidad ──────────────────────────────────────
async function loadCommunityUpcoming() {
    const res = await api('GET', '/api/community/upcoming');
    const section = $('section-community');
    const list = $('community-upcoming-list');
    
    if (!section || !list) return;

    if (!res.ok || !res.data || !res.data.upcoming || res.data.upcoming.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    list.innerHTML = '';

    res.data.upcoming.forEach(u => {
        const isToday = u.daysFromNow === 0;
        const avatarUrl = u.profile_image || 'https://static-cdn.jtvnw.net/jtv_user_pictures/8a6381c7-d0c0-4576-b179-38bd5ce1d6af-profile_image-70x70.png';
        const dateStr = formatBirthday(u.birth_month, u.birth_day);
        
        const card = document.createElement('div');
        card.className = `community-card ${isToday ? 'community-today' : ''}`;
        
        card.innerHTML = `
            <img class="community-avatar" src="${avatarUrl}" alt="${u.display_name}">
            <div class="community-name">${u.display_name}</div>
            <div class="community-date">${dateStr}</div>
            ${isToday ? `<div class="community-today-badge">¡Es hoy! 🎉</div>` : `<div style="font-size:0.65rem; color:var(--text-dim); margin-top:2px;">${u.daysFromNow === 1 ? 'Mañana' : 'En ' + u.daysFromNow + ' días'}</div>`}
        `;
        
        list.appendChild(card);
    });
}

function showRegistered(me) {
    const birthday = me.birthday;
    const sounds = me.sounds;
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

    const badgeContainer = $('birthday-badge-container');
    if (badgeContainer) {
        if (isTodayBirthday) {
            badgeContainer.innerHTML = `<div style="display:inline-block; background:linear-gradient(135deg, var(--twitch), #ff6bcb); color:#fff; font-weight:bold; padding:8px 16px; border-radius:20px; font-size:1rem; box-shadow:0 4px 15px rgba(255, 107, 203, 0.4); animation:sound-pulse 2s infinite;">🎂 ¡Feliz Cumpleaños, ${me.display_name || 'Cumpleañero'}! 🎂</div>`;
            badgeContainer.style.display = 'block';
        } else {
            badgeContainer.style.display = 'none';
        }
    }

    const cdNote = $('global-cooldown-note');
    if (cdNote) {
        cdNote.style.display = 'none'; // Se oculta inicialmente, se mostrará tras el éxito de la alerta
    }

    renderSoundsPreview(sounds || [], me, isTodayBirthday, me.obs_connected);

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
        if (previewPlayBtn.id === 'preview-selected-sound') {
            const icon = previewPlayBtn.querySelector('.preview-selected-icon');
            if (icon) icon.textContent = '▶';
            previewPlayBtn.style.background = 'rgba(255,255,255,0.05)';
            previewPlayBtn.style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)';
        } else {
            previewPlayBtn.textContent = '▶';
            previewPlayBtn.style.background = 'linear-gradient(135deg, var(--twitch), var(--twitch-dk))';
            previewPlayBtn.style.boxShadow = '0 2px 10px rgba(145,70,255,0.35)';
            previewPlayBtn.style.animation = 'none';
            const waveform = previewPlayBtn.closest('.sound-mini-card')?.querySelector('.sound-mini-wave');
            if (waveform) waveform.classList.remove('active');
        }
        previewPlayBtn = null;
    }
}

function renderSoundsPreview(sounds, me = null, isTodayBirthday = false, obsConnected = false) {
    const birthday = me ? me.birthday : null;
    const section = $('sounds-preview-section');
    const list    = $('sounds-preview-list');
    const cdNote  = $('global-cooldown-note');

    clearCooldownTimer();
    if (!sounds || sounds.length === 0) {
        section.style.display = 'none';
        if (cdNote) cdNote.style.display = 'none';
        return;
    }
    section.style.display = 'block';
    list.style.display = 'none';

    let controlPanel = $('launch-control-panel');
    if (!controlPanel) {
        controlPanel = document.createElement('div');
        controlPanel.id = 'launch-control-panel';
        controlPanel.style.cssText = 'margin-bottom:14px; padding:16px; border:1px solid var(--border); border-radius:16px; background:linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02)); box-shadow:0 10px 30px rgba(0,0,0,0.18);';
        section.insertBefore(controlPanel, list);
    }
    
    // Si OBS está desconectado, mostrar nota general arriba de los botones
    const obsNoteId = 'obs-connection-note';
    let obsNoteEl = $(obsNoteId);
    if (!obsNoteEl) {
        obsNoteEl = document.createElement('div');
        obsNoteEl.id = obsNoteId;
        section.insertBefore(obsNoteEl, list);
    }
    
    if (isTodayBirthday && !obsConnected) {
        obsNoteEl.innerHTML = `⚠️ OBS no está conectado. No podrás lanzar tu alerta.<br><span style="font-size:0.85em; font-weight:normal;">Cuando yocapi conecte OBS, recarga esta página o espera unos segundos.</span>`;
        obsNoteEl.style.cssText = `text-align:center; padding:10px; background:rgba(255,107,107,0.1); border:1px solid rgba(255,107,107,0.3); border-radius:8px; color:var(--danger); font-weight:bold; font-size:0.9rem; margin-bottom:15px;`;
        obsNoteEl.style.display = 'block';
    } else {
        obsNoteEl.style.display = 'none';
    }
    
    list.innerHTML = '';

    const playedSounds = birthday && birthday.played_sounds ? birthday.played_sounds : [];
    const lastAlertTime = birthday && birthday.last_alert_time ? birthday.last_alert_time : 0;
    const cooldownRemaining = lastAlertTime ? Math.max(0, (lastAlertTime + BIRTHDAY_ALERT_COOLDOWN_MS) - Date.now()) : 0;
    const cooldownActive = isTodayBirthday && cooldownRemaining > 0;

    const availableSounds = sounds.filter(sound => sound && sound.file);
    if (!availableSounds.length) {
        controlPanel.innerHTML = '';
        list.innerHTML = '';
        return;
    }

    const playableSounds = availableSounds.filter(sound => !playedSounds.includes(sound.file));
    if (!selectedLaunchSoundFile || playedSounds.includes(selectedLaunchSoundFile) || !availableSounds.some(sound => sound.file === selectedLaunchSoundFile)) {
        selectedLaunchSoundFile = (playableSounds[0] || availableSounds[0]).file;
    }

    const selectorOptions = availableSounds.map(sound => {
        const isPlayed = playedSounds.includes(sound.file);
        const label = `${sound.name || sound.file.replace('.mp3','')}${isPlayed ? ' (ya lanzado hoy)' : ''}`;
        return `<option value="${sound.file}" ${sound.file === selectedLaunchSoundFile ? 'selected' : ''} ${isPlayed ? 'disabled' : ''}>${label}</option>`;
    }).join('');

    const selectedSoundMeta = availableSounds.find(sound => sound.file === selectedLaunchSoundFile) || availableSounds[0];
    const selectedAlreadyPlayed = playedSounds.includes(selectedSoundMeta.file);

    controlPanel.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:12px;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                <div style="font-size:0.82rem; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-dim);">
                    Elegir audio a lanzar
                </div>
                <div style="font-size:0.72rem; font-weight:700; color:${selectedAlreadyPlayed ? 'var(--danger)' : 'var(--success)'}; text-transform:uppercase; letter-spacing:0.08em;">
                    ${selectedAlreadyPlayed ? 'Ya lanzado' : 'Disponible'}
                </div>
            </div>
            <div style="display:grid; gap:10px; grid-template-columns:minmax(0, 1fr);">
                <label style="display:flex; flex-direction:column; gap:8px;">
                    <span style="font-size:0.78rem; font-weight:700; color:var(--text-dim);">Audio</span>
                    <select id="launch-sound-select" style="width:100%; padding:13px 14px; background:linear-gradient(180deg, rgba(145,70,255,0.12), rgba(0,0,0,0.14)); border:1px solid var(--border-hi); border-radius:12px; color:var(--text-hi); font-family:inherit; font-size:0.96rem; outline:none;">
                        ${selectorOptions}
                    </select>
                </label>
                <button type="button" id="preview-selected-sound" style="display:flex; align-items:center; justify-content:center; gap:10px; width:100%; padding:12px 14px; border:none; border-radius:12px; background:rgba(255,255,255,0.05); color:var(--text-hi); font-family:inherit; font-weight:700; cursor:pointer; box-shadow:0 4px 16px rgba(0,0,0,0.12); transition:transform var(--t), background var(--t), box-shadow var(--t);">
                    <span class="preview-selected-icon" style="width:32px; height:32px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; background:linear-gradient(135deg, var(--twitch), var(--twitch-dk)); color:#fff; flex-shrink:0;">▶</span>
                    <span id="preview-selected-label" style="flex:1; text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Escuchar ${selectedSoundMeta.name || selectedSoundMeta.file.replace('.mp3','')}</span>
                </button>
                ${obsConnected && isTodayBirthday && !cooldownActive ? `
                <div class="pers-row">
                    <label class="pers-label">💬 Mensaje</label>
                    <input type="text" class="custom-alert-msg" maxlength="80"
                        placeholder="Escribe algo especial (opcional)"
                        style="width:100%; padding:7px 10px; border-radius:8px; border:1px solid var(--border); background:rgba(0,0,0,0.25); color:#fff; font-size:0.85rem; font-family:inherit;">
                    <span class="msg-char-counter">0 / 80</span>
                </div>

                <div class="pers-row">
                    <label class="pers-label">🎂 Edad (opcional)</label>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <input type="number" class="custom-alert-age" min="1" max="120" placeholder="Ej: 25"
                            style="width:90px; padding:7px 10px; border-radius:8px; border:1px solid var(--border); background:rgba(0,0,0,0.25); color:#fff; font-size:0.9rem; font-family:inherit; outline:none;">
                        <span style="font-size:0.76rem; color:var(--text-dim);">Aparecerá animada en el overlay</span>
                    </div>
                </div>

                <div class="pers-row">
                    <label class="pers-label">✨ Emoji</label>
                    <div class="emoji-picker">
                        ${['🎉','🎂','🎈','⭐','🦄','🔥','💜','🌸','🌟','👑','🐾','🦫','🍀','🎊','🏆'].map((em, i) =>
                            `<button class="emoji-opt ${i===0?'selected':''}" data-emoji="${em}">${em}</button>`
                        ).join('')}
                    </div>
                </div>

                <div class="pers-row">
                    <label class="pers-label">🎨 Tema de color</label>
                    <div class="theme-picker">
                        ${[
                            {id:'purple',  color:'#9146ff', label:'Morado'},
                            {id:'pink',    color:'#ff6bcb', label:'Rosa'},
                            {id:'gold',    color:'#f7d046', label:'Dorado'},
                            {id:'blue',    color:'#4fc3f7', label:'Azul'},
                            {id:'green',   color:'#3ddc84', label:'Verde'},
                            {id:'red',     color:'#ff5c5c', label:'Rojo'},
                            {id:'capybara',color:'#c9956a', label:'Capibara'},
                            {id:'capinight',color:'#7b5ea7',label:'Capibara Noche'},
                        ].map((t, i) =>
                            `<button class="theme-opt ${i===0?'selected':''}" data-theme="${t.id}" data-color="${t.color}" title="${t.label}"
                                style="background:${t.color};"></button>`
                        ).join('')}
                    </div>
                </div>

                <div class="pers-row">
                    <label class="pers-label">🌟 Animación del overlay</label>
                    <div class="anim-picker">
                        ${[
                            {id:'default', label:'⬆️ Deslizar'},
                            {id:'bounce',  label:'🏀 Rebote'},
                            {id:'zoom',    label:'🔍 Zoom'},
                            {id:'spin',    label:'🌀 Giro'},
                        ].map((a, i) =>
                            `<button class="anim-opt ${i===0?'selected':''}" data-anim="${a.id}">${a.label}</button>`
                        ).join('')}
                    </div>
                </div>

                <div class="pers-row">
                    <label class="pers-label">🐾 Mascota en overlay</label>
                    <div class="capi-picker">
                        ${[
                            {id:'none',   emoji:'—',     label:'Sin mascota'},
                            {id:'cute',   emoji:'🐾',    label:'Capibara cute'},
                            {id:'party',  emoji:'🎊🐾',  label:'Capibara fiesta'},
                            {id:'royal',  emoji:'👑🐾',  label:'Capibara rey'},
                            {id:'kawaii', emoji:'🌸🐾',  label:'Capibara kawaii'},
                        ].map((c, i) =>
                            `<button class="capi-opt ${i===0?'selected':''}" data-capi="${c.id}" title="${c.label}">${c.emoji}</button>`
                        ).join('')}
                    </div>
                </div>

                <input type="hidden" class="selected-emoji" value="🎉">
                <input type="hidden" class="selected-theme" value="purple">
                <input type="hidden" class="selected-anim" value="default">
                <input type="hidden" class="selected-capi" value="none">
                
                <div class="pers-row" style="margin-top:20px; border-top:1px solid rgba(255,255,255,0.1); padding-top:20px;">
                    <label class="pers-label">👀 Vista previa en vivo</label>
                    <div class="preview-container">
                        <div id="live-preview-alert" class="preview-overlay">
                            <div class="preview-avatar-wrap">
                                <div class="preview-avatar-ring"></div>
                                <img src="${me ? me.profile_image : ''}" alt="" class="preview-avatar">
                            </div>
                            <div class="preview-content">
                                <div class="preview-title">🎂 ¡Hoy es su cumpleaños!</div>
                                <div class="preview-user">${me ? me.display_name : 'Usuario'}</div>
                                <div id="live-preview-age" class="preview-age-badge" style="display:none;">
                                    🎂 <span class="preview-age-num" id="live-preview-age-num">0</span> años
                                </div>
                                <div id="live-preview-message" class="preview-message" style="display:none;"></div>
                            </div>
                            <div class="preview-emoji" id="live-preview-emoji">🎉</div>
                            <div id="live-preview-capi" class="preview-capi" style="display:none;"></div>
                        </div>
                    </div>
                </div>
                ` : ''}
            </div>

            ${isTodayBirthday ? `
                ${obsConnected ? `
                    <button class="btn-launch-sound" id="launch-selected-sound"
                        style="background:${cooldownActive ? 'rgba(255,255,255,0.08)' : 'var(--twitch)'};
                               color:${cooldownActive ? '#666' : '#fff'};
                               border:none; padding:12px; border-radius:10px; font-weight:700;
                               cursor:${cooldownActive ? 'not-allowed' : 'pointer'}; width:100%; margin-top:4px;">
                        ${cooldownActive ? '⏳ En enfriamiento...' : '🚀 Lanzar al stream'}
                    </button>
                ` : ''}
            ` : ''}
        </div>
    `;

    const previewSelectedBtn = $('preview-selected-sound');
    const previewSelectedLabel = $('preview-selected-label');

    if (previewSelectedBtn) {
        previewSelectedBtn.onclick = () => {
            const previewSound = availableSounds.find(sound => sound.file === selectedLaunchSoundFile) || availableSounds[0];
            if (!previewSound) return;
            if (previewPlayBtn === previewSelectedBtn) { stopPreviewAudio(); return; }
            stopPreviewAudio();

            const audio = new Audio(`music/${previewSound.file}`);
            previewAudio = audio;
            previewPlayBtn = previewSelectedBtn;
            
            const icon = previewSelectedBtn.querySelector('.preview-selected-icon');
            if (icon) icon.textContent = '⏸';
            
            previewSelectedBtn.style.background = 'rgba(145,70,255,0.12)';
            previewSelectedBtn.style.boxShadow = '0 6px 20px rgba(0,0,0,0.22)';
            
            audio.play().catch(() => stopPreviewAudio());
            audio.addEventListener('ended', () => stopPreviewAudio());
        };
        if (previewSelectedLabel && selectedSoundMeta) {
            previewSelectedLabel.textContent = `Escuchar ${selectedSoundMeta.name || selectedSoundMeta.file.replace('.mp3','')}`;
        }
    }

    availableSounds.forEach(sound => {
        const isPlayed = playedSounds.includes(sound.file);
        
        const card = document.createElement('div');
        card.className = 'sound-mini-card';
        card.style.display = 'flex';
        card.style.alignItems = 'center';
        card.style.gap = '12px';
        card.style.padding = '10px 12px';
        card.style.background = 'rgba(255,255,255,0.05)';
        card.style.borderRadius = '8px';
        card.style.border = '1px solid rgba(255,255,255,0.1)';

        card.innerHTML = `
            <div style="flex:1; min-width:0;">
                <div style="font-weight:700; font-size:0.92rem;">${sound.name || sound.file.replace('.mp3','')}</div>
                <div style="font-size:0.76rem; color:var(--text-dim); margin-top:2px;">Vista previa del audio disponible</div>
            </div>
            <div style="font-size:0.78rem; font-weight:700; color:${isPlayed ? 'var(--danger)' : 'var(--success)'}; text-transform:uppercase; letter-spacing:0.08em; margin-left:auto;">
                ${isPlayed ? 'Ya lanzado hoy' : 'Disponible'}
            </div>
            <button type="button" class="sound-mini-play" title="Escuchar vista previa" ${isPlayed ? 'disabled' : ''}>▶</button>
        `;

        // Play preview button
        const playBtn = card.querySelector('.sound-mini-play');
        playBtn.addEventListener('click', () => {
            if (previewPlayBtn === playBtn) { stopPreviewAudio(); return; }
            stopPreviewAudio();

            const audio = new Audio(`music/${sound.file}`);
            previewAudio = audio;
            previewPlayBtn = playBtn;

            playBtn.textContent = '⏸';
            playBtn.style.background = 'linear-gradient(135deg, #3ddc84, #28a865)';
            playBtn.style.boxShadow = '0 2px 10px rgba(61,220,132,0.4)';
            playBtn.style.animation = 'sound-pulse 1s ease-in-out infinite';
            
            const wave = card.querySelector('.sound-mini-wave');
            if (wave) wave.classList.add('active');

            audio.play().catch(() => stopPreviewAudio());
            audio.addEventListener('ended', () => stopPreviewAudio());
        });

        // Wire char counter
        if (isPlayed) {
            playBtn.disabled = true;
        }

        list.appendChild(card);
    });

    const selectedSoundSelect = $('launch-sound-select');
    const msgInput = controlPanel.querySelector('.custom-alert-msg');
    const counterEl = controlPanel.querySelector('.msg-char-counter');
    const emojiButtons = controlPanel.querySelectorAll('.emoji-opt');
    const themeButtons = controlPanel.querySelectorAll('.theme-opt');
    const animButtons  = controlPanel.querySelectorAll('.anim-opt');
    const capiButtons  = controlPanel.querySelectorAll('.capi-opt');
    const launchBtn = $('launch-selected-sound');

    if (selectedSoundSelect) {
        selectedSoundSelect.value = selectedLaunchSoundFile;
        selectedSoundSelect.onchange = () => {
            selectedLaunchSoundFile = selectedSoundSelect.value;
            // Update preview button label immediately
            const meta = availableSounds.find(s => s.file === selectedLaunchSoundFile) || availableSounds[0];
            if (previewSelectedLabel && meta) {
                previewSelectedLabel.textContent = `Escuchar ${meta.name || meta.file.replace('.mp3','')}`;
            }
            // Also stop any playing preview so icon resets
            if (previewPlayBtn === previewSelectedBtn) stopPreviewAudio();
        };
    }

    const ageInput   = controlPanel.querySelector('.custom-alert-age');
    function updateLivePreview() {
        const pAlert = $('live-preview-alert');
        if (!pAlert) return;
        
        const emojiInput = controlPanel.querySelector('.selected-emoji');
        const themeInput = controlPanel.querySelector('.selected-theme');
        const capiInput  = controlPanel.querySelector('.selected-capi');
        
        const selEmoji = emojiInput ? emojiInput.value : '🎉';
        const selTheme = themeInput ? themeInput.value : 'purple';
        const selCapi  = capiInput  ? capiInput.value  : 'none';
        const selAge   = ageInput && ageInput.value ? parseInt(ageInput.value) : null;
        const msgVal   = msgInput ? msgInput.value.trim() : '';

        const THEMES = {
            purple:    { color: 'rgba(145,70,255,0.6)',  solid: '#9146ff', ring: 'conic-gradient(from 0deg,#9146ff,#bf94ff,#f7d046,#ff6bcb,#9146ff)' },
            pink:      { color: 'rgba(255,107,203,0.6)', solid: '#ff6bcb', ring: 'conic-gradient(from 0deg,#ff6bcb,#ffb3e6,#f7d046,#9146ff,#ff6bcb)' },
            gold:      { color: 'rgba(247,208,70,0.6)',  solid: '#f7d046', ring: 'conic-gradient(from 0deg,#f7d046,#fff4a0,#ff8a65,#f7d046,#f7d046)' },
            blue:      { color: 'rgba(79,195,247,0.6)',  solid: '#4fc3f7', ring: 'conic-gradient(from 0deg,#4fc3f7,#b3e5fc,#9146ff,#ff6bcb,#4fc3f7)' },
            green:     { color: 'rgba(61,220,132,0.6)',  solid: '#3ddc84', ring: 'conic-gradient(from 0deg,#3ddc84,#b9f5d8,#f7d046,#4fc3f7,#3ddc84)' },
            red:       { color: 'rgba(255,92,92,0.6)',   solid: '#ff5c5c', ring: 'conic-gradient(from 0deg,#ff5c5c,#ffb3b3,#f7d046,#ff6bcb,#ff5c5c)' },
            capybara:  { color: 'rgba(201,149,106,0.7)', solid: '#c9956a', ring: 'conic-gradient(from 0deg,#c9956a,#e8c9a0,#f7d046,#a0624a,#c9956a)' },
            capinight: { color: 'rgba(123,94,167,0.7)',  solid: '#7b5ea7', ring: 'conic-gradient(from 0deg,#7b5ea7,#b39ddb,#c9956a,#3d2b6b,#7b5ea7)' },
        };

        const t = THEMES[selTheme] || THEMES.purple;
        pAlert.style.setProperty('--theme-color', t.color);
        pAlert.style.setProperty('--theme-solid', t.solid);
        pAlert.style.setProperty('--theme-ring',  t.ring);

        $('live-preview-emoji').textContent = selEmoji;

        const pAge = $('live-preview-age');
        if (selAge && selAge > 0) {
            $('live-preview-age-num').textContent = selAge;
            pAge.style.display = 'inline-flex';
        } else {
            pAge.style.display = 'none';
        }

        const pMsg = $('live-preview-message');
        if (msgVal) {
            pMsg.textContent = `"${msgVal}"`;
            pMsg.style.display = 'block';
        } else {
            pMsg.style.display = 'none';
        }

        const pCapi = $('live-preview-capi');
        const CAPI_ICONS = { none:'', cute:'\ud83d\udc3e', party:'\ud83c\udf8a\ud83d\udc3e', royal:'\ud83d\udc51\ud83d\udc3e', kawaii:'\ud83c\udf38\ud83d\udc3e' };
        if (selCapi && selCapi !== 'none') {
            pCapi.textContent = CAPI_ICONS[selCapi];
            pCapi.style.display = 'block';
        } else {
            pCapi.style.display = 'none';
        }
    }

    if (ageInput) ageInput.oninput = updateLivePreview;

    if (msgInput && counterEl) {
        msgInput.oninput = () => {
            const len = msgInput.value.length;
            counterEl.textContent = `${len} / 80`;
            counterEl.style.color = len > 70 ? (len >= 80 ? 'var(--danger)' : '#f7d046') : 'var(--text-dim)';
            updateLivePreview();
        };
    }

    emojiButtons.forEach(btn => {
        btn.onclick = () => {
            emojiButtons.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            const hid = controlPanel.querySelector('.selected-emoji');
            if (hid) hid.value = btn.dataset.emoji;
            updateLivePreview();
        };
    });

    themeButtons.forEach(btn => {
        btn.onclick = () => {
            themeButtons.forEach(b => {
                b.style.border = '2px solid transparent';
                b.style.boxShadow = 'none';
            });
            btn.style.border = '3px solid #fff';
            btn.style.boxShadow = `0 0 0 2px ${btn.dataset.color}`;
            const hid = controlPanel.querySelector('.selected-theme');
            if (hid) hid.value = btn.dataset.theme;
            updateLivePreview();
        };
    });

    animButtons.forEach(btn => {
        btn.onclick = () => {
            animButtons.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            const hid = controlPanel.querySelector('.selected-anim');
            if (hid) hid.value = btn.dataset.anim;
            updateLivePreview();
        };
    });

    capiButtons.forEach(btn => {
        btn.onclick = () => {
            capiButtons.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            const hid = controlPanel.querySelector('.selected-capi');
            if (hid) hid.value = btn.dataset.capi;
            updateLivePreview();
        };
    });
    
    // Initial call
    updateLivePreview();

    if (launchBtn && isTodayBirthday && obsConnected && !cooldownActive) {
        launchBtn.onclick = async () => {
            const soundFile = selectedSoundSelect ? selectedSoundSelect.value : selectedLaunchSoundFile;
            if (!soundFile) return;

            const customMsg  = msgInput ? msgInput.value.trim() : '';
            const ageInput   = controlPanel.querySelector('.custom-alert-age');
            const fontInput  = controlPanel.querySelector('.custom-alert-font');
            const emojiInput = controlPanel.querySelector('.selected-emoji');
            const themeInput = controlPanel.querySelector('.selected-theme');
            const animInput  = controlPanel.querySelector('.selected-anim');
            const capiInput  = controlPanel.querySelector('.selected-capi');
            const selEmoji = emojiInput ? emojiInput.value : '🎉';
            const selTheme = themeInput ? themeInput.value : 'purple';
            const selAnim  = animInput  ? animInput.value  : 'default';
            const selCapi  = capiInput  ? capiInput.value  : 'none';
            const selAge   = ageInput && ageInput.value ? parseInt(ageInput.value) : null;
            const selFont  = fontInput ? fontInput.value : 'sans-serif';

            if (customMsg) {
                if (customMsg.length > 80) {
                    await customAlert('El mensaje es demasiado largo (máximo 80 caracteres).');
                    return;
                }
                if (/https?:\/\/|www\.|(?:\w+\.)+(com|net|org|me|io|tv|gl|ly|co)\b/i.test(customMsg)) {
                    await customAlert('No se permiten enlaces en el mensaje.');
                    return;
                }
                if (/[^\w\sñÑáéíóúÁÉÍÓÚüÜ!?¡¿.,()\/\-:;']/i.test(customMsg)) {
                    await customAlert('El mensaje contiene caracteres no permitidos.');
                    return;
                }
            }

            if (selAge !== null && (selAge < 1 || selAge > 120)) {
                await customAlert('La edad debe estar entre 1 y 120.');
                return;
            }

            const soundMeta = availableSounds.find(sound => sound.file === soundFile);
            const msgPreview = customMsg ? `\n\nMensaje: "${customMsg}"` : '';
            const confirmed = await customConfirm(`¿Seguro que deseas lanzar "${soundMeta?.name || soundFile}" al stream ahora? Esto no se puede deshacer y solo podrás hacerlo 1 vez hoy.${msgPreview}`);
            if (!confirmed) return;

            launchBtn.disabled = true;
            launchBtn.innerHTML = '⏳ Enviando...';
            if (msgInput) msgInput.disabled = true;
            if (ageInput) ageInput.disabled = true;

            const r = await api('POST', '/api/birthday/alert', {
                sound_file: soundFile,
                message: customMsg,
                emoji: selEmoji,
                theme: selTheme,
                anim: selAnim,
                capi: selCapi,
                age: selAge
            });

            if (r.ok) {
                selectedLaunchSoundFile = soundFile;
                const refreshedMe = await api('GET', '/api/me');
                if (refreshedMe.ok) {
                    showRegistered(refreshedMe.data);
                }

                const cooldownNote = $('global-cooldown-note');
                if (cooldownNote && r.data.overlay_clients === 0) {
                    cooldownNote.style.display = 'block';
                    cooldownNote.style.color = 'var(--danger)';
                    cooldownNote.textContent = `⚠️ Tu alerta fue enviada al servidor, pero OBS parece haberse desconectado justo ahora. Avisa a yocapi para que la repita desde su panel.`;
                }
            } else {
                launchBtn.disabled = false;
                launchBtn.innerHTML = '🚀 Lanzar al stream';
                if (msgInput) msgInput.disabled = false;
                if (ageInput) ageInput.disabled = false;
                await customAlert('Error: ' + (r.data?.error || 'Error desconocido'));
            }
        };
    }
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

    // Confirmación de registro
    const dateStr = `${day} de ${$('pick-month').options[$('pick-month').selectedIndex].text}`;
    const confirmed = await customConfirm(`¿Confirmas tu fecha de cumpleaños (${dateStr})? Después podrás lanzar cualquiera de los 3 sonidos disponibles.`);
    if (!confirmed) return;

    $('btn-register').disabled = true;
    $('btn-register').textContent = 'Guardando...';

    const r = await api('POST', '/api/birthday/register', { month, day });
    if (r.ok) {
        // Actualizar la vista de usuario
        const meRes = await api('GET', '/api/me');
        if (meRes.ok) updateUserPill(meRes.data);
        showRegistered(meRes.ok ? meRes.data : { display_name: '', birthday: { month, day }, sounds: [], obs_connected: false });
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
