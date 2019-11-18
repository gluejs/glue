/*
 * Copyright 2019 Kopano and its contributors
 *
 * Use of this source code is governed by a MIT license
 * that can be found in the LICENSE.txt file.
 *
 */

export function getGlueParameter(name: string): string | null {
	const hashParams = new URLSearchParams(window.location.hash.substr(1));
	return hashParams.get(`glue-${name}`);
}

export function setGlueParameter(url: URL, name: string, value: string): void {
	const hashParams = new URLSearchParams(url.hash.substr(1));
	hashParams.set(`glue-${name}`, value);
	url.hash = hashParams.toString();
}

export const queueMicroTask = ((): Function => {
	if (typeof window.queueMicrotask !== 'function') {
		return function(callback: () => void): void {
			Promise.resolve().then(callback).catch(e => setTimeout(() => {
				throw e;
			}));
		};
	} else {
		return window.queueMicrotask.bind(window);
	}
})();
