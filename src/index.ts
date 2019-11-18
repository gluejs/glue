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

import {
	API,
	Glue,
	Controller,
	ICallData,
	IInitData,
	IEmbeddOptions,
	IEnableOptions,
	IPayload,
	IReadyData,
} from './glue';
import {
	getOriginFromUrl,
	queueMicroTask,
} from './utils';

/**
 * Embeds the provided url into the provided container by creating an iframe
 * which gets appended as child to the provided container.
 *
 * @param url URL of the app to be embedded with Glue.
 * @param container DOM node where the iframe element is appended as child.
 * @param options Embedded options.
 */
async function embed(url: string, container: Element, options?: IEmbeddOptions): Promise<Glue> {
	return new Promise((resolve, reject) => {
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
		const features = options ? options.features : {};
		const state: {
			api?: API<{[key: string]: (...args: unknown[]) => Promise<any>}>;  /* eslint-disable-line @typescript-eslint/no-explicit-any */
			beforeInitResolve?: (value?: unknown) => void;
			beforeInitReject?: (reason?: unknown) => void;
		} = {};

		const controller = new Controller({
			glueWindow: frame.contentWindow,
			origin,
			handler: async (message: IPayload): Promise<any> => { /* eslint-disable-line @typescript-eslint/no-explicit-any */
				switch (message.type) {
					case 'init': {
						const data = message.data as IInitData;
						const reply: IInitData = {
							features: features ? Object.keys(features) : [],
						};

						const api = {} as API<{[key: string]: (...args: unknown[]) => Promise<any>}>; /* eslint-disable-line @typescript-eslint/no-explicit-any */
						if (data.features) {
							data.features.forEach(action => {
								api[action] = (...args: unknown[]): Promise<any> => { /* eslint-disable-line @typescript-eslint/no-explicit-any */
									return controller.callAction(action, args);
								}
							});
						}
						state.api = api;

						if (options && options.onBeforeInit) {
							const p = new Promise((resolve, reject) => {
								state.beforeInitResolve = resolve;
								state.beforeInitReject = reject;
							});
							if (!state.beforeInitResolve || !state.beforeInitReject) {
								throw new Error('glue init promise error');
							}
							try {
								const action = options.onBeforeInit(api, p);
								if (action) {
									if (!data.features || !data.features.includes(action)) {
										state.beforeInitReject(new Error(`unsupported action: ${action}`));
									} else {
										reply.action = action;
									}
								}
							} catch (err) {
								reject(new Error(`onInit failed: ${err}`));
								return;
							}
						}

						return reply;
					}

					case 'ready': {
						if (!state.api) {
							throw new Error('failed to glue: no API');
						}

						const glue = controller.Glue(state.api);
						const data = message.data as IReadyData;
						if (options && options.onBeforeInit && state.beforeInitResolve && state.beforeInitReject) {
							if (data.ready) {
								await state.beforeInitResolve(data.data);
							} else {
								await state.beforeInitReject(data.data);
							}
							resolve(glue);
						} else {
							if (data.ready) {
								resolve(glue);
							} else {
								if (data.error) {
									throw new Error(`failed to glue: ${data.data}`)
								} else {
									reject(glue);
								}
							}
						}
						break;
					}

					case 'call': {
						const data = message.data as ICallData;
						const handler = features ? features[data.action] : null;
						if (!handler) {
							throw new Error(`unknown action: ${data.action}`);
						}
						const args = data.args ? data.args : [];
						return handler(...args);
					}

					default:
						console.debug(`glue (embed) unknown message type: ${message.type}`);
				}
			},
		});
	});
}

/**
 * Enables glue for the provided sourceWindow with options.
 *
 * @param sourceWindow Window element of the app which is using Glue embed.
 * @param options Enable options.
 */
async function enable(sourceWindow?: Window, options?: IEnableOptions): Promise<Glue> {
	return new Promise((resolve, reject) => {
		if (!sourceWindow) {
			sourceWindow = window.parent;
		}
		if (sourceWindow === self) {
			// Return empty Glue API if we are self, this means Glue is not active.
			resolve(new Glue({}));
			return;
		}

		const features = options ? options.features : {};
		const controller = new Controller({
			glueWindow: sourceWindow,
			origin: options ? options.origin : undefined,
			handler: async (message: IPayload): Promise<any> => { /* eslint-disable-line @typescript-eslint/no-explicit-any */
				switch (message.type) {
					case 'call': {
						const data = message.data as ICallData;
						const handler = features ? features[data.action] : null;
						if (!handler) {
							throw new Error(`unknown action: ${data.action}`);
						}
						const args = data.args ? data.args : [];
						return handler(...args);
					}

					default:
						console.debug(`glue (enable) unknown message type: ${message.type}`)
				}
			},
		})
		queueMicroTask(() => {
			const request: IInitData = {
				features: features ? Object.keys(features) : [],
			}
			controller.postMessage('init', request).then(async (initData?: IInitData): Promise<void> => {
				if (!initData || initData.error) {
					// TODO(longsleep): Initialization failed. What now?
					reject(new Error(`glue init received error: ${initData ? initData.error : 'no data'}`));
					return;
				}

				const readyData: IReadyData = {
					ready: true,
				}
				if (initData.action) {
					// Trigger action, this action is set when initializing and it
					// is triggered before the app reports ready.
					if (features && features[initData.action])  {
						const handler = features[initData.action];
						try {
							const result = await handler();
							if (result !== undefined) {
								readyData.data = result;
							}
						} catch(e) {
							readyData.ready = false;
							readyData.error = true;
							readyData.data = e;
						}
					} else {
						readyData.ready = false;
						readyData.error = true;
						readyData.data = new Error(`unknown glue action: ${initData.action}`);
					}
				}

				const api = {} as API<{[key: string]: (...args: unknown[]) => Promise<any>}>; /* eslint-disable-line @typescript-eslint/no-explicit-any */
				if (initData.features) {
					for (const action of initData.features) {
						api[action] = (...args: unknown[]): Promise<any> => { /* eslint-disable-line @typescript-eslint/no-explicit-any */
							return controller.callAction(action, args);
						}
					}
				}

				if (options && options.onBeforeReady) {
					try {
						options.onBeforeReady(api, readyData);
					} catch(e) {
						readyData.ready = false;
						readyData.error = true;
						readyData.data = e;
					}
				}

				controller.postMessage('ready', readyData).then((): void => {
					resolve(controller.Glue(api));
				});
			}).catch((reason: unknown)=> {
				throw new Error(`glue init failed: ${reason}`);
			});
		});
	});
}

export {
	Glue,
	Controller,
	embed,
	enable,
}

export default Glue;
