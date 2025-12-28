/**
 * CAN Clicker Game - Client v3
 * Design "Flag-Trail" : Drapeau en haut, trainee coloree extraite via Canvas
 *
 * Vanilla JS optimise pour performance
 */

// ============================================================
// ETAT GLOBAL DU JEU
// ============================================================

const Game = {
    // Donnees serveur
    teams: [],
    matches: [],
    settings: {},
    scores: {},
    liveTeams: [],

    // Couleurs extraites des drapeaux (teamId -> hex color)
    trailColors: {},

    // Etat UI
    connectedUsers: 0,
    backgroundLevel: 'stadium',

    // Configuration visuelle
    clickMultiplier: 10,

    // Systeme de camera
    camera: {
        offsetY: 0,
        targetOffsetY: 0,
        viewportHeight: 0,
        groundY: 0
    },

    // Systeme de combo
    clickHistory: [],
    comboActive: false,
    comboThreshold: 5,

    // Cache des images de drapeaux
    flagImageCache: {},

    // References DOM (cache)
    dom: {}
};

// Socket.io
let socket = null;

// ============================================================
// INITIALISATION
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('🏆 CAN Clicker v3 - Flag-Trail Design - Initialisation...');

    // Cache des elements DOM
    cacheDOM();

    // Dimensions initiales
    updateViewportDimensions();

    // Socket.io
    initSocket();

    // Charger les donnees
    loadGameData();

    // Event listeners
    setupEvents();

    // Boucle de rendu
    requestAnimationFrame(gameLoop);
});

/**
 * Cache les references DOM pour eviter les queries repetees
 */
function cacheDOM() {
    Game.dom = {
        loadingScreen: document.getElementById('loading-screen'),
        worldViewport: document.getElementById('world-viewport'),
        worldContainer: document.getElementById('world-container'),
        ground: document.getElementById('ground'),
        dropsContainer: document.getElementById('drops-container'),
        clickEffects: document.getElementById('click-effects'),
        toastContainer: document.getElementById('toast-container'),
        comboOverlay: document.getElementById('combo-overlay'),
        liveIndicator: document.getElementById('live-indicator'),
        liveMatchText: document.getElementById('live-match-text'),
        usersCount: document.getElementById('users-count'),
        leaderName: document.getElementById('leader-name'),
        leaderScore: document.getElementById('leader-score')
    };
}

/**
 * Met a jour les dimensions du viewport
 */
function updateViewportDimensions() {
    Game.camera.viewportHeight = window.innerHeight - 50;
    Game.camera.groundY = Game.camera.viewportHeight - 20;
}

// ============================================================
// SOCKET.IO - TEMPS REEL
// ============================================================

function initSocket() {
    socket = io({
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000
    });

    socket.on('connect', () => {
        console.log('🔌 Connecte au serveur');
        showToast('Connecte !', 'success');
    });

    socket.on('init', (data) => {
        console.log('📦 Etat initial recu');
        Game.scores = data.scores;
        Game.liveTeams = data.liveTeams || [];
        Game.backgroundLevel = data.backgroundLevel;
        Game.connectedUsers = data.connectedUsers;

        updateUI();
        renderAllBars();
    });

    socket.on('score-update', (data) => {
        Game.scores[data.teamId] = data.score;

        if (data.backgroundLevel !== Game.backgroundLevel) {
            Game.backgroundLevel = data.backgroundLevel;
            updateBackground();
        }

        updateBarHeight(data.teamId);
        updateBarScore(data.teamId);
        updateLeaderDisplay();
    });

    socket.on('ranking-update', (data) => {
        if (data.backgroundLevel !== Game.backgroundLevel) {
            Game.backgroundLevel = data.backgroundLevel;
            updateBackground();
        }
        updateLeaderDisplay();
    });

    socket.on('live-update', (data) => {
        Game.liveTeams = data.liveTeams || [];
        updateLiveIndicator();
        updateLiveHighlights();
    });

    socket.on('users-update', (data) => {
        Game.connectedUsers = data.count;
        Game.dom.usersCount.textContent = data.count;
    });

    socket.on('rate-limited', () => {
        showToast('Trop rapide !', 'error');
    });

    socket.on('sync-response', (data) => {
        Game.scores = data.scores;
        Game.liveTeams = data.liveTeams || [];
        Game.backgroundLevel = data.backgroundLevel;
        Game.connectedUsers = data.connectedUsers;
        updateUI();
        renderAllBars();
    });

    socket.on('disconnect', () => {
        console.log('❌ Deconnecte');
        showToast('Connexion perdue...', 'error');
    });

    socket.on('reconnect', () => {
        showToast('Reconnecte !', 'success');
        socket.emit('sync-request');
    });
}

// ============================================================
// CHARGEMENT DES DONNEES
// ============================================================

async function loadGameData() {
    try {
        const response = await fetch('/api/data');
        const data = await response.json();

        Game.teams = data.teams;
        Game.matches = data.matches;
        Game.settings = data.settings || {};
        Game.scores = data.scores;
        Game.liveTeams = data.liveTeams || [];
        Game.backgroundLevel = data.backgroundLevel;
        Game.connectedUsers = data.connectedUsers;
        Game.comboThreshold = data.settings?.comboThreshold || 5;
        Game.clickMultiplier = data.settings?.click_multiplier || 10;

        console.log(`✅ ${Game.teams.length} equipes actives chargees (multiplier: ${Game.clickMultiplier})`);

        // Precharger les images de drapeaux
        preloadFlagImages();

        // Extraire les couleurs des drapeaux via Canvas
        await extractAllFlagColors();

        // Generer les barres et gouttes
        createBars();
        createDrops();

        // UI initiale
        updateUI();

        // Cacher l'ecran de chargement
        hideLoadingScreen();

    } catch (error) {
        console.error('❌ Erreur chargement:', error);
        showToast('Erreur de connexion', 'error');
    }
}

/**
 * Precharge les images de drapeaux et met en cache leur disponibilite
 */
function preloadFlagImages() {
    Game.teams.forEach(team => {
        const img = new Image();
        img.onload = () => {
            Game.flagImageCache[team.id] = true;
            updateFlagDisplay(team.id);
        };
        img.onerror = () => {
            Game.flagImageCache[team.id] = false;
        };
        img.src = `/assets/flags/${team.id}.png`;
    });
}

/**
 * Met a jour l'affichage du drapeau pour une equipe
 */
function updateFlagDisplay(teamId) {
    const team = Game.teams.find(t => t.id === teamId);
    if (!team) return;

    const bar = document.getElementById(`bar-${teamId}`);
    const drop = document.getElementById(`drop-${teamId}`);

    if (Game.flagImageCache[teamId]) {
        const imgHtml = `<img src="/assets/flags/${teamId}.png" alt="${team.shortName}" class="flag-img">`;
        if (bar) {
            const flagEl = bar.querySelector('.bar-flag');
            if (flagEl) flagEl.innerHTML = imgHtml;
        }
        if (drop) {
            const flagEl = drop.querySelector('.drop-flag');
            if (flagEl) flagEl.innerHTML = imgHtml;
        }
    }
}

// ============================================================
// EXTRACTION DES COULEURS VIA CANVAS
// ============================================================

/**
 * Extrait le gradient du bas de chaque drapeau (ligne entiere de pixels)
 */
async function extractAllFlagColors() {
    console.log('🎨 Extraction des gradients des drapeaux...');

    const promises = Game.teams.map(team => extractFlagBottomGradient(team));
    await Promise.all(promises);

    console.log('✅ Gradients extraits:', Object.keys(Game.trailColors).length, 'equipes');
}

/**
 * Charge une image de drapeau et extrait la derniere ligne complete comme gradient
 */
function extractFlagBottomGradient(team) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                canvas.width = img.width;
                canvas.height = img.height;

                ctx.drawImage(img, 0, 0);

                // Lire la derniere ligne de pixels
                const bottomY = img.height - 1;
                const imageData = ctx.getImageData(0, bottomY, img.width, 1);
                const pixels = imageData.data;

                // Generer un gradient CSS horizontal base sur la ligne entiere
                const gradient = generateGradientFromPixels(pixels, img.width);
                Game.trailColors[team.id] = gradient;

                console.log(`  🏳️ ${team.shortName}: gradient genere`);
            } catch (e) {
                console.warn(`⚠️ Impossible d'analyser ${team.id}, utilisation couleur fallback`);
                // Fallback: utiliser les couleurs du JSON comme gradient
                const colors = team.colors || ['#333333'];
                Game.trailColors[team.id] = createFallbackGradient(colors);
            }
            resolve();
        };

        img.onerror = () => {
            console.warn(`⚠️ Image non trouvee pour ${team.id}`);
            const colors = team.colors || ['#333333'];
            Game.trailColors[team.id] = createFallbackGradient(colors);
            resolve();
        };

        img.src = team.flagUrl || `/assets/flags/${team.id}.png`;
    });
}

/**
 * Genere un gradient CSS horizontal a partir d'une ligne de pixels
 * Echantillonne la ligne pour creer des color-stops
 */
function generateGradientFromPixels(pixels, width) {
    // Nombre de points d'echantillonnage (plus = plus precis mais plus lourd)
    const samples = Math.min(width, 20);
    const colorStops = [];

    for (let i = 0; i < samples; i++) {
        // Position dans la ligne (0 a width-1)
        const pixelIndex = Math.floor((i / (samples - 1)) * (width - 1));
        const dataIndex = pixelIndex * 4;

        const r = pixels[dataIndex];
        const g = pixels[dataIndex + 1];
        const b = pixels[dataIndex + 2];
        const a = pixels[dataIndex + 3];

        // Si pixel transparent, utiliser noir
        const color = a >= 128 ? rgbToHex(r, g, b) : '#1a1a2e';

        // Position en pourcentage
        const position = Math.round((i / (samples - 1)) * 100);

        colorStops.push(`${color} ${position}%`);
    }

    // Optimiser: fusionner les color-stops consecutifs de meme couleur
    const optimizedStops = optimizeColorStops(colorStops);

    return `linear-gradient(to right, ${optimizedStops.join(', ')})`;
}

/**
 * Optimise les color-stops en fusionnant les couleurs consecutives identiques
 */
function optimizeColorStops(stops) {
    if (stops.length <= 2) return stops;

    const result = [];
    let currentColor = null;
    let startPos = null;

    stops.forEach((stop, index) => {
        const [color, pos] = stop.split(' ');

        if (color !== currentColor) {
            // Nouvelle couleur - ajouter la fin de la precedente et le debut de la nouvelle
            if (currentColor !== null && startPos !== pos) {
                result.push(`${currentColor} ${pos}`);
            }
            result.push(stop);
            currentColor = color;
            startPos = pos;
        } else if (index === stops.length - 1) {
            // Derniere couleur - ajouter la position finale
            result.push(stop);
        }
    });

    return result;
}

/**
 * Cree un gradient fallback a partir des couleurs du JSON
 */
function createFallbackGradient(colors) {
    if (colors.length === 1) {
        return colors[0];
    }
    if (colors.length === 2) {
        return `linear-gradient(to right, ${colors[0]} 0%, ${colors[0]} 50%, ${colors[1]} 50%, ${colors[1]} 100%)`;
    }
    // 3 couleurs = bandes verticales egales
    return `linear-gradient(to right, ${colors[0]} 0%, ${colors[0]} 33%, ${colors[1]} 33%, ${colors[1]} 67%, ${colors[2]} 67%, ${colors[2]} 100%)`;
}

/**
 * Convertit RGB en hexadecimal
 */
function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }).join('');
}

// ============================================================
// CREATION DES ELEMENTS
// ============================================================

/**
 * Cree toutes les barres des equipes avec le design Flag-Trail
 */
function createBars() {
    const ground = Game.dom.ground;
    ground.innerHTML = '';

    const sortedTeams = [...Game.teams].sort((a, b) =>
        a.name.localeCompare(b.name, 'fr')
    );

    sortedTeams.forEach((team, index) => {
        const bar = document.createElement('div');
        bar.className = 'team-bar';
        bar.id = `bar-${team.id}`;
        bar.dataset.teamId = team.id;
        bar.dataset.index = index;

        const trailColor = Game.trailColors[team.id] || team.colors[2] || '#333333';
        bar.style.setProperty('--trail-color', trailColor);

        const height = calculateBarHeight(Game.scores[team.id] || 0);
        bar.style.height = `${height}px`;

        if (Game.liveTeams.includes(team.id)) {
            bar.classList.add('live-match');
        }

        const flagSrc = team.flagUrl || `/assets/flags/${team.id}.png`;

        bar.innerHTML = `
            <div class="bar-label">
                <span class="bar-score">${formatScore(Game.scores[team.id] || 0)}</span>
                <span class="bar-name">${team.shortName}</span>
            </div>
            <div class="bar-container">
                <div class="bar-flag-section">
                    <img class="bar-flag-img" src="${flagSrc}" alt="${team.name}" draggable="false" onerror="this.style.display='none'">
                </div>
                <div class="bar-trail-section"></div>
            </div>
        `;

        bar.addEventListener('click', (e) => handleBarClick(team.id, e));
        bar.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handleBarClick(team.id, e);
        }, { passive: false });

        ground.appendChild(bar);
    });
}

/**
 * Cree les gouttes
 */
function createDrops() {
    const container = Game.dom.dropsContainer;
    container.innerHTML = '';

    const sortedTeams = [...Game.teams].sort((a, b) =>
        a.name.localeCompare(b.name, 'fr')
    );

    sortedTeams.forEach((team, index) => {
        const drop = document.createElement('div');
        drop.className = 'team-drop';
        drop.id = `drop-${team.id}`;
        drop.dataset.teamId = team.id;
        drop.dataset.index = index;

        if (Game.liveTeams.includes(team.id)) {
            drop.classList.add('live-match');
        }

        drop.innerHTML = `
            <span class="drop-flag">${team.emoji}</span>
            <span class="drop-score">${formatScore(Game.scores[team.id] || 0)}</span>
        `;

        drop.addEventListener('click', (e) => handleBarClick(team.id, e));
        drop.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handleBarClick(team.id, e);
        }, { passive: false });

        container.appendChild(drop);
    });
}

// ============================================================
// GESTION DES CLICS
// ============================================================

function handleBarClick(teamId, event) {
    const now = Date.now();
    Game.clickHistory.push(now);
    Game.clickHistory = Game.clickHistory.filter(t => now - t < 1000);

    const clicksPerSec = Game.clickHistory.length;
    const isCombo = clicksPerSec >= Game.comboThreshold;

    if (isCombo && !Game.comboActive) {
        activateCombo();
    }

    socket.emit('click', { teamId });

    const bar = document.getElementById(`bar-${teamId}`);
    if (bar) {
        bar.classList.add('clicking');
        setTimeout(() => bar.classList.remove('clicking'), 150);
    }

    createClickEffect(event, isCombo);

    if (navigator.vibrate) {
        navigator.vibrate(isCombo ? [15, 5, 15] : 10);
    }
}

function createClickEffect(event, isCombo) {
    const effect = document.createElement('div');
    effect.className = 'click-effect' + (isCombo ? ' combo' : '');
    effect.textContent = isCombo ? '+1 🔥' : '+1';

    let x, y;
    if (event.touches && event.touches.length > 0) {
        x = event.touches[0].clientX;
        y = event.touches[0].clientY;
    } else {
        x = event.clientX;
        y = event.clientY;
    }

    x += (Math.random() - 0.5) * 40;

    effect.style.left = `${x}px`;
    effect.style.top = `${y - 10}px`;

    Game.dom.clickEffects.appendChild(effect);

    setTimeout(() => effect.remove(), 700);
}

// ============================================================
// SYSTEME DE COMBO
// ============================================================

function activateCombo() {
    Game.comboActive = true;
    Game.dom.comboOverlay.classList.remove('hidden');

    setTimeout(() => {
        Game.dom.comboOverlay.classList.add('hidden');
    }, 800);

    setTimeout(() => {
        if (Game.clickHistory.length < Game.comboThreshold) {
            Game.comboActive = false;
        }
    }, 1200);
}

// ============================================================
// CALCULS ET RENDU
// ============================================================

/**
 * Calcule la hauteur d'une barre selon le score
 * Utilise le click_multiplier pour un scaling visuel important
 */
function calculateBarHeight(score) {
    const minHeight = 80; // Pour accommoder le drapeau Flag-Trail
    const scaleFactor = Game.clickMultiplier || 10;
    const maxHeight = Game.camera.viewportHeight * 3;

    return Math.min(maxHeight, minHeight + score * scaleFactor);
}

function formatScore(score) {
    if (score >= 1000000) return (score / 1000000).toFixed(1) + 'M';
    if (score >= 1000) return (score / 1000).toFixed(1) + 'k';
    return score.toString();
}

function updateBarHeight(teamId) {
    const bar = document.getElementById(`bar-${teamId}`);
    if (!bar) return;

    const score = Game.scores[teamId] || 0;
    const height = calculateBarHeight(score);
    bar.style.height = `${height}px`;
}

function updateBarScore(teamId) {
    const bar = document.getElementById(`bar-${teamId}`);
    if (!bar) return;

    const scoreEl = bar.querySelector('.bar-score');
    if (scoreEl) {
        scoreEl.textContent = formatScore(Game.scores[teamId] || 0);
    }

    const drop = document.getElementById(`drop-${teamId}`);
    if (drop) {
        const dropScore = drop.querySelector('.drop-score');
        if (dropScore) {
            dropScore.textContent = formatScore(Game.scores[teamId] || 0);
        }
    }
}

function renderAllBars() {
    Game.teams.forEach(team => {
        updateBarHeight(team.id);
        updateBarScore(team.id);
    });
}

// ============================================================
// LOGIQUE DE CAMERA
// ============================================================

function updateCamera() {
    const ranking = getRanking();
    if (ranking.length === 0) return;

    const leader = ranking[0];
    const leaderHeight = calculateBarHeight(leader.score);

    const margin = 150;
    const groundLevel = Game.camera.viewportHeight - 20;

    const leaderTop = groundLevel - leaderHeight;
    const targetOffset = Math.max(0, margin - leaderTop);

    Game.camera.targetOffsetY = targetOffset;
    Game.camera.offsetY += (Game.camera.targetOffsetY - Game.camera.offsetY) * 0.1;

    Game.dom.worldContainer.style.transform = `translateY(${Game.camera.offsetY}px)`;

    updateDropsVisibility();
}

function updateDropsVisibility() {
    const viewportBottom = Game.camera.viewportHeight;
    const cameraOffset = Game.camera.offsetY;

    Game.teams.forEach(team => {
        const bar = document.getElementById(`bar-${team.id}`);
        const drop = document.getElementById(`drop-${team.id}`);
        if (!bar || !drop) return;

        const score = Game.scores[team.id] || 0;
        const barHeight = calculateBarHeight(score);

        const groundY = viewportBottom - 20;
        const barTopY = groundY - barHeight + cameraOffset;

        const isVisible = barTopY < viewportBottom - 60;

        if (isVisible) {
            drop.classList.remove('visible');
        } else {
            drop.classList.add('visible');
        }
    });
}

function getRanking() {
    return Object.entries(Game.scores)
        .map(([teamId, score]) => ({ teamId, score }))
        .sort((a, b) => b.score - a.score);
}

// ============================================================
// MISE A JOUR DE L'UI
// ============================================================

function updateUI() {
    updateBackground();
    updateLiveIndicator();
    updateLeaderDisplay();
    Game.dom.usersCount.textContent = Game.connectedUsers;
}

function updateBackground() {
    document.body.dataset.background = Game.backgroundLevel;
}

function updateLiveIndicator() {
    const indicator = Game.dom.liveIndicator;
    const text = Game.dom.liveMatchText;

    if (Game.liveTeams.length > 0) {
        indicator.classList.add('active');
        const emojis = Game.liveTeams
            .map(id => Game.teams.find(t => t.id === id)?.emoji)
            .filter(Boolean)
            .join(' vs ');
        text.textContent = `LIVE: ${emojis}`;
    } else {
        indicator.classList.remove('active');
        text.textContent = 'Aucun match en direct';
    }
}

function updateLiveHighlights() {
    document.querySelectorAll('.team-bar').forEach(bar => {
        const teamId = bar.dataset.teamId;
        bar.classList.toggle('live-match', Game.liveTeams.includes(teamId));
    });

    document.querySelectorAll('.team-drop').forEach(drop => {
        const teamId = drop.dataset.teamId;
        drop.classList.toggle('live-match', Game.liveTeams.includes(teamId));
    });
}

function updateLeaderDisplay() {
    const ranking = getRanking();
    if (ranking.length === 0) return;

    const leader = ranking[0];
    const team = Game.teams.find(t => t.id === leader.teamId);

    if (team) {
        Game.dom.leaderName.textContent = `${team.emoji} ${team.shortName}`;
        Game.dom.leaderScore.textContent = formatScore(leader.score);
    }
}

// ============================================================
// ECRAN DE CHARGEMENT
// ============================================================

function hideLoadingScreen() {
    Game.dom.loadingScreen.classList.add('fade-out');
    setTimeout(() => {
        Game.dom.loadingScreen.classList.add('hidden');
    }, 500);
}

// ============================================================
// NOTIFICATIONS
// ============================================================

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    Game.dom.toastContainer.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
}

// ============================================================
// EVENEMENTS
// ============================================================

function setupEvents() {
    window.addEventListener('resize', () => {
        updateViewportDimensions();
    });

    Game.dom.worldViewport.addEventListener('scroll', () => {
        const scrollX = Game.dom.worldViewport.scrollLeft;
        Game.dom.dropsContainer.style.transform = `translateX(-${scrollX}px)`;
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            socket.emit('sync-request');
        }
    });

    document.addEventListener('touchend', (e) => {
        if (e.target.closest('.team-bar') || e.target.closest('.team-drop')) {
            e.preventDefault();
        }
    }, { passive: false });
}

// ============================================================
// BOUCLE DE JEU
// ============================================================

let lastFrame = 0;

function gameLoop(timestamp) {
    const delta = timestamp - lastFrame;
    lastFrame = timestamp;

    updateCamera();

    if (Game.comboActive && Game.clickHistory.length < Game.comboThreshold) {
        Game.comboActive = false;
    }

    requestAnimationFrame(gameLoop);
}

// ============================================================
// DEBUG
// ============================================================

window.CANClicker = {
    game: Game,
    getRanking,
    socket: () => socket,
    trailColors: () => Game.trailColors
};

console.log('🎮 CAN Clicker v3 charge - window.CANClicker disponible');
