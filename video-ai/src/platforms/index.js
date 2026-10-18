const { facebook, instagram } = require('./meta');
const linkedin = require('./linkedin');
const youtube = require('./youtube');
const tiktok = require('./tiktok');

// Reihenfolge = Anzeige-Reihenfolge in der Oberfläche
const PLATFORMS = { instagram, facebook, linkedin, youtube, tiktok };

module.exports = { PLATFORMS, PLATFORM_IDS: Object.keys(PLATFORMS) };
