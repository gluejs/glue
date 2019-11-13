'use strict';

console.log('embedded.js start', window.parent);

(async () => {
	const glue = await Glue.enable(window.parent, {
	});
	console.log('embedded.js created glue', glue);
})();
