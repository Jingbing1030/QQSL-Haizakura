function createStateWiring(bridgeManager) {
	const bus = new StateBus();
	const publishAccountChange = () => {
		bus.publish("qq-list");
		bus.publish("connections");
	};
	const unsubscribe = bridgeManager.subscribeSessions({
		started: publishAccountChange,
		closed: publishAccountChange
	});
	return {
		bus,
		onSessionsChanged: () => bus.publish("processes"),
		dispose() {
			bus.dispose();
			unsubscribe();
		}
	};
}
