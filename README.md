# Glue

A JavaScript library for easy integration of independent web applications.

## Quick start

The idea is that web applications load Glue and enable it by exposing a set of feature functions. This functions can then be triggered by other applications which also run Glue after performing a handshake via a postMessage based JSON API.

### Enabling Glue for an App

```javascript
Glue.enable(window.parent, {
	/* Glue enable options */
	features: {
		/* Exposed feature action functions */
		helloWorld: () => {
			alert('Hello World!');
		},
		howAreYou: () => {
			return prompt('How are you?');
		},
	},
}).then(glue => {
	/* Resolved when a Glue application has connected and is ready */
});
```

### Using a Glue enabled App

```javascript
Glue.embed('./hello-world.html', document.body, {
	/* Glue embed options */
	features: {
		/* Exposed features for the embedded app - yes it goes both ways */
	},
	sandboxRestrictions: 'allow-scripts allow-same-origin allow-modals',
}).then(glue => {
	/* Resolved when the Glue application is ready */
	if ('helloWorld' in glue.api) {
		/* Trigger glued function when feature is detected */
		glue.api.helloWorld()
		.then(result => glue.api.howAreYou(result))
		.then(finalResult => {
			alert('Result: ' + finalResult);
		});
	}
});
```

## License

See `LICENSE.txt` for licensing information of this project.
