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
	getGlueParameter,
	queueMicroTask,
	setGlueParameter,
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
	const state: {
		glue?: Glue;
		beforeInitResolve?: (value?: unknown) => void;
		beforeInitReject?: (reason?: unknown) => void;

		retryTimer?: ReturnType<typeof setTimeout>;
	} = {};

	return new Promise((resolve, reject) => {
		// Add default option values and ensure options.
		options = {
			timeout: 5000,
			sandboxRestrictions: 'allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts allow-same-origin',
			featurePolicy: 'animations; autoplay; camera; encrypted-media; fullscreen; geolocation; microphone; speaker; vr',
			...options,
		}

		const src = new URL(url, window.location.href);
		const origin = options.origin ? options.origin : src.origin;
		const features: {[key: string]: (...args: unknown[]) => unknown} = {
			...options.features,
		};
		const mode = options.mode ? options.mode : '';

		// Create glue controller.
		const controller = new Controller({
			origin,
			handler: async (message: IPayload): Promise<any> => { /* eslint-disable-line @typescript-eslint/no-explicit-any */
				switch (message.type) {
					case 'init': {
						if (state.retryTimer) {
							clearTimeout(state.retryTimer);
						}

						const data = message.data as IInitData;
						state.glue = controller.Glue({
							features: data.features,
							mode,
						});

						// Add provided features.
						const reply: IInitData = {
							features: features ? Object.keys(features) : [],
						};

						if (options && options.onBeforeInit) {
							const p = new Promise((resolve, reject) => {
								state.beforeInitResolve = resolve;
								state.beforeInitReject = reject;
							});
							if (!state.beforeInitResolve || !state.beforeInitReject) {
								throw new Error('glue init promise error');
							}
							try {
								const action = options.onBeforeInit(state.glue, p);
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
						if (!state.glue) {
							throw new Error('failed to glue: no state');
						}

						//const glue = controller.Glue(state.api);
						const data = message.data as IReadyData;
						if (options && options.onBeforeInit && state.beforeInitResolve && state.beforeInitReject) {
							if (data.ready) {
								await state.beforeInitResolve(data.data);
							} else {
								await state.beforeInitReject(data.data);
							}
							resolve(state.glue);
						} else {
							if (data.ready) {
								resolve(state.glue);
							} else {
								if (data.error) {
									throw new Error(`failed to glue: ${data.data}`)
								} else {
									reject(state.glue);
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

		// Create iframe.
		const ownerDocument = container.ownerDocument !== null ? container.ownerDocument : document;
		const frame = ownerDocument.createElement('iframe');
		if (options && options.className) {
			frame.className = options.className;
		}
		if (options.sandboxRestrictions) {
			frame.setAttribute('sandbox', options.sandboxRestrictions);
		}
		if (options.featurePolicy) {
			frame.setAttribute('allow', options.featurePolicy);
		}
		if (options && options.attributes) {
			Object.entries(options.attributes).forEach(([key, value]) => {
				frame.setAttribute(key, value);
			});
		}

		// Prepare URL and set it to element.
		setGlueParameter(src, 'mode', mode);
		if (origin !== window.origin) {
			// Cross origin, add glue origin hash parameter to allow white list
			// checks on the other end.
			setGlueParameter(src, 'origin', origin);
		}
		frame.setAttribute('src', src.toString());

		// Append iframe with timeout and retry.
		const append = (): void => {
			// Inject iframe and attach glue.
			container.appendChild(frame);
			if (!frame.contentWindow) {
				throw new Error('new frame has no contentWindow');
			}
			controller.attach(frame.contentWindow);
		}
		const retry = (): void => {
			controller.detach();
			container.removeChild(frame);
			setTimeout(() => {
				append();
			}, 1000); // NOTE(longsleep): Retry time hardcoded - is it needed to have a configuration?
		}
		frame.addEventListener('load', () => {
			if (state.glue) {
				delete state.glue;
			}
			if (options && options.timeout) {
				state.retryTimer = setTimeout(() => {
					if (!state.glue) {
						retry();
					}
				}, options.timeout);
			} else {
				reject(new Error('glue timeout'));
			}
		});
		append();
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

		// Get glue mode.
		const mode = getGlueParameter('mode');

		if (sourceWindow === self || mode === null) {
			// Return empty Glue API if we are self, or glue mode is not set. It
			// this means Glue is not active.
			resolve(new Glue({}));
			return;
		}

		// Add default option values and ensure options.
		options = {
			timeout: 5000,
			...options,
		};

		// Validate origin.
		const expectedOrigin = getGlueParameter('origin');
		if (expectedOrigin) {
			if (expectedOrigin !== window.origin) {
				// Validate white list if cross origin.
				if (!options || !options.origins || !options.origins.includes('expectedOrigin')) {
					throw new Error('glue origin is not allowed');
				}
			}
		}

		// Create glue controller.
		const features: {[key: string]: (...args: unknown[]) => unknown} = {
			...options.features,
		};
		const controller = new Controller({
			origin: expectedOrigin ? expectedOrigin : window.origin,
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
		});

		// Attach glue.
		controller.attach(sourceWindow);

		// Start timeout.
		let failed = false;
		const timer = setTimeout(() => {
			failed = true;
			reject(new Error('glue timeout'));
		}, options.timeout);

		// Start initialization.
		queueMicroTask(() => {
			const request: IInitData = {
				features: features ? Object.keys(features) : [],
				mode,
			}
			controller.postMessage('init', request).then(async (initData?: IInitData): Promise<void> => {
				clearTimeout(timer);
				if (failed) {
					// Do nothing when flagged failed.
					return;
				}
				if (!initData || initData.error) {
					// TODO(longsleep): Initialization failed. What now?
					reject(new Error(`glue init received error: ${initData ? initData.error : 'no data'}`));
					return;
				}

				const readyData: IReadyData = {
					ready: true,
				}

				// Create glue.
				const glue = controller.Glue({
					features: initData.features,
					mode,
				});

				// Trigger onInit hook.
				if (options && options.onInit) {
					try {
						options.onInit(glue, initData);
					} catch(e) {
						readyData.ready = false;
						readyData.error = true;
						readyData.data = e;
					}
				}

				// Trigger initial requested action.
				if (readyData.ready && initData.action) {
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

				// Trigger beforeReady hook.
				if (options && options.onBeforeReady) {
					try {
						options.onBeforeReady(glue, readyData);
					} catch(e) {
						readyData.ready = false;
						readyData.error = true;
						readyData.data = e;
					}
				}

				// Reply with redy result.
				controller.postMessage('ready', readyData).then((): void => {
					resolve(glue);
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
