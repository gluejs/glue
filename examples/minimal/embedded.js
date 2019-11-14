'use strict';

console.info('embedded.js start', window.parent);

(async () => {
	const glue = await Glue.enable(window.parent, {
		features: {
			embeddedFeature1: () => {
				console.log('embedded.js embeddedFeature1 triggered');
				return {
					some: 'result',
				};
			},
			someOtherThing: (...args) => {
				console.log('embedded.js someOtherThing triggered', args);
			},
		},
		onReady: (readyData, api) => {
			console.info('embedded.js glue is ready', readyData, api);
		},
	});
	console.log('embedded.js created glue', glue);
})();
