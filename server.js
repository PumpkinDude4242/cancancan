/**
 * CAN Clicker Game - Serveur Principal
 * Jeu Clicker temps réel pour la Coupe d'Afrique des Nations
 *
 * Stack: Node.js + Express + Socket.io + Twitter API v2
 * Prêt pour déploiement sur Railway
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

// ============================================================
// BOT TWITTER - Configuration
// ============================================================

let twitterClient = null;
let twitterEnabled = false;

/**
 * Initialise le client Twitter si les credentials sont présentes
 */
function initTwitterBot() {
    const {
        TWITTER_CLIENT_KEY,
        TWITTER_CLIENT_SECRET,
        TWITTER_ACCESS_TOKEN,
        TWITTER_ACCESS_SECRET,
        PUBLIC_SITE_URL
    } = process.env;

    // Vérifier que toutes les clés sont présentes
    if (!TWITTER_CLIENT_KEY || !TWITTER_CLIENT_SECRET ||
        !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) {
        console.log('🐦 Bot Twitter inactif - Variables d\'environnement manquantes');
        return;
    }

    try {
        // Import dynamique pour éviter crash si module non installé
        const { TwitterApi } = require('twitter-api-v2');

        const client = new TwitterApi({
            appKey: TWITTER_CLIENT_KEY,
            appSecret: TWITTER_CLIENT_SECRET,
            accessToken: TWITTER_ACCESS_TOKEN,
            accessSecret: TWITTER_ACCESS_SECRET,
        });

        twitterClient = client.readWrite;
        twitterEnabled = true;

        console.log('🐦 Bot Twitter actif - Tweets programmés toutes les 60 minutes');

        // Premier tweet après 5 minutes (laisser le serveur démarrer)
        setTimeout(postTwitterUpdate, 5 * 60 * 1000);

        // Ensuite toutes les 60 minutes
        setInterval(postTwitterUpdate, 60 * 60 * 1000);

    } catch (error) {
        console.log('🐦 Bot Twitter inactif - Module twitter-api-v2 non installé ou erreur:', error.message);
    }
}

/**
 * Poste un tweet avec le classement actuel
 */
async function postTwitterUpdate() {
    if (!twitterEnabled || !twitterClient || !gameData) {
        return;
    }

    try {
        const ranking = getRanking();
        const top3 = ranking.slice(0, 3);

        if (top3.length === 0) {
            console.log('🐦 Pas de données à tweeter');
            return;
        }

        // Construire le message
        const siteUrl = process.env.PUBLIC_SITE_URL || 'https://can-clicker.up.railway.app';
        let tweetText = '🔥 CLASSEMENT LIVE CAN 2025 🏆\n\n';

        top3.forEach((entry, index) => {
            const team = gameData.teams.find(t => t.id === entry.teamId);
            if (team) {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
                tweetText += `${medal} ${team.emoji} ${team.name}: ${formatNumber(entry.score)} clics\n`;
            }
        });

        tweetText += `\n👉 Aidez votre pays ici: ${siteUrl}`;
        tweetText += '\n\n#CAN2025 #AFCON2025 #Football #Afrique';

        // Envoyer le tweet
        await twitterClient.v2.tweet(tweetText);
        console.log('🐦 Tweet posté avec succès !');

    } catch (error) {
        // Ne pas crasher le serveur en cas d'erreur Twitter
        console.error('🐦 Erreur lors du tweet:', error.message);

        // Log détaillé pour debug
        if (error.data) {
            console.error('   Détails:', JSON.stringify(error.data));
        }
    }
}

/**
 * Formate un nombre avec séparateurs de milliers
 */
function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

// ============================================================
// CONFIGURATION ET INITIALISATION
// ============================================================

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // À restreindre en production si nécessaire
        methods: ["GET", "POST"]
    },
    // Optimisations pour les connexions massives
    pingTimeout: 60000,
    pingInterval: 25000
});

// Port dynamique pour Railway ou 3000 en local
const PORT = process.env.PORT || 3000;

// ============================================================
// CHARGEMENT DES DONNÉES DEPUIS JSON
// ============================================================

let gameData = null;
let scores = {}; // Stockage des scores en mémoire { teamId: score }
let connectedUsers = 0;

/**
 * Charge la configuration depuis config/tournament_data.json
 * Filtre les équipes actives et initialise les scores à 1
 */
function loadGameData() {
    try {
        const dataPath = path.join(__dirname, 'config', 'tournament_data.json');
        const rawData = fs.readFileSync(dataPath, 'utf8');
        const rawGameData = JSON.parse(rawData);

        // Filtrer uniquement les équipes actives
        const activeTeams = rawGameData.teams.filter(team => team.active === true);

        gameData = {
            teams: activeTeams,
            matches: rawGameData.matches,
            settings: rawGameData.settings
        };

        // Initialiser les scores à 1 pour chaque équipe active (barre visible dès le départ)
        gameData.teams.forEach(team => {
            scores[team.id] = 1;
        });

        const eliminatedCount = rawGameData.teams.length - activeTeams.length;
        console.log(`✅ Configuration chargée: ${activeTeams.length} équipes actives, ${eliminatedCount} éliminées, ${gameData.matches.length} matchs`);
        return true;
    } catch (error) {
        console.error('❌ Erreur lors du chargement de tournament_data.json:', error.message);
        return false;
    }
}

// ============================================================
// GESTION DES MATCHS EN DIRECT
// ============================================================

/**
 * Retourne les IDs des équipes dont le match est en cours
 * Basé sur l'heure actuelle et les horaires dans data.json
 */
function getLiveMatchTeams() {
    if (!gameData || !gameData.matches) return [];

    const now = new Date();
    const liveTeams = [];

    gameData.matches.forEach(match => {
        const startTime = new Date(match.startTime);
        const endTime = new Date(match.endTime);

        if (now >= startTime && now <= endTime) {
            liveTeams.push(match.teamA, match.teamB);
        }
    });

    return [...new Set(liveTeams)]; // Supprime les doublons
}

/**
 * Retourne les informations sur les matchs en cours
 */
function getLiveMatches() {
    if (!gameData || !gameData.matches) return [];

    const now = new Date();

    return gameData.matches.filter(match => {
        const startTime = new Date(match.startTime);
        const endTime = new Date(match.endTime);
        return now >= startTime && now <= endTime;
    });
}

// ============================================================
// STATISTIQUES ET CLASSEMENT
// ============================================================

/**
 * Retourne le classement trié par score décroissant
 */
function getRanking() {
    return Object.entries(scores)
        .map(([teamId, score]) => ({ teamId, score }))
        .sort((a, b) => b.score - a.score);
}

/**
 * Retourne le score du leader (équipe en tête)
 */
function getLeaderScore() {
    const ranking = getRanking();
    return ranking.length > 0 ? ranking[0].score : 0;
}

/**
 * Détermine le niveau de background basé sur le score du leader
 */
function getBackgroundLevel() {
    const leaderScore = getLeaderScore();
    const thresholds = gameData?.settings?.scoreThresholds || {
        stadium: 0,
        sky: 10000,
        space: 50000,
        moon: 100000
    };

    if (leaderScore >= thresholds.moon) return 'moon';
    if (leaderScore >= thresholds.space) return 'space';
    if (leaderScore >= thresholds.sky) return 'sky';
    return 'stadium';
}

// ============================================================
// LIMITATION DE DÉBIT (Rate Limiting basique)
// ============================================================

const clickTracker = new Map(); // { odeclientId: { clicks: [], lastReset: timestamp } }
const MAX_CLICKS_PER_SECOND = 20; // Maximum raisonnable pour éviter les abus

/**
 * Vérifie si un client peut cliquer (anti-spam serveur)
 */
function canClick(clientId) {
    const now = Date.now();
    const tracker = clickTracker.get(clientId) || { clicks: [], lastReset: now };

    // Réinitialiser si plus d'une seconde s'est écoulée
    if (now - tracker.lastReset > 1000) {
        tracker.clicks = [];
        tracker.lastReset = now;
    }

    // Vérifier la limite
    if (tracker.clicks.length >= MAX_CLICKS_PER_SECOND) {
        return false;
    }

    tracker.clicks.push(now);
    clickTracker.set(clientId, tracker);
    return true;
}

/**
 * Nettoie les trackers inactifs (appelé périodiquement)
 */
function cleanupTrackers() {
    const now = Date.now();
    for (const [clientId, tracker] of clickTracker) {
        if (now - tracker.lastReset > 10000) {
            clickTracker.delete(clientId);
        }
    }
}

// Nettoyage périodique toutes les 30 secondes
setInterval(cleanupTrackers, 30000);

// ============================================================
// ROUTES EXPRESS
// ============================================================

// Servir les fichiers statiques depuis /public
app.use(express.static(path.join(__dirname, 'public')));

// API: Récupérer les données initiales (équipes, matchs, paramètres)
app.get('/api/data', (req, res) => {
    if (!gameData) {
        return res.status(500).json({ error: 'Données non chargées' });
    }

    res.json({
        teams: gameData.teams,
        matches: gameData.matches,
        settings: gameData.settings,
        scores: scores,
        liveTeams: getLiveMatchTeams(),
        backgroundLevel: getBackgroundLevel(),
        connectedUsers: connectedUsers
    });
});

// API: Récupérer les scores actuels
app.get('/api/scores', (req, res) => {
    res.json({
        scores: scores,
        ranking: getRanking(),
        backgroundLevel: getBackgroundLevel()
    });
});

// API: Récupérer les matchs en direct
app.get('/api/live', (req, res) => {
    res.json({
        liveTeams: getLiveMatchTeams(),
        liveMatches: getLiveMatches()
    });
});

// API: Tester le bot Twitter (protégé par clé secrète)
app.get('/api/twitter/test', async (req, res) => {
    const secretKey = req.query.key;
    const expectedKey = process.env.TWITTER_TEST_KEY || 'test123';

    // Protection basique pour éviter les abus
    if (secretKey !== expectedKey) {
        return res.status(403).json({ error: 'Clé invalide' });
    }

    if (!twitterEnabled) {
        return res.json({
            success: false,
            message: 'Bot Twitter inactif - Variables d\'environnement manquantes',
            config: {
                TWITTER_CLIENT_KEY: !!process.env.TWITTER_CLIENT_KEY,
                TWITTER_CLIENT_SECRET: !!process.env.TWITTER_CLIENT_SECRET,
                TWITTER_ACCESS_TOKEN: !!process.env.TWITTER_ACCESS_TOKEN,
                TWITTER_ACCESS_SECRET: !!process.env.TWITTER_ACCESS_SECRET,
                PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL || '(non défini)'
            }
        });
    }

    try {
        await postTwitterUpdate();
        res.json({
            success: true,
            message: 'Tweet envoyé avec succès !'
        });
    } catch (error) {
        res.json({
            success: false,
            message: 'Erreur lors de l\'envoi',
            error: error.message
        });
    }
});

// ============================================================
// LOGIQUE SOCKET.IO - TEMPS RÉEL
// ============================================================

io.on('connection', (socket) => {
    connectedUsers++;
    console.log(`🔌 Nouvelle connexion: ${socket.id} (${connectedUsers} utilisateurs)`);

    // Envoyer l'état initial au nouveau client
    socket.emit('init', {
        scores: scores,
        liveTeams: getLiveMatchTeams(),
        backgroundLevel: getBackgroundLevel(),
        connectedUsers: connectedUsers
    });

    // Informer tout le monde du nouveau nombre d'utilisateurs
    io.emit('users-update', { count: connectedUsers });

    // --------------------------------------------------------
    // GESTION DES CLICS
    // --------------------------------------------------------
    socket.on('click', (data) => {
        const { teamId } = data;

        // Validation: l'équipe existe-t-elle ?
        if (!teamId || scores[teamId] === undefined) {
            socket.emit('error', { message: 'Équipe invalide' });
            return;
        }

        // Rate limiting côté serveur
        if (!canClick(socket.id)) {
            socket.emit('rate-limited', { message: 'Trop de clics, ralentis !' });
            return;
        }

        // Incrémenter le score
        scores[teamId]++;

        // Envoyer la mise à jour à TOUS les clients
        io.emit('score-update', {
            teamId: teamId,
            score: scores[teamId],
            backgroundLevel: getBackgroundLevel()
        });

        // Log périodique des scores (tous les 100 clics)
        if (scores[teamId] % 100 === 0) {
            console.log(`📊 ${teamId.toUpperCase()}: ${scores[teamId]} clics`);
        }
    });

    // --------------------------------------------------------
    // DEMANDE DE SYNCHRONISATION
    // --------------------------------------------------------
    socket.on('sync-request', () => {
        socket.emit('sync-response', {
            scores: scores,
            liveTeams: getLiveMatchTeams(),
            backgroundLevel: getBackgroundLevel(),
            connectedUsers: connectedUsers,
            serverTime: Date.now()
        });
    });

    // --------------------------------------------------------
    // DÉCONNEXION
    // --------------------------------------------------------
    socket.on('disconnect', () => {
        connectedUsers = Math.max(0, connectedUsers - 1);
        clickTracker.delete(socket.id);
        console.log(`❌ Déconnexion: ${socket.id} (${connectedUsers} utilisateurs)`);

        // Informer les autres du départ
        io.emit('users-update', { count: connectedUsers });
    });
});

// ============================================================
// BROADCASTS PÉRIODIQUES
// ============================================================

// Diffuser les matchs en direct toutes les 30 secondes
setInterval(() => {
    io.emit('live-update', {
        liveTeams: getLiveMatchTeams(),
        liveMatches: getLiveMatches()
    });
}, 30000);

// Diffuser le classement complet toutes les 5 secondes
setInterval(() => {
    io.emit('ranking-update', {
        ranking: getRanking(),
        backgroundLevel: getBackgroundLevel()
    });
}, 5000);

// ============================================================
// DÉMARRAGE DU SERVEUR
// ============================================================

// Charger les données avant de démarrer
if (!loadGameData()) {
    console.error('⛔ Impossible de démarrer sans données valides');
    process.exit(1);
}

// Initialiser le bot Twitter (si configuré)
initTwitterBot();

server.listen(PORT, () => {
    console.log('═══════════════════════════════════════════════════');
    console.log('🏆 CAN CLICKER GAME - Serveur démarré');
    console.log(`🌍 URL: http://localhost:${PORT}`);
    console.log(`📊 ${gameData.teams.length} équipes chargées`);
    console.log(`⚽ ${gameData.matches.length} matchs programmés`);
    console.log(`🐦 Twitter: ${twitterEnabled ? 'Actif' : 'Inactif'}`);
    console.log('═══════════════════════════════════════════════════');
});

// ============================================================
// GESTION GRACIEUSE DE L'ARRÊT
// ============================================================

process.on('SIGTERM', () => {
    console.log('🛑 Signal SIGTERM reçu, fermeture gracieuse...');

    // Informer les clients de la fermeture
    io.emit('server-shutdown', { message: 'Le serveur redémarre...' });

    server.close(() => {
        console.log('✅ Serveur fermé proprement');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('\n🛑 Interruption détectée (Ctrl+C)');

    // Afficher les scores finaux
    console.log('\n📊 Scores finaux:');
    getRanking().slice(0, 5).forEach((entry, index) => {
        const team = gameData.teams.find(t => t.id === entry.teamId);
        console.log(`   ${index + 1}. ${team?.emoji || ''} ${team?.name || entry.teamId}: ${entry.score}`);
    });

    process.exit(0);
});
