/**
 * Where the tactics trainer's notes live, said once. Pure.
 */

import { config } from '../config';

export const TACTICS_FOLDER = config.tacticsFolder;
export const SCENARIOS = `${TACTICS_FOLDER}/Scenarios`;
export const ATTEMPTS = `${TACTICS_FOLDER}/Attempts`;
export const AARS = `${TACTICS_FOLDER}/AAR`;
export const AAR_TEMPLATE = `${TACTICS_FOLDER}/AAR Template.md`;

/** True for a markdown note anywhere under `Tactics/Scenarios/`. Pure. */
export function isScenarioPath(path: string): boolean {
	return path.startsWith(`${SCENARIOS}/`) && path.endsWith('.md') && !path.split('/').some((part) => part === '..' || part.startsWith('.'));
}
