// Electron's Node compatibility mode is not a packaged application.
// Mark it as a development process before electron-builder reads process.argv.
process.defaultApp = true;
require('../node_modules/electron-builder/cli.js');
