/*
 * Copyright 2019 Kopano and its contributors
 *
 * Use of this source code is governed by a MIT license
 * that can be found in the LICENSE.txt file.
 *
 */

export function getOriginFromUrl(url: string): string {
	const a = document.createElement('a');
	a.href = url;
	return a.origin;
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
