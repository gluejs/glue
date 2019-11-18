/* eslint-env browser, es6 */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* global Glue */

'use strict';

window.app = new function App() {
	console.info('embedded start', window.parent);

	const state = {
		glue: null,
		pending: null,
	}

	console.time('embedded glue init');
	Glue.enable(window.parent, {
		features: {
			embeddedFeatureWithSmallDelay: () => {
				console.debug('embedded embeddedFeatureWithSmallDelay triggered');
				return new Promise(resolve => {
					setTimeout(() => {
						console.debug('embedded embeddedFeatureWithSmallDelay delay reached');
						resolve({
							some: 'result',
						});
					}, 500);
				})
			},
			someOtherThing: (...args) => {
				console.debug('embedded someOtherThing triggered', args);
			},
			exampleOKCancelAction: (...args) => {
				console.debug('embedded exampleOKCancelAction triggered', args);
				if (state.pending) {
					throw new Error('embedded action already pending');
				}
				return new Promise(resolve => {
					state.pending = resolve;
				}).then(value => {
					state.pending = null;
					return value;
				}).catch(reason => {
					state.pending = null;
					throw reason;
				});
			}
		},
		onInit: (glue, initData) => {
			console.timeEnd('embedded glue init', glue.mode, Object.keys(glue.api), initData);
		},
		onBeforeReady: (glue, readyData) => {
			console.log('embedded glue onBeforeReady', glue.mode, Object.keys(glue.api), readyData);
		},
	}).then(glue => {
		console.debug('embedded glue complete', glue.mode, glue.enabled, glue);
		state.glue = glue;

		if (glue.mode === undefined) {
			alert('Loaded without glue!');
		}
	});

	this.handleOKCancelClick = (action) => {
		console.debug('embedded okCancel click', action, state.pending);
		if (state.pending) {
			state.pending(action);
		}
	}

	this.handleToggleHeaderColorClick = () => {
		console.debug('embedded toggleHeaderColor');
		const glue = state.glue;

		if (glue && typeof glue.api.toggleHeaderColor === 'function') {
			glue.api.toggleHeaderColor();
		}
	}

};
