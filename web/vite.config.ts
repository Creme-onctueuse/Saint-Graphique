import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Politique de sécurité du fichier autonome : tout est inline, aucun appel réseau n'est autorisé
 * (ni script, ni style, ni police, ni requête). Injectée uniquement au build : le serveur de dev
 * a besoin de charger ses modules et son client HMR.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Adresse publique du site, pour les balises de partage. Remplaçable par SG_SITE_URL au build. */
const SITE_URL = process.env['SG_SITE_URL'] ?? 'https://creme-onctueuse.github.io/Saint-Graphique/';

function siteUrl(): Plugin {
  return {
    name: 'saint-graphique:site-url',
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', SITE_URL),
  };
}

function contentSecurityPolicy(): Plugin {
  return {
    name: 'saint-graphique:csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) =>
        html.replace(
          '<!-- csp -->',
          `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
        ),
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [siteUrl(), contentSecurityPolicy(), viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
