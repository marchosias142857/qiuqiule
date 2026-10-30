import {copyFile,mkdir} from 'node:fs/promises';
await mkdir(new URL('../dist/vendor/',import.meta.url),{recursive:true});
await copyFile(new URL('../node_modules/phaser/dist/phaser.min.js',import.meta.url),new URL('../dist/vendor/phaser.min.js',import.meta.url));
await copyFile(new URL('../node_modules/phaser/LICENSE.md',import.meta.url),new URL('../dist/vendor/PHASER-LICENSE.md',import.meta.url));
console.log('Phaser 3.90.0 copied into offline assets.');
