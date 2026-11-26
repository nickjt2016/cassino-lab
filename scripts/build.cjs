// Generate the self-contained Pages release from the editable sources.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const header = "<!DOCTYPE html>\n<html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n<meta name=\"theme-color\" content=\"#143c33\"><meta name=\"description\" content=\"Play Cassino and customizable variants against a computer opponent.\">\n<title>Fishing Lab — Fishing Card Games</title><link rel=\"manifest\" href=\"./manifest.webmanifest\"><link rel=\"icon\" href=\"./icon.svg\" type=\"image/svg+xml\">\n";
const html = header + '<style>' + read('src/styles.css') + '\n' +
  read('src/compact.css') + '\n</style></head><body><div id="app"></div>\n<script>' +
  read('src/engine.js') + '\n</script>\n<script>' + read('src/app.js') +
  '\n</script>\n</body></html>\n';
fs.writeFileSync(path.join(root, 'index.html'), html);
