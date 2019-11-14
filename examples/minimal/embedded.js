/* eslint-env browser */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* global Glue */

'use strict';

console.info('embedded start', window.parent);

Glue.enable(window.parent, {
	features: {
		embeddedFeature1: () => {
			console.log('embedded embeddedFeature1 triggered');
			return {
				some: 'result',
			};
		},
		someOtherThing: (...args) => {
			console.log('embedded someOtherThing triggered', args);
		},
	},
	onReady: (readyData, api) => {
		console.info('embedded glue is ready', readyData, api);
	},
}).then(glue => {
	console.log('embedded created glue', glue);
});
