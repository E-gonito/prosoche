import { defineConfig } from '@playwright/test';

const VAULT = '/tmp/prosoche-e2e/vault';
const PORT = 4173;

/**
 * The suite drives the real built server against a disposable vault, because
 * the whole point is to prove the app writes markdown correctly. Tests share
 * that vault, so they run one at a time in a fixed order rather than in
 * parallel.
 */
export default defineConfig({
	testDir: 'e2e',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 30_000,
	reporter: [['list']],
	/*
	 * A desktop viewport, because this is a desktop-first app and the timeline
	 * is two pixels a minute: at the default 720px high, an afternoon block is
	 * below the fold and a pointer drag cannot reach it. The phone layout has
	 * its own spec, which sets its own size.
	 */
	use: {
		baseURL: `http://127.0.0.1:${PORT}`,
		viewport: { width: 1400, height: 1600 },
		actionTimeout: 10_000
	},
	webServer: {
		command: `node e2e/make-vault.mjs && HUB_VAULT=${VAULT} HUB_DB=/tmp/prosoche-e2e/index.db HUB_UNDO=/tmp/prosoche-e2e/undo PORT=${PORT} HOST=127.0.0.1 node build/index.js`,
		port: PORT,
		reuseExistingServer: false,
		timeout: 60_000
	}
});
