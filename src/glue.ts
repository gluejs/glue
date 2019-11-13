/*!
 * Copyright 2019 Kopano and its contributors
 *
 * Use of this source code is governed by a MIT license
 * that can be found in the LICENSE.txt file.
 *
 * @author   Kopano <https://kopano.com>
 * @license  MIT
 * @preserve
 */

'use strict';

import {
	getOriginFromUrl,
} from './utils';

export interface IEmbeddOptions {
	className?: string
	attributes?: {[key: string]: any}
	origin?: string
}

export interface IEnableOptions {
	origin?: string
}

export async function embed(url: string, container: Element, options?: IEmbeddOptions): Promise<Glue> {
	const ownerDocument = container.ownerDocument !== null ? container.ownerDocument : document;

	const frame = ownerDocument.createElement('iframe');
	if (options && options.className) {
		frame.className = options.className;
	}
	if (options && options.attributes) {
		Object.entries(options.attributes).forEach(([key, value]) => {
			frame.setAttribute(key, value);
		});
	}
	frame.setAttribute('src', url);
	container.appendChild(frame);

	if (!frame.contentWindow) {
		throw new Error('new frame has no contentWindow');
	}

	const origin = options && options.origin ? options.origin : getOriginFromUrl(url);

	return new Glue(frame.contentWindow, origin);
}

export async function enable(sourceWindow?: Window, options?: IEnableOptions): Promise<Glue> {
	if (!sourceWindow) {
		sourceWindow = window.parent;
	}

	return new Glue(sourceWindow, options ? options.origin : undefined);
}

/**
 * Glue is the main Glue Javascript library entry point.
 */
export class Glue {
	public static version: string = __VERSION__;

	private window: Window;
	private origin: string;

	public constructor(window: Window, origin?: string) {
		this.window = window;
		this.origin = origin ? origin : window.origin;

		console.log('new glue', this.window, this.origin);
	}
}
